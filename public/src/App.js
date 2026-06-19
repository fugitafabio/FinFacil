// ============================================================
// App.jsx — FinFacil v2.1 | FASE 2: Save Manual + Auto-save
// ============================================================

import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import {
  BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip, ResponsiveContainer,
  Legend, LineChart, Line
} from "recharts";

const SHEET_ID  = process.env.REACT_APP_SHEET_ID;
const API_KEY   = process.env.REACT_APP_API_KEY;
const CLIENT_ID = process.env.REACT_APP_CLIENT_ID;

const uid = () => crypto.randomUUID();

const COLORS = [
  "#6366f1","#10b981","#f59e0b","#ef4444",
  "#8b5cf6","#06b6d4","#f97316","#84cc16"
];

const EXPENSE_CATS = [
  { id:"fixo",       label:"Custos Fixos",       icon:"🏢", desc:"Aluguel, internet, contador" },
  { id:"pessoal",    label:"Mão de Obra",         icon:"👷", desc:"Salários, pró-labore, FGTS" },
  { id:"variavel",   label:"Custos Variáveis",    icon:"📦", desc:"Insumos, matéria-prima" },
  { id:"marketing",  label:"Marketing & Digital", icon:"📱", desc:"Ads, site, ferramentas" },
  { id:"imposto",    label:"Impostos",            icon:"🏛️", desc:"DAS, ISS, ICMS, IRPJ" },
  { id:"financeiro", label:"Taxas Financeiras",   icon:"💳", desc:"Maquininha, IOF, tarifas" },
  { id:"outro",      label:"Outros",              icon:"🔧", desc:"Manutenção, equipamentos" },
];

const MONTHS = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];
const TODAY  = new Date().toISOString().slice(0, 10);
const MIN_DATE = "2000-01-01";

// ─────────────────────────────────────────────
// ✅ FASE 2 — Save Status Constants
// ─────────────────────────────────────────────
const SAVE_STATUS = {
  IDLE:    "idle",
  PENDING: "pending",   // há mudanças não salvas
  SAVING:  "saving",
  SAVED:   "saved",
  ERROR:   "error",
};

// ─────────────────────────────────────────────
// Validadores (inalterados)
// ─────────────────────────────────────────────
export const validators = {
  product: ({ name, price }) => {
    const errors = {};
    if (!name || !name.trim())
      errors.name = "Nome é obrigatório.";
    else if (name.trim().length < 2)
      errors.name = "Nome deve ter ao menos 2 caracteres.";
    else if (name.trim().length > 100)
      errors.name = "Nome deve ter no máximo 100 caracteres.";

    const p = parseFloat(price);
    if (!price && price !== 0)
      errors.price = "Preço é obrigatório.";
    else if (isNaN(p))
      errors.price = "Preço deve ser um número válido.";
    else if (p <= 0)
      errors.price = "Preço deve ser maior que zero.";
    else if (p > 1_000_000)
      errors.price = "Preço não pode ultrapassar R$ 1.000.000.";

    return { valid: Object.keys(errors).length === 0, errors };
  },

  sale: ({ productId, qty, date }) => {
    const errors = {};
    if (!productId)
      errors.productId = "Selecione um produto.";

    const q = Number(qty);
    if (!qty && qty !== 0)
      errors.qty = "Quantidade é obrigatória.";
    else if (!Number.isInteger(q) || q <= 0)
      errors.qty = "Quantidade deve ser um número inteiro maior que zero.";
    else if (q > 10_000)
      errors.qty = "Quantidade não pode ultrapassar 10.000 unidades.";

    if (!date)
      errors.date = "Data é obrigatória.";
    else if (date < MIN_DATE)
      errors.date = `Data não pode ser anterior a ${MIN_DATE}.`;
    else if (date > TODAY)
      errors.date = "Data não pode ser no futuro.";

    return { valid: Object.keys(errors).length === 0, errors };
  },

  expense: ({ desc, value, date }) => {
    const errors = {};
    if (!desc || !desc.trim())
      errors.desc = "Descrição é obrigatória.";
    else if (desc.trim().length < 3)
      errors.desc = "Descrição deve ter ao menos 3 caracteres.";
    else if (desc.trim().length > 150)
      errors.desc = "Descrição deve ter no máximo 150 caracteres.";

    const v = parseFloat(value);
    if (!value && value !== 0)
      errors.value = "Valor é obrigatório.";
    else if (isNaN(v))
      errors.value = "Valor deve ser um número válido.";
    else if (v <= 0)
      errors.value = "Valor deve ser maior que zero.";
    else if (v > 10_000_000)
      errors.value = "Valor não pode ultrapassar R$ 10.000.000.";

    if (!date)
      errors.date = "Data é obrigatória.";
    else if (date < MIN_DATE)
      errors.date = `Data não pode ser anterior a ${MIN_DATE}.`;
    else if (date > TODAY)
      errors.date = "Data não pode ser no futuro.";

    return { valid: Object.keys(errors).length === 0, errors };
  },
};

// ─────────────────────────────────────────────
// Google Sheets helpers
// ─────────────────────────────────────────────
async function sheetsGet(token, range) {
  const r = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(range)}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!r.ok) throw new Error(`Erro ao ler planilha: ${r.status}`);
  const d = await r.json();
  return d.values || [];
}

async function sheetsClear(token, range) {
  const r = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(range)}:clear`,
    { method: "POST", headers: { Authorization: `Bearer ${token}` } }
  );
  if (!r.ok) throw new Error(`Erro ao limpar planilha: ${r.status}`);
}

async function sheetsWrite(token, range, values) {
  const r = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(range)}?valueInputOption=RAW`,
    {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ values }),
    }
  );
  if (!r.ok) throw new Error(`Erro ao escrever na planilha: ${r.status}`);
}

// ─────────────────────────────────────────────
// ✅ FASE 2 — Retry helper (tenta até 3x em erro de rede)
// ─────────────────────────────────────────────
async function withRetry(fn, retries = 3, delay = 1500) {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i === retries - 1) throw e;
      await new Promise(res => setTimeout(res, delay));
    }
  }
}

// ─────────────────────────────────────────────
// Row parsers
// ─────────────────────────────────────────────
function rowsToProducts(rows) {
  return rows.slice(1).map(r => ({
    id:    r[0] || "",
    name:  r[1] || "",
    cat:   r[2] || "Produto",
    price: parseFloat(r[3]) || 0,
    desc:  r[4] || "",
  }));
}
function rowsToSales(rows) {
  return rows.slice(1).map(r => ({
    id:        r[0] || "",
    productId: r[1] || "",
    qty:       Number(r[2]),
    date:      r[3] || "",
    note:      r[4] || "",
    month:     Number(r[5]),
    year:      Number(r[6]),
  }));
}
function rowsToExpenses(rows) {
  return rows.slice(1).map(r => ({
    id:    r[0] || "",
    desc:  r[1] || "",
    cat:   r[2] || "outro",
    value: parseFloat(r[3]) || 0,
    date:  r[4] || "",
    month: Number(r[5]),
    year:  Number(r[6]),
  }));
}

// ─────────────────────────────────────────────
// UI Primitives
// ─────────────────────────────────────────────
function TT({ text, children }) {
  const [s, ss] = useState(false);
  return (
    <span
      style={{ position: "relative", display: "inline-block" }}
      onMouseEnter={() => ss(true)}
      onMouseLeave={() => ss(false)}
    >
      {children}
      {s && (
        <span style={{
          position: "absolute", bottom: "120%", left: "50%",
          transform: "translateX(-50%)", background: "#1e293b",
          color: "#fff", padding: "6px 10px", borderRadius: 8,
          fontSize: 12, whiteSpace: "nowrap", zIndex: 999,
          boxShadow: "0 2px 8px rgba(0,0,0,.3)",
        }}>
          {text}
          <span style={{
            position: "absolute", top: "100%", left: "50%",
            transform: "translateX(-50%)", borderWidth: 5,
            borderStyle: "solid",
            borderColor: "#1e293b transparent transparent transparent",
          }} />
        </span>
      )}
    </span>
  );
}

function Card({ children, style }) {
  return (
    <div style={{
      background: "#fff", borderRadius: 16, padding: 20,
      boxShadow: "0 2px 12px rgba(0,0,0,.07)", marginBottom: 16, ...style,
    }}>
      {children}
    </div>
  );
}

function Btn({ children, onClick, color = "blue", small, outline, danger, disabled }) {
  const bg = danger ? "#ef4444" : outline ? "transparent" : color === "green" ? "#10b981" : color === "orange" ? "#f59e0b" : "#6366f1";
  const fg = outline ? (danger ? "#ef4444" : "#6366f1") : "#fff";
  return (
    <button onClick={onClick} disabled={disabled} style={{
      background: bg, color: fg,
      border: outline ? `2px solid ${danger ? "#ef4444" : "#6366f1"}` : "none",
      borderRadius: 10,
      padding: small ? "6px 14px" : "10px 20px",
      fontWeight: 700, fontSize: small ? 13 : 15,
      cursor: disabled ? "not-allowed" : "pointer",
      opacity: disabled ? 0.5 : 1,
      transition: "opacity 0.2s, transform 0.1s",
    }}>
      {children}
    </button>
  );
}

function Inp({ label, type = "text", value, onChange, placeholder, hint, prefix, error }) {
  return (
    <div style={{ marginBottom: 14 }}>
      {label && (
        <label style={{ display: "block", fontWeight: 600, fontSize: 14, marginBottom: 5, color: "#374151" }}>
          {label}
        </label>
      )}
      {hint && <p style={{ fontSize: 12, color: "#6b7280", marginBottom: 4 }}>{hint}</p>}
      <div style={{
        display: "flex", alignItems: "center",
        border: `1.5px solid ${error ? "#ef4444" : "#e5e7eb"}`,
        borderRadius: 10, overflow: "hidden",
        background: error ? "#fff5f5" : "#f9fafb",
      }}>
        {prefix && (
          <span style={{
            padding: "0 10px", color: "#6b7280", fontWeight: 700,
            borderRight: `1.5px solid ${error ? "#ef4444" : "#e5e7eb"}`,
            background: "#f3f4f6", alignSelf: "stretch",
            display: "flex", alignItems: "center",
          }}>
            {prefix}
          </span>
        )}
        <input
          type={type}
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          style={{ flex: 1, padding: "10px 14px", border: "none", background: "transparent", fontSize: 15, outline: "none" }}
        />
      </div>
      {error && (
        <p style={{ fontSize: 12, color: "#ef4444", marginTop: 4, fontWeight: 600 }}>
          ⚠️ {error}
        </p>
      )}
    </div>
  );
}

function Sel({ label, value, onChange, options, hint, error }) {
  return (
    <div style={{ marginBottom: 14 }}>
      {label && (
        <label style={{ display: "block", fontWeight: 600, fontSize: 14, marginBottom: 5, color: "#374151" }}>
          {label}
        </label>
      )}
      {hint && <p style={{ fontSize: 12, color: "#6b7280", marginBottom: 4 }}>{hint}</p>}
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        style={{
          width: "100%", padding: "10px 14px",
          border: `1.5px solid ${error ? "#ef4444" : "#e5e7eb"}`,
          borderRadius: 10, fontSize: 15,
          background: error ? "#fff5f5" : "#f9fafb",
          outline: "none",
        }}
      >
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      {error && (
        <p style={{ fontSize: 12, color: "#ef4444", marginTop: 4, fontWeight: 600 }}>
          ⚠️ {error}
        </p>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// ✅ FASE 2 — SaveStatusBar: indicador visual de status
// ─────────────────────────────────────────────
function SaveStatusBar({ status, onSave, lastSavedAt }) {
  const configs = {
    [SAVE_STATUS.IDLE]:    { icon: "✅", text: "Sincronizado",         color: "#c4b5fd", btn: false },
    [SAVE_STATUS.PENDING]: { icon: "🟡", text: "Alterações pendentes", color: "#fde68a", btn: true  },
    [SAVE_STATUS.SAVING]:  { icon: "⏳", text: "Salvando...",          color: "#bfdbfe", btn: false },
    [SAVE_STATUS.SAVED]:   { icon: "✅", text: "Salvo com sucesso!",   color: "#bbf7d0", btn: false },
    [SAVE_STATUS.ERROR]:   { icon: "❌", text: "Erro ao salvar",       color: "#fecaca", btn: true  },
  };

  const cfg = configs[status] || configs[SAVE_STATUS.IDLE];

  const formatTime = (date) => {
    if (!date) return "";
    return date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  };

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      {/* Indicador de texto */}
      <div style={{
        background: "rgba(255,255,255,0.15)",
        borderRadius: 8,
        padding: "4px 10px",
        fontSize: 11,
        color: "#fff",
        fontWeight: 600,
        display: "flex",
        alignItems: "center",
        gap: 4,
      }}>
        <span>{cfg.icon}</span>
        <span>{cfg.text}</span>
        {status === SAVE_STATUS.SAVED && lastSavedAt && (
          <span style={{ opacity: 0.8 }}>· {formatTime(lastSavedAt)}</span>
        )}
      </div>

      {/* Botão Salvar — aparece quando há pendências ou erro */}
      {cfg.btn && (
        <button
          onClick={onSave}
          disabled={status === SAVE_STATUS.SAVING}
          style={{
            background: status === SAVE_STATUS.ERROR ? "#ef4444" : "#fff",
            color:      status === SAVE_STATUS.ERROR ? "#fff"    : "#6366f1",
            border:     "none",
            borderRadius: 8,
            padding: "5px 12px",
            fontWeight: 800,
            fontSize: 12,
            cursor: "pointer",
            boxShadow: "0 1px 4px rgba(0,0,0,.2)",
            transition: "transform 0.1s",
          }}
          onMouseOver={e => e.currentTarget.style.transform = "scale(1.05)"}
          onMouseOut={e  => e.currentTarget.style.transform = "scale(1)"}
        >
          {status === SAVE_STATUS.ERROR ? "🔁 Tentar novamente" : "💾 Salvar agora"}
        </button>
      )}
    </div>
  );
}

const fmt = v => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

// ─────────────────────────────────────────────
// App Root
// ─────────────────────────────────────────────
export default function App() {
  const [tab, setTab]                = useState("dashboard");
  const [products, setProductsState] = useState([]);
  const [sales,    setSalesState]    = useState([]);
  const [expenses, setExpensesState] = useState([]);
  const [period,   setPeriod]        = useState("month");
  const [selMonth, setSelMonth]      = useState(new Date().getMonth() + 1);
  const [selYear]                    = useState(new Date().getFullYear());
  const [token,    setToken]         = useState(null);
  const [authStatus, setAuthStatus]  = useState("loading");
  const [loadMsg,  setLoadMsg]       = useState("Carregando...");

  // ─────────────────────────────────────────────
  // ✅ FASE 2 — Estados de save
  // ─────────────────────────────────────────────
  const [saveStatus,  setSaveStatus]  = useState(SAVE_STATUS.IDLE);
  const [lastSavedAt, setLastSavedAt] = useState(null);
  const [saveError,   setSaveError]   = useState("");

  // Refs para auto-save (debounce)
  const autoSaveTimer    = useRef(null);
  const pendingDataRef   = useRef({ products: null, sales: null, expenses: null });
  const tokenRef         = useRef(null);

  // Mantém tokenRef sempre atualizado
  useEffect(() => { tokenRef.current = token; }, [token]);

  // ─────────────────────────────────────────────
  // ✅ FASE 2 — Aviso ao fechar com dados pendentes
  // ─────────────────────────────────────────────
  useEffect(() => {
    const handler = (e) => {
      if (saveStatus === SAVE_STATUS.PENDING || saveStatus === SAVE_STATUS.SAVING) {
        e.preventDefault();
        e.returnValue = "Você tem alterações não salvas. Deseja sair mesmo assim?";
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [saveStatus]);

  // ─────────────────────────────────────────────
  // ✅ FASE 2 — Função central de persistência
  // ─────────────────────────────────────────────
  const persistAll = useCallback(async (prods, sls, exps) => {
    const tk = tokenRef.current;
    if (!tk) return;

    setSaveStatus(SAVE_STATUS.SAVING);
    setSaveError("");

    try {
      await withRetry(async () => {
        // Salva em paralelo quando possível
        await Promise.all([
          (async () => {
            await sheetsClear(tk, "Produtos!A:E");
            await sheetsWrite(tk, "Produtos!A1", [
              ["id","nome","tipo","preco","descricao"],
              ...prods.map(p => [p.id, p.name, p.cat, p.price, p.desc]),
            ]);
          })(),
          (async () => {
            await sheetsClear(tk, "Vendas!A:G");
            await sheetsWrite(tk, "Vendas!A1", [
              ["id","productId","qty","data","nota","mes","ano"],
              ...sls.map(s => [s.id, s.productId, s.qty, s.date, s.note, s.month, s.year]),
            ]);
          })(),
          (async () => {
            await sheetsClear(tk, "Despesas!A:G");
            await sheetsWrite(tk, "Despesas!A1", [
              ["id","descricao","categoria","valor","data","mes","ano"],
              ...exps.map(e => [e.id, e.desc, e.cat, e.value, e.date, e.month, e.year]),
            ]);
          })(),
        ]);
      });

      setSaveStatus(SAVE_STATUS.SAVED);
      setLastSavedAt(new Date());
      pendingDataRef.current = { products: null, sales: null, expenses: null };

      // Volta para IDLE após 3s
      setTimeout(() => setSaveStatus(s => s === SAVE_STATUS.SAVED ? SAVE_STATUS.IDLE : s), 3000);

    } catch (e) {
      setSaveStatus(SAVE_STATUS.ERROR);
      setSaveError(e.message || "Erro desconhecido ao salvar.");
    }
  }, []);

  // ─────────────────────────────────────────────
  // ✅ FASE 2 — Agenda auto-save com debounce de 3s
  // ─────────────────────────────────────────────
  const scheduleAutoSave = useCallback((prods, sls, exps) => {
    // Armazena dados mais recentes para o save
    pendingDataRef.current = { products: prods, sales: sls, expenses: exps };
    setSaveStatus(SAVE_STATUS.PENDING);

    // Cancela timer anterior e agenda novo
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(() => {
      const { products: p, sales: s, expenses: e } = pendingDataRef.current;
      if (p && s && e) persistAll(p, s, e);
    }, 3000); // 3 segundos de debounce
  }, [persistAll]);

  // ─────────────────────────────────────────────
  // ✅ FASE 2 — Salvar manualmente (botão)
  // ─────────────────────────────────────────────
  const handleManualSave = useCallback(() => {
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    const { products: p, sales: s, expenses: e } = pendingDataRef.current;
    // Se há dados pendentes, salva; senão pega o estado atual via ref
    persistAll(
      p ?? products,
      s ?? sales,
      e ?? expenses
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [persistAll, products, sales, expenses]);

  // Cleanup timer no unmount
  useEffect(() => () => {
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
  }, []);

  // ─────────────────────────────────────────────
  // Setters que disparam o auto-save
  // ─────────────────────────────────────────────
  const setProducts = useCallback((fn) => {
    setProductsState(prev => {
      const next = typeof fn === "function" ? fn(prev) : fn;
      // Precisa dos valores atuais de sales e expenses
      setSalesState(s => { setExpensesState(ex => { scheduleAutoSave(next, s, ex); return ex; }); return s; });
      return next;
    });
  }, [scheduleAutoSave]);

  const setSales = useCallback((fn) => {
    setSalesState(prev => {
      const next = typeof fn === "function" ? fn(prev) : fn;
      setProductsState(p => { setExpensesState(ex => { scheduleAutoSave(p, next, ex); return ex; }); return p; });
      return next;
    });
  }, [scheduleAutoSave]);

  const setExpenses = useCallback((fn) => {
    setExpensesState(prev => {
      const next = typeof fn === "function" ? fn(prev) : fn;
      setProductsState(p => { setSalesState(s => { scheduleAutoSave(p, s, next); return s; }); return p; });
      return next;
    });
  }, [scheduleAutoSave]);

  // ─────────────────────────────────────────────
  // Verificação de env vars
  // ─────────────────────────────────────────────
  useEffect(() => {
    if (!SHEET_ID || !API_KEY || !CLIENT_ID) {
      setAuthStatus("error");
      setLoadMsg(
        "⚠️ Variáveis de ambiente não configuradas. " +
        "Crie o arquivo .env com REACT_APP_SHEET_ID, REACT_APP_API_KEY e REACT_APP_CLIENT_ID."
      );
    }
  }, []);

  const ensureHeaders = useCallback(async (tk) => {
    const check = async (range, headers) => {
      const rows = await sheetsGet(tk, range + "!A1:Z1");
      if (!rows.length || !rows[0].length)
        await sheetsWrite(tk, range + "!A1", [headers]);
    };
    await check("Produtos",  ["id","nome","tipo","preco","descricao"]);
    await check("Vendas",    ["id","productId","qty","data","nota","mes","ano"]);
    await check("Despesas",  ["id","descricao","categoria","valor","data","mes","ano"]);
  }, []);

  const loadAll = useCallback(async (tk) => {
    setLoadMsg("Carregando dados...");
    try {
      await ensureHeaders(tk);
      const [pr, sr, er] = await Promise.all([
        sheetsGet(tk, "Produtos!A:E"),
        sheetsGet(tk, "Vendas!A:G"),
        sheetsGet(tk, "Despesas!A:G"),
      ]);
      setProductsState(pr.length > 1 ? rowsToProducts(pr) : []);
      setSalesState(sr.length > 1    ? rowsToSales(sr)    : []);
      setExpensesState(er.length > 1 ? rowsToExpenses(er) : []);
      setLoadMsg("");
      setSaveStatus(SAVE_STATUS.IDLE);
      setLastSavedAt(new Date());
    } catch (e) {
      setLoadMsg("Erro ao carregar: " + e.message);
    }
  }, [ensureHeaders]);

  useEffect(() => {
    if (!SHEET_ID || !API_KEY || !CLIENT_ID) return;
    const interval = setInterval(() => {
      if (window.gapi && window.google) {
        clearInterval(interval);
        window.gapi.load("client", async () => {
          try {
            await window.gapi.client.init({
              apiKey: API_KEY,
              discoveryDocs: ["https://sheets.googleapis.com/$discovery/rest?version=v4"],
            });
            setAuthStatus("idle");
            setLoadMsg("");
          } catch (e) {
            setAuthStatus("error");
            setLoadMsg("Erro ao inicializar: " + e.message);
          }
        });
      }
    }, 200);
    return () => clearInterval(interval);
  }, []);

  const signIn = useCallback(() => {
    if (!window.google) {
      setLoadMsg("Biblioteca Google não carregou. Recarregue a página.");
      return;
    }
    setAuthStatus("loading");
    setLoadMsg("Abrindo login...");
    const tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: [
        "https://www.googleapis.com/auth/spreadsheets",
        "https://www.googleapis.com/auth/drive.file",
      ].join(" "),
      callback: (resp) => {
        if (resp && resp.access_token) {
          setToken(resp.access_token);
          setAuthStatus("ok");
          loadAll(resp.access_token);
        } else {
          setAuthStatus("error");
          setLoadMsg("Login cancelado ou falhou. Tente novamente.");
        }
      },
      error_callback: (err) => {
        setAuthStatus("error");
        setLoadMsg("Erro OAuth: " + (err?.type || "desconhecido"));
      },
    });
    tokenClient.requestAccessToken({ prompt: "select_account" });
  }, [loadAll]);

  // ─────────────────────────────────────────────
  // Filtros e cálculos (inalterados)
  // ─────────────────────────────────────────────
  const filteredSales = useMemo(() => {
    if (period === "month")    return sales.filter(s => s.month === selMonth && s.year === selYear);
    if (period === "quarter")  { const q = Math.ceil(selMonth / 3); return sales.filter(s => Math.ceil(s.month / 3) === q && s.year === selYear); }
    if (period === "semester") { const sem = selMonth <= 6 ? 1 : 2; return sales.filter(s => (s.month <= 6 ? 1 : 2) === sem && s.year === selYear); }
    return sales.filter(s => s.year === selYear);
  }, [sales, period, selMonth, selYear]);

  const filteredExpenses = useMemo(() => {
    if (period === "month")    return expenses.filter(e => e.month === selMonth && e.year === selYear);
    if (period === "quarter")  { const q = Math.ceil(selMonth / 3); return expenses.filter(e => Math.ceil(e.month / 3) === q && e.year === selYear); }
    if (period === "semester") { const sem = selMonth <= 6 ? 1 : 2; return expenses.filter(e => (e.month <= 6 ? 1 : 2) === sem && e.year === selYear); }
    return expenses.filter(e => e.year === selYear);
  }, [expenses, period, selMonth, selYear]);

  const totalRevenue = useMemo(() =>
    filteredSales.reduce((sum, s) => {
      const p = products.find(p => p.id === s.productId);
      return sum + (p ? p.price * s.qty : 0);
    }, 0),
  [filteredSales, products]);

  const totalExpense = useMemo(() =>
    filteredExpenses.reduce((sum, e) => sum + e.value, 0),
  [filteredExpenses]);

  const profit = totalRevenue - totalExpense;
  const margin = totalRevenue > 0 ? ((profit / totalRevenue) * 100).toFixed(1) : 0;

  const TABS = [
    { id:"dashboard", icon:"📊", label:"Painel" },
    { id:"products",  icon:"🛍️", label:"Catálogo" },
    { id:"sales",     icon:"💰", label:"Receitas" },
    { id:"expenses",  icon:"💸", label:"Despesas" },
    { id:"reports",   icon:"📈", label:"Relatórios" },
  ];

  // ─── Auth screens ───
  if (authStatus === "loading") return (
    <div style={{ minHeight:"100vh", background:"#f0f4ff", display:"flex", alignItems:"center", justifyContent:"center" }}>
      <div style={{ textAlign:"center" }}>
        <div style={{ fontSize:48, marginBottom:12 }}>⏳</div>
        <p style={{ fontWeight:700, color:"#6366f1" }}>{loadMsg}</p>
      </div>
    </div>
  );

  if (authStatus === "idle" || authStatus === "error") return (
    <div style={{ minHeight:"100vh", background:"#f0f4ff", display:"flex", alignItems:"center", justifyContent:"center", padding:24 }}>
      <div style={{ background:"#fff", borderRadius:16, padding:40, maxWidth:400, width:"100%", textAlign:"center", boxShadow:"0 2px 12px rgba(0,0,0,.07)" }}>
        <div style={{ fontSize:56, marginBottom:12 }}>💼</div>
        <h1 style={{ margin:"0 0 8px", fontSize:24, fontWeight:800 }}>FinFacil</h1>
        <p style={{ color:"#6b7280", marginBottom:24 }}>Controle financeiro sincronizado com Google Sheets</p>
        {authStatus === "error" && (
          <p style={{ color:"#ef4444", marginBottom:16, fontSize:14 }}>{loadMsg}</p>
        )}
        <Btn onClick={signIn} color="green">🔗 Entrar com Google</Btn>
        <p style={{ fontSize:12, color:"#9ca3af", marginTop:16 }}>
          Seus dados ficam salvos na planilha<br/>
          <strong>FinFacil — Dados</strong> no seu Drive
        </p>
      </div>
    </div>
  );

  // ─── App principal ───
  return (
    <div style={{ minHeight:"100vh", background:"#f0f4ff", fontFamily:"'Segoe UI',sans-serif" }}>

      {/* Header */}
      <div style={{
        background: "linear-gradient(135deg,#6366f1,#8b5cf6)",
        padding: "16px 20px", display:"flex", alignItems:"center",
        justifyContent:"space-between", position:"sticky", top:0, zIndex:100,
        boxShadow:"0 2px 16px rgba(99,102,241,.3)",
      }}>
        <div>
          <div style={{ color:"#fff", fontWeight:800, fontSize:20 }}>💼 FinFacil</div>
          {/* ✅ FASE 2 — SaveStatusBar no header */}
          <SaveStatusBar
            status={saveStatus}
            onSave={handleManualSave}
            lastSavedAt={lastSavedAt}
          />
        </div>

        <div style={{ display:"flex", gap:8, alignItems:"center" }}>
          <select
            value={period}
            onChange={e => setPeriod(e.target.value)}
            style={{ padding:"6px 10px", borderRadius:8, border:"none", fontWeight:700, fontSize:13, background:"rgba(255,255,255,.2)", color:"#fff", cursor:"pointer" }}
          >
            <option value="month">Mês</option>
            <option value="quarter">Trimestre</option>
            <option value="semester">Semestre</option>
            <option value="year">Ano</option>
          </select>
          {period === "month" && (
            <select
              value={selMonth}
              onChange={e => setSelMonth(Number(e.target.value))}
              style={{ padding:"6px 10px", borderRadius:8, border:"none", fontWeight:700, fontSize:13, background:"rgba(255,255,255,.2)", color:"#fff", cursor:"pointer" }}
            >
              {MONTHS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
            </select>
          )}
        </div>
      </div>

      {/* ✅ FASE 2 — Banner de erro de save (quando ocorre) */}
      {saveStatus === SAVE_STATUS.ERROR && saveError && (
        <div style={{
          background:"#fee2e2", padding:"10px 20px", fontSize:13,
          color:"#991b1b", textAlign:"center", fontWeight:600,
          display:"flex", justifyContent:"center", alignItems:"center", gap:12,
        }}>
          ❌ {saveError}
          <button
            onClick={handleManualSave}
            style={{ background:"#ef4444", color:"#fff", border:"none", borderRadius:8, padding:"4px 12px", fontWeight:700, cursor:"pointer", fontSize:13 }}
          >
            🔁 Tentar novamente
          </button>
        </div>
      )}

      {loadMsg && saveStatus !== SAVE_STATUS.ERROR && (
        <div style={{ background:"#fef3c7", padding:"10px 20px", fontSize:13, color:"#92400e", textAlign:"center" }}>
          {loadMsg}
        </div>
      )}

      <div style={{ maxWidth:900, margin:"0 auto", padding:"16px 12px 100px" }}>
        {tab === "dashboard" && (
          <Dashboard
            products={products} filteredSales={filteredSales}
            filteredExpenses={filteredExpenses} totalRevenue={totalRevenue}
            totalExpense={totalExpense} profit={profit} margin={margin}
            fmt={fmt} sales={sales} expenses={expenses} selYear={selYear}
          />
        )}
        {tab === "products" && (
          <Products products={products} setProducts={setProducts} fmt={fmt} sales={sales} />
        )}
        {tab === "sales" && (
          <Sales
            sales={sales} setSales={setSales} products={products}
            filteredSales={filteredSales} fmt={fmt}
            selMonth={selMonth} selYear={selYear}
          />
        )}
        {tab === "expenses" && (
          <Expenses
            expenses={expenses} setExpenses={setExpenses}
            filteredExpenses={filteredExpenses} fmt={fmt}
          />
        )}
        {tab === "reports" && (
          <Reports products={products} sales={sales} expenses={expenses} fmt={fmt} selYear={selYear} />
        )}
      </div>

      {/* Bottom nav */}
      <div style={{
        position:"fixed", bottom:0, left:0, right:0,
        background:"#fff", borderTop:"1.5px solid #e5e7eb",
        display:"flex", zIndex:200, boxShadow:"0 -4px 20px rgba(0,0,0,.1)",
      }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            flex:1, padding:"10px 0 8px", border:"none", background:"none", cursor:"pointer",
            borderTop: tab === t.id ? "3px solid #6366f1" : "3px solid transparent",
          }}>
            <div style={{ fontSize:22 }}>{t.icon}</div>
            <div style={{ fontSize:11, fontWeight:700, color: tab === t.id ? "#6366f1" : "#9ca3af" }}>
              {t.label}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// Dashboard (inalterado)
// ─────────────────────────────────────────────
function Dashboard({ products, filteredSales, filteredExpenses, totalRevenue, totalExpense, profit, margin, fmt, sales, expenses, selYear }) {
  const health      = profit > 0 && margin > 15 ? "green" : profit > 0 ? "yellow" : "red";
  const healthLabel = health === "green" ? "🟢 Saudável" : health === "yellow" ? "🟡 Atenção" : "🔴 Prejuízo";

  const monthlyData = MONTHS.map((name, i) => {
    const m   = i + 1;
    const rev = sales.filter(s => s.month === m && s.year === selYear).reduce((sum, s) => {
      const p = products.find(p => p.id === s.productId);
      return sum + (p ? p.price * s.qty : 0);
    }, 0);
    const exp = expenses.filter(e => e.month === m && e.year === selYear).reduce((s, e) => s + e.value, 0);
    return { name, Receita: rev, Despesas: exp, Lucro: rev - exp };
  });

  const expByCat = EXPENSE_CATS
    .map(c => ({ name: c.label, value: filteredExpenses.filter(e => e.cat === c.id).reduce((s, e) => s + e.value, 0) }))
    .filter(x => x.value > 0);

  return (
    <div>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:16 }}>
        <h2 style={{ margin:0, fontSize:22, fontWeight:800 }}>Painel Geral</h2>
        <span style={{
          background: health==="green"?"#dcfce7":health==="yellow"?"#fef9c3":"#fee2e2",
          color:      health==="green"?"#16a34a":health==="yellow"?"#ca8a04":"#dc2626",
          borderRadius:99, padding:"3px 12px", fontWeight:700, fontSize:13,
        }}>
          {healthLabel}
        </span>
      </div>

      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12, marginBottom:16 }}>
        {[
          ["💰","Receita Total",  fmt(totalRevenue), "#10b981","Soma de todas as vendas"],
          ["💸","Despesas",       fmt(totalExpense), "#ef4444","Total de custos"],
          ["📈","Lucro Líquido",  fmt(profit),       profit>=0?"#6366f1":"#ef4444","Receita menos despesas"],
          ["%", "Margem",         `${margin}%`,      "#f59e0b","% de lucro sobre receita"],
        ].map(([icon, label, val, color, tip]) => (
          <TT key={label} text={tip}>
            <div style={{
              background:"#fff", borderRadius:14, padding:16,
              boxShadow:"0 2px 10px rgba(0,0,0,.07)",
              borderLeft:`4px solid ${color}`, cursor:"default", height:"100%",
            }}>
              <div style={{ fontSize:22 }}>{icon}</div>
              <div style={{ fontSize:13, color:"#6b7280", fontWeight:600 }}>{label}</div>
              <div style={{ fontSize:20, fontWeight:800, color }}>{val}</div>
            </div>
          </TT>
        ))}
      </div>

      <Card>
        <h3 style={{ margin:"0 0 12px", fontSize:16, fontWeight:700 }}>📊 Receita × Despesas</h3>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={monthlyData} margin={{ left:-20 }}>
            <XAxis dataKey="name" tick={{ fontSize:11 }} />
            <YAxis tick={{ fontSize:11 }} />
            <Tooltip formatter={v => fmt(v)} />
            <Legend />
            <Bar dataKey="Receita"  fill="#10b981" radius={[4,4,0,0]} />
            <Bar dataKey="Despesas" fill="#ef4444" radius={[4,4,0,0]} />
          </BarChart>
        </ResponsiveContainer>
      </Card>

      {expByCat.length > 0 && (
        <Card>
          <h3 style={{ margin:"0 0 12px", fontSize:16, fontWeight:700 }}>🍕 Despesas por Categoria</h3>
          <ResponsiveContainer width="100%" height={200}>
            <PieChart>
              <Pie data={expByCat} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80}
                label={({ percent }) => `${(percent * 100).toFixed(0)}%`}>
                {expByCat.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
              </Pie>
              <Tooltip formatter={v => fmt(v)} />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </Card>
      )}

      <Card>
        <h3 style={{ margin:"0 0 12px", fontSize:16, fontWeight:700 }}>📉 Evolução do Lucro</h3>
        <ResponsiveContainer width="100%" height={180}>
          <LineChart data={monthlyData} margin={{ left:-20 }}>
            <XAxis dataKey="name" tick={{ fontSize:11 }} />
            <YAxis tick={{ fontSize:11 }} />
            <Tooltip formatter={v => fmt(v)} />
            <Line type="monotone" dataKey="Lucro" stroke="#6366f1" strokeWidth={3} dot={{ r:4 }} />
          </LineChart>
        </ResponsiveContainer>
      </Card>
    </div>
  );
}

// ─────────────────────────────────────────────
// Products (inalterado — usa setProducts novo)
// ─────────────────────────────────────────────
function Products({ products, setProducts, fmt, sales }) {
  const emptyForm = { name:"", cat:"Produto", price:"", desc:"" };
  const [form,    setForm]    = useState(emptyForm);
  const [errors,  setErrors]  = useState({});
  const [editing, setEditing] = useState(null);
  const [confirm, setConfirm] = useState(null);

  const salesCount = id => sales.filter(s => s.productId === id).reduce((s, x) => s + x.qty, 0);
  const topId      = products.length > 0
    ? products.reduce((a, b) => salesCount(a.id) >= salesCount(b.id) ? a : b).id
    : null;

  const save = () => {
    const { valid, errors: errs } = validators.product(form);
    if (!valid) { setErrors(errs); return; }
    setErrors({});
    if (editing) {
      setProducts(p => p.map(x => x.id === editing ? { ...x, ...form, price: parseFloat(form.price) } : x));
      setEditing(null);
    } else {
      setProducts(p => [...p, { id: uid(), ...form, price: parseFloat(form.price) }]);
    }
    setForm(emptyForm);
  };

  const cancel = () => { setEditing(null); setForm(emptyForm); setErrors({}); };

  return (
    <div>
      <h2 style={{ fontSize:22, fontWeight:800, marginBottom:16 }}>🛍️ Catálogo</h2>
      <Card>
        <h3 style={{ margin:"0 0 12px", fontSize:16, fontWeight:700 }}>
          {editing ? "✏️ Editar" : "➕ Novo produto/serviço"}
        </h3>
        <Inp label="Nome" value={form.name} error={errors.name} onChange={v => setForm({ ...form, name: v })} placeholder="Ex: Consultoria, Produto X" />
        <Sel label="Tipo" value={form.cat} onChange={v => setForm({ ...form, cat: v })} options={[{ value:"Produto", label:"📦 Produto" },{ value:"Serviço", label:"🛠️ Serviço" }]} />
        <Inp label="Preço (R$)" type="number" value={form.price} error={errors.price} onChange={v => setForm({ ...form, price: v })} prefix="R$" hint="Valor unitário de venda" />
        <Inp label="Descrição (opcional)" value={form.desc} onChange={v => setForm({ ...form, desc: v })} placeholder="Breve descrição" />
        <div style={{ display:"flex", gap:8 }}>
          <Btn onClick={save} color="green">{editing ? "💾 Salvar" : "➕ Adicionar"}</Btn>
          {editing && <Btn outline onClick={cancel}>Cancelar</Btn>}
        </div>
      </Card>

      {products.length === 0 && <div style={{ textAlign:"center", padding:40, color:"#9ca3af" }}>Nenhum produto ainda. Adicione acima! ☝️</div>}

      {products.map(p => (
        <Card key={p.id} style={{ borderLeft:`4px solid ${p.id === topId ? "#f59e0b" : "#e5e7eb"}` }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
            <div>
              <div style={{ fontWeight:800, fontSize:17 }}>{p.name}{p.id === topId && " ⭐"}</div>
              <div style={{ fontSize:13, color:"#6b7280" }}>{p.cat}{p.desc && ` · ${p.desc}`}</div>
              <div style={{ fontSize:22, fontWeight:800, color:"#10b981", marginTop:4 }}>{fmt(p.price)}</div>
              <div style={{ fontSize:13, color:"#6b7280" }}>🛒 {salesCount(p.id)} vendidos</div>
            </div>
            <div style={{ display:"flex", gap:8 }}>
              <Btn small outline onClick={() => { setForm({ name:p.name, cat:p.cat, price:String(p.price), desc:p.desc }); setEditing(p.id); setErrors({}); }}>✏️</Btn>
              <Btn small danger onClick={() => setConfirm(p.id)}>🗑️</Btn>
            </div>
          </div>
          {confirm === p.id && (
            <div style={{ marginTop:12, padding:12, background:"#fee2e2", borderRadius:10, display:"flex", gap:10, alignItems:"center" }}>
              <span style={{ fontSize:14, fontWeight:600 }}>⚠️ Excluir?</span>
              <Btn small danger onClick={() => { setProducts(ps => ps.filter(x => x.id !== p.id)); setConfirm(null); }}>Sim</Btn>
              <Btn small outline onClick={() => setConfirm(null)}>Não</Btn>
            </div>
          )}
        </Card>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────
// Sales (inalterado — usa setSales novo)
// ─────────────────────────────────────────────
function Sales({ sales, setSales, products, filteredSales, fmt, selMonth, selYear }) {
  const emptyForm = { productId:"", qty:"1", date: TODAY, note:"" };
  const [form,    setForm]    = useState(emptyForm);
  const [errors,  setErrors]  = useState({});
  const [editing, setEditing] = useState(null);
  const [confirm, setConfirm] = useState(null);

  const selProd  = products.find(p => p.id === form.productId);
  const subtotal = selProd ? selProd.price * (Number(form.qty) || 0) : 0;
  const total    = filteredSales.reduce((sum, s) => {
    const p = products.find(p => p.id === s.productId);
    return sum + (p ? p.price * s.qty : 0);
  }, 0);

  const save = () => {
    const { valid, errors: errs } = validators.sale(form);
    if (!valid) { setErrors(errs); return; }
    setErrors({});
    const d     = new Date(form.date);
    const entry = { productId: form.productId, qty: Number(form.qty), date: form.date, note: form.note, month: d.getMonth() + 1, year: d.getFullYear() };
    if (editing) {
      setSales(ss => ss.map(s => s.id === editing ? { ...s, ...entry } : s));
      setEditing(null);
    } else {
      setSales(ss => [...ss, { id: uid(), ...entry }]);
    }
    setForm(emptyForm);
  };

  const cancel = () => { setEditing(null); setForm(emptyForm); setErrors({}); };

  return (
    <div>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16 }}>
        <h2 style={{ fontSize:22, fontWeight:800, margin:0 }}>💰 Receitas</h2>
        <div style={{ textAlign:"right" }}>
          <div style={{ fontSize:12, color:"#6b7280" }}>Total</div>
          <div style={{ fontSize:22, fontWeight:800, color:"#10b981" }}>{fmt(total)}</div>
        </div>
      </div>

      <Card>
        <h3 style={{ margin:"0 0 12px", fontSize:16, fontWeight:700 }}>{editing ? "✏️ Editar" : "➕ Registrar venda"}</h3>
        <Sel label="Produto/Serviço" value={form.productId} error={errors.productId} onChange={v => setForm({ ...form, productId: v })} hint="Selecione o que foi vendido" options={[{ value:"", label:"— Selecione —" }, ...products.map(p => ({ value: p.id, label: `${p.cat==="Serviço"?"🛠️":"📦"} ${p.name} — ${fmt(p.price)}` }))]} />
        <Inp label="Quantidade" type="number" value={form.qty} error={errors.qty} onChange={v => setForm({ ...form, qty: v })} placeholder="1" />
        {selProd && (
          <div style={{ background:"#f0fdf4", border:"1.5px solid #bbf7d0", borderRadius:10, padding:"10px 14px", marginBottom:14, fontWeight:700, color:"#15803d" }}>
            💵 Subtotal: {fmt(subtotal)}
          </div>
        )}
        <Inp label="Data" type="date" value={form.date} error={errors.date} onChange={v => setForm({ ...form, date: v })} />
        <Inp label="Observação" value={form.note} onChange={v => setForm({ ...form, note: v })} placeholder="Ex: Pagamento via Pix" />
        <div style={{ display:"flex", gap:8 }}>
          <Btn onClick={save} color="green">{editing ? "💾 Salvar" : "➕ Registrar"}</Btn>
          {editing && <Btn outline onClick={cancel}>Cancelar</Btn>}
        </div>
      </Card>

      {filteredSales.length === 0 && <div style={{ textAlign:"center", padding:40, color:"#9ca3af" }}>Nenhuma venda neste período.</div>}

      {filteredSales.slice().reverse().map(s => {
        const p   = products.find(x => x.id === s.productId);
        const val = p ? p.price * s.qty : 0;
        return (
          <Card key={s.id}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
              <div>
                <div style={{ fontWeight:700, fontSize:16 }}>{p ? p.name : "Produto removido"}</div>
                <div style={{ color:"#6b7280", fontSize:13 }}>{s.qty}x {p ? fmt(p.price) : "—"} · {new Date(s.date + "T12:00:00").toLocaleDateString("pt-BR")}</div>
                {s.note && <div style={{ fontSize:12, color:"#9ca3af" }}>💬 {s.note}</div>}
              </div>
              <div style={{ textAlign:"right" }}>
                <div style={{ fontWeight:800, fontSize:18, color:"#10b981" }}>{fmt(val)}</div>
                <div style={{ display:"flex", gap:6, marginTop:6 }}>
                  <Btn small outline onClick={() => { setForm({ productId: s.productId, qty: String(s.qty), date: s.date, note: s.note || "" }); setEditing(s.id); setErrors({}); }}>✏️</Btn>
                  <Btn small danger onClick={() => setConfirm(s.id)}>🗑️</Btn>
                </div>
              </div>
            </div>
            {confirm === s.id && (
              <div style={{ marginTop:10, padding:10, background:"#fee2e2", borderRadius:10, display:"flex", gap:10, alignItems:"center" }}>
                <span style={{ fontSize:13, fontWeight:600 }}>⚠️ Excluir?</span>
                <Btn small danger onClick={() => { setSales(ss => ss.filter(x => x.id !== s.id)); setConfirm(null); }}>Sim</Btn>
                <Btn small outline onClick={() => setConfirm(null)}>Não</Btn>
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────
// Expenses (inalterado — usa setExpenses novo)
// ─────────────────────────────────────────────
function Expenses({ expenses, setExpenses, filteredExpenses, fmt }) {
  const emptyForm = { desc:"", cat:"fixo", value:"", date: TODAY };
  const [form,      setForm]      = useState(emptyForm);
  const [errors,    setErrors]    = useState({});
  const [editing,   setEditing]   = useState(null);
  const [confirm,   setConfirm]   = useState(null);
  const [filterCat, setFilterCat] = useState("all");

  const total   = filteredExpenses.reduce((s, e) => s + e.value, 0);
  const visible = filterCat === "all" ? filteredExpenses : filteredExpenses.filter(e => e.cat === filterCat);

  const save = () => {
    const { valid, errors: errs } = validators.expense(form);
    if (!valid) { setErrors(errs); return; }
    setErrors({});
    const d     = new Date(form.date);
    const entry = { desc: form.desc.trim(), cat: form.cat, value: parseFloat(form.value), date: form.date, month: d.getMonth() + 1, year: d.getFullYear() };
    if (editing) {
      setExpenses(es => es.map(e => e.id === editing ? { ...e, ...entry } : e));
      setEditing(null);
    } else {
      setExpenses(es => [...es, { id: uid(), ...entry }]);
    }
    setForm(emptyForm);
  };

  const cancel = () => { setEditing(null); setForm(emptyForm); setErrors({}); };

  return (
    <div>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16 }}>
        <h2 style={{ fontSize:22, fontWeight:800, margin:0 }}>💸 Despesas</h2>
        <div style={{ textAlign:"right" }}>
          <div style={{ fontSize:12, color:"#6b7280" }}>Total</div>
          <div style={{ fontSize:22, fontWeight:800, color:"#ef4444" }}>{fmt(total)}</div>
        </div>
      </div>

      <Card>
        <h3 style={{ margin:"0 0 12px", fontSize:16, fontWeight:700 }}>{editing ? "✏️ Editar" : "➕ Nova despesa"}</h3>
        <Inp label="Descrição" value={form.desc} error={errors.desc} onChange={v => setForm({ ...form, desc: v })} placeholder="Ex: Aluguel, Google Ads..." hint="O que é esse gasto?" />
        <Sel label="Categoria" value={form.cat} onChange={v => setForm({ ...form, cat: v })} hint="Classifique para relatórios" options={EXPENSE_CATS.map(c => ({ value: c.id, label: `${c.icon} ${c.label} — ${c.desc}` }))} />
        <Inp label="Valor (R$)" type="number" value={form.value} error={errors.value} onChange={v => setForm({ ...form, value: v })} prefix="R$" />
        <Inp label="Data" type="date" value={form.date} error={errors.date} onChange={v => setForm({ ...form, date: v })} />
        <div style={{ display:"flex", gap:8 }}>
          <Btn onClick={save} color="purple">{editing ? "💾 Salvar" : "➕ Adicionar"}</Btn>
          {editing && <Btn outline onClick={cancel}>Cancelar</Btn>}
        </div>
      </Card>

      <div style={{ display:"flex", gap:8, overflowX:"auto", marginBottom:16, paddingBottom:4 }}>
        {[{ id:"all", label:"Todas", icon:"" }, ...EXPENSE_CATS].map(c => (
          <button key={c.id} onClick={() => setFilterCat(c.id)} style={{ padding:"6px 14px", borderRadius:99, border:"none", background: filterCat === c.id ? "#6366f1" : "#e5e7eb", color: filterCat === c.id ? "#fff" : "#374151", fontWeight:700, fontSize:13, cursor:"pointer", whiteSpace:"nowrap" }}>
            {c.icon} {c.label || "Todas"}
          </button>
        ))}
      </div>

      {visible.length === 0 && <div style={{ textAlign:"center", padding:40, color:"#9ca3af" }}>Nenhuma despesa neste período.</div>}

      {visible.slice().reverse().map(e => {
        const cat = EXPENSE_CATS.find(c => c.id === e.cat);
        return (
          <Card key={e.id} style={{ borderLeft:`4px solid ${COLORS[EXPENSE_CATS.findIndex(c => c.id === e.cat) % COLORS.length]}` }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
              <div>
                <div style={{ fontWeight:700, fontSize:16 }}>{e.desc}</div>
                <div style={{ fontSize:13, color:"#6b7280" }}>{cat?.icon} {cat?.label} · {new Date(e.date + "T12:00:00").toLocaleDateString("pt-BR")}</div>
              </div>
              <div style={{ textAlign:"right" }}>
                <div style={{ fontWeight:800, fontSize:18, color:"#ef4444" }}>{fmt(e.value)}</div>
                <div style={{ display:"flex", gap:6, marginTop:6 }}>
                  <Btn small outline onClick={() => { setForm({ desc:e.desc, cat:e.cat, value:String(e.value), date:e.date }); setEditing(e.id); setErrors({}); }}>✏️</Btn>
                  <Btn small danger onClick={() => setConfirm(e.id)}>🗑️</Btn>
                </div>
              </div>
            </div>
            {confirm === e.id && (
              <div style={{ marginTop:10, padding:10, background:"#fee2e2", borderRadius:10, display:"flex", gap:10, alignItems:"center" }}>
                <span style={{ fontSize:13, fontWeight:600 }}>⚠️ Excluir?</span>
                <Btn small danger onClick={() => { setExpenses(es => es.filter(x => x.id !== e.id)); setConfirm(null); }}>Sim</Btn>
                <Btn small outline onClick={() => setConfirm(null)}>Não</Btn>
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────
// Reports (inalterado)
// ─────────────────────────────────────────────
function Reports({ products, sales, expenses, fmt, selYear }) {
  const monthlyData = MONTHS.map((name, i) => {
    const m   = i + 1;
    const rev = sales.filter(s => s.month === m && s.year === selYear).reduce((sum, s) => {
      const p = products.find(p => p.id === s.productId);
      return sum + (p ? p.price * s.qty : 0);
    }, 0);
    const exp = expenses.filter(e => e.month === m && e.year === selYear).reduce((s, e) => s + e.value, 0);
    return { name, Receita: rev, Despesas: exp, Lucro: Math.max(0, rev - exp) };
  });

  const totalRev    = monthlyData.reduce((s, m) => s + m.Receita, 0);
  const totalExp    = monthlyData.reduce((s, m) => s + m.Despesas, 0);
  const totalProfit = totalRev - totalExp;

  const ranking = products
    .map(p => {
      const qty = sales.filter(s => s.year === selYear && s.productId === p.id).reduce((s, x) => s + x.qty, 0);
      return { name: p.name, qty, rev: qty * p.price };
    })
    .sort((a, b) => b.rev - a.rev);

  const expByCat = EXPENSE_CATS
    .map(c => ({ ...c, value: expenses.filter(e => e.year === selYear && e.cat === c.id).reduce((s, e) => s + e.value, 0) }))
    .filter(x => x.value > 0);

  const fixedAvg  = expenses.filter(e => e.year === selYear && e.cat === "fixo").reduce((s, e) => s + e.value, 0) / 12;
  const avgMargin = totalRev > 0 ? totalProfit / totalRev : 0;
  const breakEven = avgMargin > 0 ? fixedAvg / avgMargin : 0;

  return (
    <div>
      <h2 style={{ fontSize:22, fontWeight:800, marginBottom:16 }}>📈 Relatórios — {selYear}</h2>
      <Card>
        <h3 style={{ margin:"0 0 12px", fontSize:16, fontWeight:700 }}>📋 DRE Simplificada</h3>
        {[
          ["(+) Receita Bruta",     totalRev,    "#10b981"],
          ["(-) Total Despesas",    -totalExp,   "#ef4444"],
          ["(=) Resultado Líquido", totalProfit, totalProfit >= 0 ? "#6366f1" : "#ef4444"],
        ].map(([l, v, c], i) => (
          <div key={i} style={{ display:"flex", justifyContent:"space-between", padding:"10px 14px", background: i === 2 ? "#f5f3ff" : "#f9fafb", borderRadius:10, fontWeight: i === 2 ? 800 : 600, fontSize: i === 2 ? 17 : 15, marginBottom:6 }}>
            <span>{l}</span>
            <span style={{ color:c }}>{fmt(Math.abs(v))}</span>
          </div>
        ))}
      </Card>

      <Card>
        <h3 style={{ margin:"0 0 8px", fontSize:16, fontWeight:700 }}>⚖️ Ponto de Equilíbrio (mensal)</h3>
        <p style={{ color:"#6b7280", fontSize:14, margin:"0 0 8px" }}>Mínimo para cobrir os custos fixos mensais.</p>
        <div style={{ fontSize:26, fontWeight:800, color:"#f59e0b" }}>{fmt(breakEven)}</div>
      </Card>

      <Card>
        <h3 style={{ margin:"0 0 12px", fontSize:16, fontWeight:700 }}>🏆 Ranking de Produtos</h3>
        {ranking.length === 0 && <p style={{ color:"#9ca3af" }}>Sem dados.</p>}
        {ranking.map((r, i) => (
          <div key={r.name} style={{ display:"flex", alignItems:"center", gap:12, padding:"10px 0", borderBottom:"1px solid #f3f4f6" }}>
            <span style={{ fontSize:20, width:30, textAlign:"center" }}>{i===0?"🥇":i===1?"🥈":i===2?"🥉":`${i+1}.`}</span>
            <div style={{ flex:1 }}>
              <div style={{ fontWeight:700 }}>{r.name}</div>
              <div style={{ fontSize:13, color:"#6b7280" }}>{r.qty} vendidos</div>
            </div>
            <div style={{ fontWeight:800, color:"#10b981" }}>{fmt(r.rev)}</div>
          </div>
        ))}
      </Card>

      <Card>
        <h3 style={{ margin:"0 0 12px", fontSize:16, fontWeight:700 }}>💸 Despesas por Categoria</h3>
        {expByCat.map((c, i) => (
          <div key={c.id} style={{ marginBottom:10 }}>
            <div style={{ display:"flex", justifyContent:"space-between", marginBottom:3 }}>
              <span style={{ fontSize:14, fontWeight:600 }}>{c.icon} {c.label}</span>
              <span style={{ fontWeight:700, color:"#ef4444" }}>{fmt(c.value)}</span>
            </div>
            <div style={{ background:"#f3f4f6", borderRadius:99, height:8 }}>
              <div style={{ background: COLORS[i % COLORS.length], borderRadius:99, height:8, width: `${Math.min(100, (c.value / expByCat.reduce((s, x) => s + x.value, 0)) * 100)}%` }} />
            </div>
          </div>
        ))}
      </Card>

      <Card>
        <h3 style={{ margin:"0 0 12px", fontSize:16, fontWeight:700 }}>📊 Evolução Anual</h3>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={monthlyData} margin={{ left:-20 }}>
            <XAxis dataKey="name" tick={{ fontSize:11 }} />
            <YAxis tick={{ fontSize:11 }} />
            <Tooltip formatter={v => fmt(v)} />
            <Legend />
            <Bar dataKey="Receita"  fill="#10b981" radius={[4,4,0,0]} />
            <Bar dataKey="Despesas" fill="#ef4444" radius={[4,4,0,0]} />
            <Bar dataKey="Lucro"    fill="#6366f1" radius={[4,4,0,0]} />
          </BarChart>
        </ResponsiveContainer>
      </Card>
    </div>
  );
}
