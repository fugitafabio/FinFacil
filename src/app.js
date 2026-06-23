// ============================================================
// App.jsx — FinFacil v2.2 | FASE 3: Estoque (sem negativo)
// - Estoque editável no Catálogo (ajuste manual)
// - Vendas: reduzem estoque ao criar/editar e devolvem ao excluir
// - Bloqueia venda/edição que deixe estoque < 0
// - Persistência no Google Sheets: adiciona coluna "estoque" em Produtos (A:F)
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
  PENDING: "pending",
  SAVING:  "saving",
  SAVED:   "saved",
  ERROR:   "error",
};

// ─────────────────────────────────────────────
// Validadores
// ─────────────────────────────────────────────
export const validators = {
  product: ({ name, price, stock }) => {
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

    // estoque (opcional para serviços, mas validamos se veio)
    if (stock !== undefined) {
      const st = Number(stock);
      if (stock === "" || stock === null) {
        // ok (vamos tratar como 0 no save)
      } else if (!Number.isFinite(st) || !Number.isInteger(st))
        errors.stock = "Estoque deve ser um número inteiro.";
      else if (st < 0)
        errors.stock = "Estoque não pode ser negativo.";
      else if (st > 1_000_000)
        errors.stock = "Estoque não pode ultrapassar 1.000.000.";
    }

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
// ✅ FASE 2 — Retry helper
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
// Estoque helpers (sem negativo)
// ─────────────────────────────────────────────
const isService = (p) => (p?.cat || "").toLowerCase().includes("serv");

function stockOf(p) {
  // serviço: tratamos como estoque infinito (null) para não bloquear
  if (isService(p)) return null;
  const st = Number(p?.stock);
  return Number.isFinite(st) ? st : 0;
}

function canApplySaleDelta(products, beforeSale, afterSale) {
  // deltaQty: positivo = consumir mais estoque; negativo = devolver estoque
  const bPid = beforeSale?.productId || null;
  const aPid = afterSale?.productId || null;
  const bQty = beforeSale?.qty ? Number(beforeSale.qty) : 0;
  const aQty = afterSale?.qty  ? Number(afterSale.qty)  : 0;

  const changes = new Map(); // productId -> deltaQtyConsumed
  if (bPid) changes.set(bPid, (changes.get(bPid) || 0) - bQty); // remove antes -> devolve
  if (aPid) changes.set(aPid, (changes.get(aPid) || 0) + aQty); // aplica depois -> consome

  for (const [pid, delta] of changes.entries()) {
    if (!delta) continue;
    const p = products.find(x => x.id === pid);
    if (!p) continue;
    const st = stockOf(p);
    if (st === null) continue; // serviço não bloqueia
    const next = st - delta;
    if (next < 0) return { ok: false, product: p, needed: delta, available: st };
  }
  return { ok: true };
}

function applySaleDeltaToProducts(products, beforeSale, afterSale) {
  const bPid = beforeSale?.productId || null;
  const aPid = afterSale?.productId || null;
  const bQty = beforeSale?.qty ? Number(beforeSale.qty) : 0;
  const aQty = afterSale?.qty  ? Number(afterSale.qty)  : 0;

  const deltas = new Map();
  if (bPid) deltas.set(bPid, (deltas.get(bPid) || 0) - bQty);
  if (aPid) deltas.set(aPid, (deltas.get(aPid) || 0) + aQty);

  return products.map(p => {
    const delta = deltas.get(p.id) || 0;
    if (!delta) return p;
    if (stockOf(p) === null) return p; // serviço
    const nextStock = Math.max(0, stockOf(p) - delta);
    return { ...p, stock: nextStock };
  });
}

// ─────────────────────────────────────────────
// Row parsers
// ─────────────────────────────────────────────
function rowsToProducts(rows) {
  // suporta A:E antigo (sem estoque) e A:F novo (com estoque)
  return rows.slice(1).map(r => ({
    id:    r[0] || "",
    name:  r[1] || "",
    cat:   r[2] || "Produto",
    price: parseFloat(r[3]) || 0,
    desc:  r[4] || "",
    stock: r.length >= 6 ? (Number.isFinite(Number(r[5])) ? Number(r[5]) : 0) : 0,
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
// ✅ FASE 2 — SaveStatusBar
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

  const [saveStatus,  setSaveStatus]  = useState(SAVE_STATUS.IDLE);
  const [lastSavedAt, setLastSavedAt] = useState(null);
  const [saveError,   setSaveError]   = useState("");

  const autoSaveTimer    = useRef(null);
  const pendingDataRef   = useRef({ products: null, sales: null, expenses: null });
  const tokenRef         = useRef(null);

  useEffect(() => { tokenRef.current = token; }, [token]);

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

  const persistAll = useCallback(async (prods, sls, exps) => {
    const tk = tokenRef.current;
    if (!tk) return;

    setSaveStatus(SAVE_STATUS.SAVING);
    setSaveError("");

    try {
      await withRetry(async () => {
        await Promise.all([
          (async () => {
            await sheetsClear(tk, "Produtos!A:F");
            await sheetsWrite(tk, "Produtos!A1", [
              ["id","nome","tipo","preco","descricao","estoque"],
              ...prods.map(p => [
                p.id,
                p.name,
                p.cat,
                p.price,
                p.desc,
                isService(p) ? "" : (Number.isFinite(Number(p.stock)) ? Number(p.stock) : 0),
              ]),
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

      setTimeout(() => setSaveStatus(s => s === SAVE_STATUS.SAVED ? SAVE_STATUS.IDLE : s), 3000);

    } catch (e) {
      setSaveStatus(SAVE_STATUS.ERROR);
      setSaveError(e.message || "Erro desconhecido ao salvar.");
    }
  }, []);

  const scheduleAutoSave = useCallback((prods, sls, exps) => {
    pendingDataRef.current = { products: prods, sales: sls, expenses: exps };
    setSaveStatus(SAVE_STATUS.PENDING);

    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(() => {
      const { products: p, sales: s, expenses: e } = pendingDataRef.current;
      if (p && s && e) persistAll(p, s, e);
    }, 3000);
  }, [persistAll]);

  const handleManualSave = useCallback(() => {
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    const { products: p, sales: s, expenses: e } = pendingDataRef.current;
    persistAll(
      p ?? products,
      s ?? sales,
      e ?? expenses
    );
  }, [persistAll, products, sales, expenses]);

  useEffect(() => () => {
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
  }, []);

  const setProducts = useCallback((fn) => {
    setProductsState(prev => {
      const next = typeof fn === "function" ? fn(prev) : fn;
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
    const check = async (sheetName, headers) => {
      const rows = await sheetsGet(tk, sheetName + "!A1:Z1");
      if (!rows.length || !rows[0].length)
        await sheetsWrite(tk, sheetName + "!A1", [headers]);
      else {
        // se Produtos estiver antigo, atualiza cabeçalho para incluir estoque
        if (sheetName === "Produtos") {
          const hasStock = rows[0].map(x => String(x || "").toLowerCase()).includes("estoque");
          if (!hasStock) {
            await sheetsWrite(tk, sheetName + "!A1", [[...headers]]);
          }
        }
      }
    };
    await check("Produtos",  ["id","nome","tipo","preco","descricao","estoque"]);
    await check("Vendas",    ["id","productId","qty","data","nota","mes","ano"]);
    await check("Despesas",  ["id","descricao","categoria","valor","data","mes","ano"]);
  }, []);

  const loadAll = useCallback(async (tk) => {
    setLoadMsg("Carregando dados...");
    try {
      await ensureHeaders(tk);
      const [pr, sr, er] = await Promise.all([
        sheetsGet(tk, "Produtos!A:F"),
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

  // ─── ✅ TABS com Pricing adicionado ───
  const TABS = [
    { id:"dashboard", icon:"📊", label:"Painel" },
    { id:"products",  icon:"🛍️", label:"Catálogo" },
    { id:"sales",     icon:"💰", label:"Receitas" },
    { id:"expenses",  icon:"💸", label:"Despesas" },
    { id:"pricing",   icon:"🧮", label:"Preços" },
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

      {/* Banner de erro */}
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
            setProducts={setProducts}
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
        {tab === "pricing" && (
          <Pricing
            products={products}
            expenses={expenses}
            setProducts={setProducts}
            fmt={fmt}
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
// Dashboard
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
// Products
// ─────────────────────────────────────────────
function Products({ products, setProducts, fmt, sales }) {
  const emptyForm = { name:"", cat:"Produto", price:"", desc:"", stock:"0" };
  const [form,    setForm]    = useState(emptyForm);
  const [errors,  setErrors]  = useState({});
  const [editing, setEditing] = useState(null);
  const [confirm, setConfirm] = useState(null);

  const salesCount = id => sales.filter(s => s.productId === id).reduce((s, x) => s + x.qty, 0);
  const topId      = products.length > 0
    ? products.reduce((a, b) => salesCount(a.id) >= salesCount(b.id) ? a : b).id
    : null;

  const save = () => {
    const payload = { ...form };
    const { valid, errors: errs } = validators.product(payload);
    if (!valid) { setErrors(errs); return; }
    setErrors({});

    const nextEntry = {
      ...form,
      price: parseFloat(form.price),
      stock: isService({ cat: form.cat }) ? 0 : Math.max(0, parseInt(form.stock || "0", 10) || 0),
    };

    if (editing) {
      setProducts(p => p.map(x => x.id === editing ? { ...x, ...nextEntry } : x));
      setEditing(null);
    } else {
      setProducts(p => [...p, { id: uid(), ...nextEntry }]);
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
        <Sel
          label="Tipo"
          value={form.cat}
          onChange={v => setForm({ ...form, cat: v })}
          options={[
            { value:"Produto", label:"📦 Produto" },
            { value:"Serviço", label:"🛠️ Serviço" }
          ]}
        />
        <Inp label="Preço (R$)" type="number" value={form.price} error={errors.price} onChange={v => setForm({ ...form, price: v })} prefix="R$" hint="Valor unitário de venda" />

        {form.cat === "Produto" && (
          <Inp
            label="Estoque (unidades)"
            type="number"
            value={form.stock}
            error={errors.stock}
            onChange={v => setForm({ ...form, stock: v })}
            hint="Ajuste manual do estoque atual (não pode ficar negativo)"
            placeholder="0"
          />
        )}

        <Inp label="Descrição (opcional)" value={form.desc} onChange={v => setForm({ ...form, desc: v })} placeholder="Breve descrição" />
        <div style={{ display:"flex", gap:8 }}>
          <Btn onClick={save} color="green">{editing ? "💾 Salvar" : "➕ Adicionar"}</Btn>
          {editing && <Btn outline onClick={cancel}>Cancelar</Btn>}
        </div>
      </Card>

      {products.length === 0 && <div style={{ textAlign:"center", padding:40, color:"#9ca3af" }}>Nenhum produto ainda. Adicione acima! ☝️</div>}

      {products.map(p => {
        const st = stockOf(p);
        return (
          <Card key={p.id} style={{ borderLeft:`4px solid ${p.id === topId ? "#f59e0b" : "#e5e7eb"}` }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
              <div>
                <div style={{ fontWeight:800, fontSize:17 }}>{p.name}{p.id === topId && " ⭐"}</div>
                <div style={{ fontSize:13, color:"#6b7280" }}>{p.cat}{p.desc && ` · ${p.desc}`}</div>
                <div style={{ fontSize:22, fontWeight:800, color:"#10b981", marginTop:4 }}>{fmt(p.price)}</div>
                <div style={{ fontSize:13, color:"#6b7280" }}>🛒 {salesCount(p.id)} vendidos</div>
                {!isService(p) && (
                  <div style={{ fontSize:13, color: st === 0 ? "#ef4444" : "#6b7280", fontWeight:700 }}>
                    📦 Estoque: {st}
                  </div>
                )}
              </div>
              <div style={{ display:"flex", gap:8 }}>
                <Btn
                  small
                  outline
                  onClick={() => {
                    setForm({
                      name: p.name,
                      cat: p.cat,
                      price: String(p.price),
                      desc: p.desc,
                      stock: String(stockOf(p) ?? 0),
                    });
                    setEditing(p.id);
                    setErrors({});
                  }}
                >
                  ✏️
                </Btn>
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
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────
// Sales
// ─────────────────────────────────────────────
// ─────────────────────────────────────────────
// Sales — venda com múltiplos itens + desconto
// ─────────────────────────────────────────────
function Sales({ sales, setSales, products, setProducts, filteredSales, fmt, selMonth, selYear }) {
  const emptyItem = { productId: "", qty: "1" };
  const emptyForm = { items: [emptyItem], date: TODAY, note: "", discountType: "percent", discountValue: "" };

  const [form, setForm]       = useState(emptyForm);
  const [errors, setErrors]   = useState({});
  const [editing, setEditing] = useState(null); // saleGroup sendo editado
  const [confirm, setConfirm] = useState(null); // saleGroup a excluir

  // ── agrupa vendas pelo saleGroup ──
  const grouped = useMemo(() => {
    const map = new Map();
    filteredSales.forEach(s => {
      const g = s.saleGroup || s.id;
      if (!map.has(g)) map.set(g, []);
      map.get(g).push(s);
    });
    // ordena grupos por data desc
    return Array.from(map.entries())
      .sort((a, b) => (b[1][0]?.date || "").localeCompare(a[1][0]?.date || ""))
      .map(([group, items]) => ({ group, items }));
  }, [filteredSales]);

  // ── total do período ──
  const periodTotal = useMemo(() => {
    return grouped.reduce((sum, { items }) => {
      const gross = items.reduce((s, sale) => {
        const p = products.find(p => p.id === sale.productId);
        return s + (p ? p.price * sale.qty : 0);
      }, 0);
      const discount = items[0]?.discount || 0;
      const discountType = items[0]?.discountType || "percent";
      const discountAmt = discountType === "percent" ? gross * (discount / 100) : discount;
      return sum + Math.max(0, gross - discountAmt);
    }, 0);
  }, [grouped, products]);

  // ── helpers ──
  const setItem = (idx, field, val) => {
    const next = form.items.map((it, i) => i === idx ? { ...it, [field]: val } : it);
    setForm(f => ({ ...f, items: next }));
  };
  const addItem    = () => setForm(f => ({ ...f, items: [...f.items, { ...emptyItem }] }));
  const removeItem = idx => setForm(f => ({ ...f, items: f.items.filter((_, i) => i !== idx) }));

  const grossTotal = useMemo(() => {
    return form.items.reduce((sum, it) => {
      const p = products.find(p => p.id === it.productId);
      return sum + (p ? p.price * (Number(it.qty) || 0) : 0);
    }, 0);
  }, [form.items, products]);

  const discountAmount = useMemo(() => {
    const v = parseFloat(form.discountValue) || 0;
    if (form.discountType === "percent") return grossTotal * (v / 100);
    return Math.min(v, grossTotal);
  }, [form.discountValue, form.discountType, grossTotal]);

  const netTotal = Math.max(0, grossTotal - discountAmount);

  // ── validação ──
  const validate = () => {
    const errs = {};
    if (!form.date) errs.date = "Data é obrigatória.";
    if (form.date > TODAY) errs.date = "Data não pode ser no futuro.";
    form.items.forEach((it, i) => {
      if (!it.productId) errs[`pid_${i}`] = "Selecione um produto.";
      const q = Number(it.qty);
      if (!it.qty || !Number.isInteger(q) || q <= 0) errs[`qty_${i}`] = "Quantidade inválida.";
    });
    const dv = parseFloat(form.discountValue) || 0;
    if (form.discountType === "value" && dv > grossTotal) errs.discount = "Desconto maior que o total.";
    if (form.discountType === "percent" && (dv < 0 || dv > 100)) errs.discount = "Desconto deve ser entre 0 e 100%.";
    return errs;
  };

  // ── salvar ──
  const save = () => {
    const errs = validate();
    if (Object.keys(errs).length) { setErrors(errs); return; }
    setErrors({});

    const d = new Date(form.date);
    const group = editing || uid();
    const dv = parseFloat(form.discountValue) || 0;

    // monta novos itens
    const newEntries = form.items.map((it, idx) => ({
      id: uid(),
      productId: it.productId,
      qty: Number(it.qty),
      date: form.date,
      note: idx === 0 ? form.note : "",
      month: d.getMonth() + 1,
      year: d.getFullYear(),
      saleGroup: group,
      discount: idx === 0 ? dv : 0,
      discountType: idx === 0 ? form.discountType : "percent",
    }));

    // verifica estoque para todos os itens
    for (const entry of newEntries) {
      const prevSale = editing
        ? sales.find(s => s.saleGroup === editing && s.productId === entry.productId)
        : null;
      const check = canApplySaleDelta(products, prevSale || null, entry);
      if (!check.ok) {
        setErrors({ [`qty_${newEntries.indexOf(entry)}`]: `Estoque insuficiente para "${check.product.name}". Disponível: ${check.available}.` });
        return;
      }
    }

    // atualiza estoque
    if (editing) {
      const oldItems = sales.filter(s => s.saleGroup === editing);
      let updatedProducts = [...products];
      oldItems.forEach(old => {
        updatedProducts = applySaleDeltaToProducts(updatedProducts, old, null);
      });
      newEntries.forEach(ne => {
        updatedProducts = applySaleDeltaToProducts(updatedProducts, null, ne);
      });
      setProducts(() => updatedProducts);
      setSales(ss => [...ss.filter(s => s.saleGroup !== editing), ...newEntries]);
    } else {
      newEntries.forEach(ne => setProducts(ps => applySaleDeltaToProducts(ps, null, ne)));
      setSales(ss => [...ss, ...newEntries]);
    }

    setForm(emptyForm);
    setEditing(null);
  };

  // ── editar grupo ──
  const startEdit = (group, items) => {
    const first = items[0];
    setForm({
      items: items.map(s => ({ productId: s.productId, qty: String(s.qty) })),
      date: first.date,
      note: first.note || "",
      discountType: first.discountType || "percent",
      discountValue: first.discount ? String(first.discount) : "",
    });
    setEditing(group);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  // ── excluir grupo ──
  const deleteGroup = (group) => {
    const items = sales.filter(s => s.saleGroup === group || s.id === group);
    items.forEach(s => setProducts(ps => applySaleDeltaToProducts(ps, s, null)));
    setSales(ss => ss.filter(s => (s.saleGroup || s.id) !== group));
    setConfirm(null);
  };

  const cancel = () => { setForm(emptyForm); setEditing(null); setErrors({}); };

  return (
    <div>
      {/* Cabeçalho */}
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16 }}>
        <h2 style={{ fontSize:22, fontWeight:800, margin:0 }}>💰 Receitas</h2>
        <div style={{ textAlign:"right" }}>
          <div style={{ fontSize:12, color:"#6b7280" }}>Total no período</div>
          <div style={{ fontSize:22, fontWeight:800, color:"#10b981" }}>{fmt(periodTotal)}</div>
        </div>
      </div>

      {/* Formulário */}
      <Card>
        <h3 style={{ margin:"0 0 16px", fontSize:16, fontWeight:700 }}>
          {editing ? "✏️ Editar venda" : "➕ Registrar venda"}
        </h3>

        {/* Itens */}
        {form.items.map((it, idx) => {
          const selProd = products.find(p => p.id === it.productId);
          const subtotal = selProd ? selProd.price * (Number(it.qty) || 0) : 0;
          return (
            <div key={idx} style={{ background:"#f8fafc", borderRadius:12, padding:14, marginBottom:10, border:"1.5px solid #e5e7eb" }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
                <span style={{ fontWeight:700, fontSize:13, color:"#6b7280" }}>Item {idx + 1}</span>
                {form.items.length > 1 && (
                  <button onClick={() => removeItem(idx)} style={{ background:"#fee2e2", border:"none", borderRadius:8, padding:"4px 10px", color:"#dc2626", fontWeight:700, cursor:"pointer", fontSize:12 }}>
                    🗑️ Remover
                  </button>
                )}
              </div>

              <div style={{ display:"grid", gridTemplateColumns:"1fr auto", gap:10, alignItems:"start" }}>
                <div>
                  <select
                    value={it.productId}
                    onChange={e => setItem(idx, "productId", e.target.value)}
                    style={{ width:"100%", padding:"10px 14px", border:`1.5px solid ${errors[`pid_${idx}`] ? "#ef4444" : "#e5e7eb"}`, borderRadius:10, fontSize:14, background:"#fff", outline:"none" }}
                  >
                    <option value="">— Selecione o produto —</option>
                    {products.map(p => {
                      const st = stockOf(p);
                      return <option key={p.id} value={p.id}>{p.cat==="Serviço"?"🛠️":"📦"} {p.name} — {fmt(p.price)}{!isService(p) ? ` · Est: ${st}` : ""}</option>;
                    })}
                  </select>
                  {errors[`pid_${idx}`] && <p style={{ color:"#ef4444", fontSize:12, margin:"4px 0 0", fontWeight:600 }}>⚠️ {errors[`pid_${idx}`]}</p>}
                </div>

                <div style={{ width:90 }}>
                  <input
                    type="number"
                    value={it.qty}
                    onChange={e => setItem(idx, "qty", e.target.value)}
                    placeholder="Qtd"
                    style={{ width:"100%", padding:"10px 12px", border:`1.5px solid ${errors[`qty_${idx}`] ? "#ef4444" : "#e5e7eb"}`, borderRadius:10, fontSize:14, outline:"none" }}
                  />
                  {errors[`qty_${idx}`] && <p style={{ color:"#ef4444", fontSize:11, margin:"4px 0 0", fontWeight:600 }}>⚠️ {errors[`qty_${idx}`]}</p>}
                </div>
              </div>

              {selProd && (
                <div style={{ marginTop:8, fontSize:13, color:"#15803d", fontWeight:700 }}>
                  💵 Subtotal: {fmt(subtotal)}
                  {!isService(selProd) && <span style={{ color:"#1d4ed8", marginLeft:12 }}>📦 Estoque: {stockOf(selProd)}</span>}
                </div>
              )}
            </div>
          );
        })}

        {/* Adicionar item */}
        <button onClick={addItem} style={{ width:"100%", padding:"10px", borderRadius:10, border:"2px dashed #c7d2fe", background:"#f5f3ff", color:"#6366f1", fontWeight:700, fontSize:14, cursor:"pointer", marginBottom:16 }}>
          ➕ Adicionar outro produto
        </button>

        {/* Desconto */}
        <div style={{ background:"#fffbeb", border:"1.5px solid #fde68a", borderRadius:12, padding:14, marginBottom:14 }}>
          <div style={{ fontWeight:700, fontSize:14, marginBottom:10, color:"#92400e" }}>🏷️ Desconto (opcional)</div>
          <div style={{ display:"flex", gap:10 }}>
            <select
              value={form.discountType}
              onChange={e => setForm(f => ({ ...f, discountType: e.target.value, discountValue: "" }))}
              style={{ padding:"10px 12px", borderRadius:10, border:"1.5px solid #fde68a", background:"#fff", fontWeight:700, fontSize:14, outline:"none" }}
            >
              <option value="percent">% Porcentagem</option>
              <option value="value">R$ Valor fixo</option>
            </select>
            <input
              type="number"
              value={form.discountValue}
              onChange={e => setForm(f => ({ ...f, discountValue: e.target.value }))}
              placeholder={form.discountType === "percent" ? "Ex: 10" : "Ex: 5,00"}
              style={{ flex:1, padding:"10px 14px", borderRadius:10, border:`1.5px solid ${errors.discount ? "#ef4444" : "#fde68a"}`, fontSize:14, outline:"none" }}
            />
          </div>
          {errors.discount && <p style={{ color:"#ef4444", fontSize:12, margin:"6px 0 0", fontWeight:600 }}>⚠️ {errors.discount}</p>}
          {discountAmount > 0 && (
            <div style={{ marginTop:8, fontSize:13, color:"#92400e", fontWeight:700 }}>
              Desconto: -{fmt(discountAmount)}
            </div>
          )}
        </div>

        {/* Totais */}
        {grossTotal > 0 && (
          <div style={{ background:"#f0fdf4", border:"1.5px solid #bbf7d0", borderRadius:12, padding:14, marginBottom:14 }}>
            {discountAmount > 0 && <div style={{ fontSize:13, color:"#6b7280", marginBottom:4 }}>Subtotal: {fmt(grossTotal)}</div>}
            {discountAmount > 0 && <div style={{ fontSize:13, color:"#ef4444", marginBottom:4 }}>Desconto: -{fmt(discountAmount)}</div>}
            <div style={{ fontSize:18, fontWeight:800, color:"#15803d" }}>💵 Total: {fmt(netTotal)}</div>
          </div>
        )}

        {/* Data e observação */}
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12, marginBottom:14 }}>
          <div>
            <label style={{ display:"block", fontWeight:600, fontSize:14, marginBottom:5, color:"#374151" }}>Data</label>
            <input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))}
              style={{ width:"100%", padding:"10px 14px", border:`1.5px solid ${errors.date ? "#ef4444" : "#e5e7eb"}`, borderRadius:10, fontSize:14, outline:"none" }} />
            {errors.date && <p style={{ color:"#ef4444", fontSize:12, margin:"4px 0 0", fontWeight:600 }}>⚠️ {errors.date}</p>}
          </div>
          <div>
            <label style={{ display:"block", fontWeight:600, fontSize:14, marginBottom:5, color:"#374151" }}>Observação</label>
            <input type="text" value={form.note} onChange={e => setForm(f => ({ ...f, note: e.target.value }))}
              placeholder="Ex: Pix, cartão..."
              style={{ width:"100%", padding:"10px 14px", border:"1.5px solid #e5e7eb", borderRadius:10, fontSize:14, outline:"none" }} />
          </div>
        </div>

        <div style={{ display:"flex", gap:8 }}>
          <button onClick={save} style={{ background:"#10b981", color:"#fff", border:"none", borderRadius:10, padding:"10px 24px", fontWeight:700, fontSize:15, cursor:"pointer" }}>
            {editing ? "💾 Salvar alterações" : "➕ Registrar venda"}
          </button>
          {editing && (
            <button onClick={cancel} style={{ background:"transparent", color:"#6366f1", border:"2px solid #6366f1", borderRadius:10, padding:"10px 20px", fontWeight:700, fontSize:15, cursor:"pointer" }}>
              Cancelar
            </button>
          )}
        </div>
      </Card>

      {/* Lista de vendas agrupadas */}
      {grouped.length === 0 && (
        <div style={{ textAlign:"center", padding:40, color:"#9ca3af" }}>Nenhuma venda neste período.</div>
      )}

      {grouped.map(({ group, items }) => {
        const gross = items.reduce((s, sale) => {
          const p = products.find(p => p.id === sale.productId);
          return s + (p ? p.price * sale.qty : 0);
        }, 0);
        const discount = items[0]?.discount || 0;
        const dtype = items[0]?.discountType || "percent";
        const discAmt = dtype === "percent" ? gross * (discount / 100) : discount;
        const net = Math.max(0, gross - discAmt);
        const dateStr = items[0]?.date ? new Date(items[0].date + "T12:00:00").toLocaleDateString("pt-BR") : "";
        const note = items[0]?.note || "";

        return (
          <Card key={group}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
              <div style={{ flex:1 }}>
                {/* Itens da venda */}
                {items.map((s, i) => {
                  const p = products.find(x => x.id === s.productId);
                  return (
                    <div key={s.id} style={{ display:"flex", justifyContent:"space-between", marginBottom:i < items.length-1 ? 6 : 0 }}>
                      <span style={{ fontSize:14, color:"#374151" }}>
                        {p ? p.name : "Produto removido"} × {s.qty}
                      </span>
                      <span style={{ fontSize:14, color:"#6b7280" }}>{fmt(p ? p.price * s.qty : 0)}</span>
                    </div>
                  );
                })}

                {/* Desconto */}
                {discAmt > 0 && (
                  <div style={{ display:"flex", justifyContent:"space-between", marginTop:6, color:"#dc2626", fontSize:13, fontWeight:600 }}>
                    <span>🏷️ Desconto {dtype === "percent" ? `(${discount}%)` : ""}</span>
                    <span>-{fmt(discAmt)}</span>
                  </div>
                )}

                {/* Linha divisória + total */}
                <div style={{ borderTop:"1px solid #f3f4f6", marginTop:8, paddingTop:8, display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                  <div style={{ fontSize:12, color:"#9ca3af" }}>
                    📅 {dateStr}
                    {note && <span> · 💬 {note}</span>}
                  </div>
                  <div style={{ fontWeight:800, fontSize:18, color:"#10b981" }}>{fmt(net)}</div>
                </div>
              </div>

              {/* Ações */}
              <div style={{ display:"flex", flexDirection:"column", gap:6, marginLeft:12 }}>
                <button onClick={() => startEdit(group, items)}
                  style={{ background:"transparent", border:"2px solid #6366f1", color:"#6366f1", borderRadius:8, padding:"5px 10px", fontWeight:700, cursor:"pointer", fontSize:12 }}>
                  ✏️
                </button>
                <button onClick={() => setConfirm(group)}
                  style={{ background:"#fee2e2", border:"none", color:"#dc2626", borderRadius:8, padding:"5px 10px", fontWeight:700, cursor:"pointer", fontSize:12 }}>
                  🗑️
                </button>
              </div>
            </div>

            {/* Confirmação de exclusão */}
            {confirm === group && (
              <div style={{ marginTop:10, padding:10, background:"#fee2e2", borderRadius:10, display:"flex", gap:10, alignItems:"center" }}>
                <span style={{ fontSize:13, fontWeight:600 }}>⚠️ Excluir esta venda?</span>
                <button onClick={() => deleteGroup(group)}
                  style={{ background:"#ef4444", color:"#fff", border:"none", borderRadius:8, padding:"5px 12px", fontWeight:700, cursor:"pointer", fontSize:13 }}>
                  Sim
                </button>
                <button onClick={() => setConfirm(null)}
                  style={{ background:"transparent", border:"2px solid #6366f1", color:"#6366f1", borderRadius:8, padding:"5px 12px", fontWeight:700, cursor:"pointer", fontSize:13 }}>
                  Cancelar
                </button>
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────
// Expenses
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
// Pricing — Calculadora de Precificação Detalhada
// ─────────────────────────────────────────────
function Pricing({ products = [], expenses = [], setProducts, fmt }) {
  const today = new Date();
  const currentMonth = today.getMonth() + 1;
  const currentYear = today.getFullYear();

  const NEW_PRODUCT_ID = "__new_product__";

  const getProductId = (product, index) => {
    return product?.id ?? product?._id ?? product?.codigo ?? `produto-${index}`;
  };

  const getProductName = (product, index) => {
    return (
      product?.nome ||
      product?.name ||
      product?.produto ||
      product?.titulo ||
      product?.descricao ||
      product?.description ||
      `Produto ${index + 1}`
    );
  };

  const getProductPrice = (product) => {
    return (
      product?.preco ??
      product?.precoVenda ??
      product?.valor ??
      product?.price ??
      product?.valorVenda ??
      product?.salePrice ??
      0
    );
  };

  const toNumber = (value) => {
    if (value === null || value === undefined || value === "") return 0;

    if (typeof value === "number") {
      return Number.isFinite(value) ? value : 0;
    }

    const normalized = String(value)
      .replace(/\s/g, "")
      .replace("R$", "")
      .replace(/\./g, "")
      .replace(",", ".");

    const parsed = parseFloat(normalized);

    return Number.isFinite(parsed) ? parsed : 0;
  };

  const money = (value) => {
    if (typeof fmt === "function") return fmt(value || 0);

    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
    }).format(value || 0);
  };

  const [selectedProductId, setSelectedProductId] = useState(
    products.length > 0 ? String(getProductId(products[0], 0)) : NEW_PRODUCT_ID
  );

  const [newProductName, setNewProductName] = useState("");
  const [newProductStock, setNewProductStock] = useState("0");

  const [supplies, setSupplies] = useState([]);
  const [supplyName, setSupplyName] = useState("");
  const [supplyCost, setSupplyCost] = useState("");

  const [manualMaterialCost, setManualMaterialCost] = useState("");
  const [packaging, setPackaging] = useState("");
  const [shipping, setShipping] = useState("");
  const [shippingMode, setShippingMode] = useState("fixed");
  const [otherCosts, setOtherCosts] = useState("");

  const [useFixedCosts, setUseFixedCosts] = useState(true);
  const [monthlyUnits, setMonthlyUnits] = useState("10");

  const [laborHours, setLaborHours] = useState("");
  const [hourlyRate, setHourlyRate] = useState("");

  const [margin, setMargin] = useState("30");
  const [taxRate, setTaxRate] = useState("0");

  const [saveMessage, setSaveMessage] = useState("");

  useEffect(() => {
    if (products.length === 0) {
      setSelectedProductId(NEW_PRODUCT_ID);
      return;
    }

    const exists = products.some((product, index) => {
      return String(getProductId(product, index)) === String(selectedProductId);
    });

    if (!exists && selectedProductId !== NEW_PRODUCT_ID) {
      setSelectedProductId(String(getProductId(products[0], 0)));
    }
  }, [products]);

  const selectedProductInfo = useMemo(() => {
    if (selectedProductId === NEW_PRODUCT_ID) return null;

    const index = products.findIndex((product, productIndex) => {
      return String(getProductId(product, productIndex)) === String(selectedProductId);
    });

    if (index < 0) return null;

    return {
      product: products[index],
      index,
      id: getProductId(products[index], index),
      name: getProductName(products[index], index),
      price: toNumber(getProductPrice(products[index])),
    };
  }, [products, selectedProductId]);

  const isNewProduct = selectedProductId === NEW_PRODUCT_ID;

  const monthlyFixedCosts = useMemo(() => {
    return expenses
      .filter((expense) => {
        const category = String(
          expense?.categoria ||
            expense?.category ||
            expense?.tipo ||
            ""
        ).toLowerCase();

        const isFixedCategory = [
          "fixo",
          "fixa",
          "custos fixos",
          "custo fixo",
          "marketing",
          "financeiro",
        ].includes(category);

        const expenseMonth = Number(expense?.mes || expense?.month);
        const expenseYear = Number(expense?.ano || expense?.year);

        const hasMonthAndYear = expenseMonth && expenseYear;

        if (!isFixedCategory) return false;

        if (!hasMonthAndYear) return true;

        return expenseMonth === currentMonth && expenseYear === currentYear;
      })
      .reduce((sum, expense) => {
        return sum + toNumber(expense?.valor ?? expense?.amount ?? expense?.value);
      }, 0);
  }, [expenses]);

  const suppliesTotal = useMemo(() => {
    return supplies.reduce((sum, item) => sum + toNumber(item.cost), 0);
  }, [supplies]);

  const materialTotal = useMemo(() => {
    const manual = toNumber(manualMaterialCost);

    if (suppliesTotal > 0) return suppliesTotal;

    if (manual > 0) return manual;

    return 0;
  }, [suppliesTotal, manualMaterialCost]);

  const packagingTotal = useMemo(() => {
    return toNumber(packaging);
  }, [packaging]);

  const otherCostsTotal = useMemo(() => {
    return toNumber(otherCosts);
  }, [otherCosts]);

  const laborTotal = useMemo(() => {
    return toNumber(laborHours) * toNumber(hourlyRate);
  }, [laborHours, hourlyRate]);

  const unitsPerMonth = useMemo(() => {
    const units = toNumber(monthlyUnits);
    return units > 0 ? units : 1;
  }, [monthlyUnits]);

  const fixedCostPerUnit = useMemo(() => {
    if (!useFixedCosts) return 0;
    if (monthlyFixedCosts <= 0) return 0;

    return monthlyFixedCosts / unitsPerMonth;
  }, [useFixedCosts, monthlyFixedCosts, unitsPerMonth]);

  const subtotalBeforeShipping = useMemo(() => {
    return (
      materialTotal +
      packagingTotal +
      otherCostsTotal +
      laborTotal +
      fixedCostPerUnit
    );
  }, [
    materialTotal,
    packagingTotal,
    otherCostsTotal,
    laborTotal,
    fixedCostPerUnit,
  ]);

  const shippingTotal = useMemo(() => {
    const value = toNumber(shipping);

    if (shippingMode === "percent") {
      return subtotalBeforeShipping * (value / 100);
    }

    return value;
  }, [shipping, shippingMode, subtotalBeforeShipping]);

  const totalCost = useMemo(() => {
    return subtotalBeforeShipping + shippingTotal;
  }, [subtotalBeforeShipping, shippingTotal]);

  const marginPercent = useMemo(() => {
    return toNumber(margin);
  }, [margin]);

  const taxPercent = useMemo(() => {
    return toNumber(taxRate);
  }, [taxRate]);

  const suggestedPrice = useMemo(() => {
    const deductions = (marginPercent + taxPercent) / 100;

    if (deductions >= 1) return 0;

    return totalCost / (1 - deductions);
  }, [totalCost, marginPercent, taxPercent]);

  const grossProfit = useMemo(() => {
    return suggestedPrice - totalCost;
  }, [suggestedPrice, totalCost]);

  const minimumPrice = useMemo(() => {
    const basicMargin = 15 / 100;
    const taxes = taxPercent / 100;
    const deductions = basicMargin + taxes;

    if (deductions >= 1) return totalCost;

    return totalCost / (1 - deductions);
  }, [totalCost, taxPercent]);

  const idealPrice = suggestedPrice;
  const premiumPrice = suggestedPrice * 1.35;

  const projectedRevenue = suggestedPrice * unitsPerMonth;
  const projectedCosts = totalCost * unitsPerMonth;
  const projectedProfit = projectedRevenue - projectedCosts;

  const addSupply = () => {
    const name = supplyName.trim();
    const cost = toNumber(supplyCost);

    if (!name) {
      setSaveMessage("Informe o nome do insumo.");
      return;
    }

    if (cost <= 0) {
      setSaveMessage("Informe o custo do insumo.");
      return;
    }

    const newSupply = {
      id: Date.now(),
      name,
      cost,
    };

    setSupplies((previous) => [...previous, newSupply]);
    setSupplyName("");
    setSupplyCost("");
    setSaveMessage("");
  };

  const removeSupply = (id) => {
    setSupplies((previous) => previous.filter((item) => item.id !== id));
  };

  const clearPricingForm = () => {
    setNewProductName("");
    setNewProductStock("0");
    setSupplies([]);
    setSupplyName("");
    setSupplyCost("");
    setManualMaterialCost("");
    setPackaging("");
    setShipping("");
    setShippingMode("fixed");
    setOtherCosts("");
    setUseFixedCosts(true);
    setMonthlyUnits("10");
    setLaborHours("");
    setHourlyRate("");
    setMargin("30");
    setTaxRate("0");
  };

  const saveSuggestedPrice = () => {
    if (!suggestedPrice || suggestedPrice <= 0) {
      setSaveMessage("Informe os custos corretamente antes de salvar.");
      return;
    }

    if (isNewProduct) {
      const name = newProductName.trim();

      if (!name) {
        setSaveMessage("Informe o nome do novo produto.");
        return;
      }

      const newProduct = {
        id: Date.now(),
        nome: name,
        preco: Number(suggestedPrice.toFixed(2)),
        estoque: toNumber(newProductStock),
        custoMateriaPrima: Number(materialTotal.toFixed(2)),
        custoTotal: Number(totalCost.toFixed(2)),
        insumos: supplies.map((item) => ({
          nome: item.name,
          valor: Number(toNumber(item.cost).toFixed(2)),
        })),
      };

      setProducts((previousProducts) => [...previousProducts, newProduct]);

      setSaveMessage(
        `Produto "${name}" criado com preço sugerido de ${money(suggestedPrice)}.`
      );

      clearPricingForm();

      setTimeout(() => {
        setSaveMessage("");
      }, 3500);

      return;
    }

    if (!selectedProductInfo) {
      setSaveMessage("Selecione um produto para salvar o preço.");
      return;
    }

    setProducts((previousProducts) =>
      previousProducts.map((product, index) => {
        const currentId = String(getProductId(product, index));

        if (currentId !== String(selectedProductId)) return product;

        return {
          ...product,
          preco: Number(suggestedPrice.toFixed(2)),
          precoVenda: product?.precoVenda !== undefined
            ? Number(suggestedPrice.toFixed(2))
            : product?.precoVenda,
          custoMateriaPrima: Number(materialTotal.toFixed(2)),
          custoTotal: Number(totalCost.toFixed(2)),
          insumos: supplies.map((item) => ({
            nome: item.name,
            valor: Number(toNumber(item.cost).toFixed(2)),
          })),
        };
      })
    );

    setSaveMessage(
      `Preço de ${money(suggestedPrice)} salvo em ${selectedProductInfo.name}.`
    );

    setTimeout(() => {
      setSaveMessage("");
    }, 3500);
  };

  return (
    <div style={{ paddingBottom: 24 }}>
      <div style={{ marginBottom: 16 }}>
        <h2 style={{ margin: "0 0 6px", fontSize: 22, fontWeight: 800 }}>
          🧮 Precificação
        </h2>

        <p style={{ margin: 0, color: "#6b7280", fontSize: 14 }}>
          Calcule o preço ideal considerando insumos, embalagem, frete,
          mão de obra, custos fixos, impostos e margem de lucro.
        </p>
      </div>

      <Card>
        <h3 style={{ marginTop: 0, fontSize: 16, fontWeight: 800 }}>
          📦 Produto para precificar
        </h3>

        <label style={{ display: "grid", gap: 6 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: "#374151" }}>
            Escolha um produto cadastrado ou crie uma nova precificação
          </span>

          <select
            value={selectedProductId}
            onChange={(event) => {
              setSelectedProductId(event.target.value);
              setSaveMessage("");
            }}
            style={{
              width: "100%",
              padding: "12px 14px",
              borderRadius: 12,
              border: "1px solid #d1d5db",
              background: "#fff",
              fontSize: 14,
            }}
          >
            <option value={NEW_PRODUCT_ID}>➕ Novo produto / nova precificação</option>

            {products.map((product, index) => {
              const id = String(getProductId(product, index));
              const name = getProductName(product, index);
              const price = toNumber(getProductPrice(product));

              return (
                <option key={id} value={id}>
                  {name} — preço atual: {money(price)}
                </option>
              );
            })}
          </select>
        </label>

        {isNewProduct ? (
          <div
            style={{
              marginTop: 14,
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
              gap: 14,
            }}
          >
            <label style={{ display: "grid", gap: 6 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: "#374151" }}>
                Nome do novo produto
              </span>

              <input
                value={newProductName}
                onChange={(event) => setNewProductName(event.target.value)}
                placeholder="Ex: Vela aromática lavanda"
                style={{
                  width: "100%",
                  padding: "12px 14px",
                  borderRadius: 12,
                  border: "1px solid #d1d5db",
                  fontSize: 14,
                }}
              />
            </label>

            <label style={{ display: "grid", gap: 6 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: "#374151" }}>
                Estoque inicial
              </span>

              <input
                value={newProductStock}
                onChange={(event) => setNewProductStock(event.target.value)}
                placeholder="Ex: 10"
                inputMode="numeric"
                style={{
                  width: "100%",
                  padding: "12px 14px",
                  borderRadius: 12,
                  border: "1px solid #d1d5db",
                  fontSize: 14,
                }}
              />
            </label>
          </div>
        ) : selectedProductInfo ? (
          <div
            style={{
              marginTop: 14,
              padding: 12,
              borderRadius: 12,
              background: "#f8fafc",
              border: "1px solid #e5e7eb",
              fontSize: 13,
              color: "#4b5563",
            }}
          >
            <strong>{selectedProductInfo.name}</strong>
            <br />
            Preço atual cadastrado:{" "}
            <strong>{money(selectedProductInfo.price)}</strong>
            {selectedProductInfo.product?.estoque !== undefined && (
              <>
                <br />
                Estoque atual:{" "}
                <strong>{selectedProductInfo.product.estoque}</strong>
              </>
            )}
          </div>
        ) : null}
      </Card>

      <Card>
        <h3 style={{ marginTop: 0, fontSize: 16, fontWeight: 800 }}>
          🧵 Insumos / Matéria-prima
        </h3>

        <p style={{ marginTop: 0, color: "#6b7280", fontSize: 13 }}>
          Adicione todos os insumos usados para produzir uma unidade do produto.
        </p>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "2fr 1fr auto",
            gap: 10,
            alignItems: "end",
          }}
        >
          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: "#374151" }}>
              Nome do insumo
            </span>

            <input
              value={supplyName}
              onChange={(event) => setSupplyName(event.target.value)}
              placeholder="Ex: Cera, pavio, essência..."
              style={{
                width: "100%",
                padding: "12px 14px",
                borderRadius: 12,
                border: "1px solid #d1d5db",
                fontSize: 14,
              }}
            />
          </label>

          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: "#374151" }}>
              Custo
            </span>

            <input
              value={supplyCost}
              onChange={(event) => setSupplyCost(event.target.value)}
              placeholder="Ex: 1,00"
              inputMode="decimal"
              style={{
                width: "100%",
                padding: "12px 14px",
                borderRadius: 12,
                border: "1px solid #d1d5db",
                fontSize: 14,
              }}
            />
          </label>

          <button
            type="button"
            onClick={addSupply}
            style={{
              padding: "12px 16px",
              borderRadius: 12,
              border: "none",
              background: "linear-gradient(135deg, #7c3aed, #4f46e5)",
              color: "#fff",
              fontWeight: 800,
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            ➕ Adicionar
          </button>
        </div>

        {supplies.length > 0 ? (
          <div style={{ marginTop: 16, display: "grid", gap: 8 }}>
            {supplies.map((item) => (
              <div
                key={item.id}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 12,
                  alignItems: "center",
                  padding: 12,
                  borderRadius: 12,
                  background: "#f8fafc",
                  border: "1px solid #e5e7eb",
                }}
              >
                <div>
                  <strong>{item.name}</strong>
                  <div style={{ fontSize: 12, color: "#6b7280" }}>
                    Custo: {money(toNumber(item.cost))}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => removeSupply(item.id)}
                  style={{
                    border: "none",
                    background: "#fee2e2",
                    color: "#991b1b",
                    borderRadius: 10,
                    padding: "8px 10px",
                    fontWeight: 800,
                    cursor: "pointer",
                  }}
                >
                  Remover
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div
            style={{
              marginTop: 14,
              padding: 12,
              borderRadius: 12,
              background: "#fffbeb",
              border: "1px solid #fde68a",
              color: "#92400e",
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            Nenhum insumo adicionado ainda. Exemplo: Cera R$ 1,00, Pavio R$ 1,00,
            Essência R$ 0,10.
          </div>
        )}

        <div
          style={{
            marginTop: 14,
            padding: 12,
            borderRadius: 12,
            background: "#ecfdf5",
            border: "1px solid #bbf7d0",
            color: "#065f46",
            fontWeight: 800,
          }}
        >
          Total de matéria-prima por unidade: {money(suppliesTotal)}
        </div>

        <label style={{ display: "grid", gap: 6, marginTop: 14 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: "#374151" }}>
            Custo manual de matéria-prima
          </span>

          <input
            value={manualMaterialCost}
            onChange={(event) => setManualMaterialCost(event.target.value)}
            placeholder="Use apenas se não quiser cadastrar insumos item por item"
            inputMode="decimal"
            style={{
              width: "100%",
              padding: "12px 14px",
              borderRadius: 12,
              border: "1px solid #d1d5db",
              fontSize: 14,
            }}
          />

          <small style={{ color: "#6b7280" }}>
            Se você adicionar insumos, o sistema usa a soma dos insumos. Se não
            adicionar, usa este valor manual.
          </small>
        </label>
      </Card>

      <Card>
        <h3 style={{ marginTop: 0, fontSize: 16, fontWeight: 800 }}>
          📦 Embalagem & Logística
        </h3>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: 14,
          }}
        >
          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: "#374151" }}>
              Custo da embalagem
            </span>

            <input
              value={packaging}
              onChange={(event) => setPackaging(event.target.value)}
              placeholder="Ex: 1,50"
              inputMode="decimal"
              style={{
                width: "100%",
                padding: "12px 14px",
                borderRadius: 12,
                border: "1px solid #d1d5db",
                fontSize: 14,
              }}
            />
          </label>

          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: "#374151" }}>
              Frete / logística
            </span>

            <div style={{ display: "flex", gap: 8 }}>
              <input
                value={shipping}
                onChange={(event) => setShipping(event.target.value)}
                placeholder={shippingMode === "fixed" ? "Ex: 12,00" : "Ex: 8"}
                inputMode="decimal"
                style={{
                  flex: 1,
                  padding: "12px 14px",
                  borderRadius: 12,
                  border: "1px solid #d1d5db",
                  fontSize: 14,
                }}
              />

              <select
                value={shippingMode}
                onChange={(event) => setShippingMode(event.target.value)}
                style={{
                  padding: "12px 10px",
                  borderRadius: 12,
                  border: "1px solid #d1d5db",
                  background: "#fff",
                  fontSize: 13,
                  fontWeight: 700,
                }}
              >
                <option value="fixed">R$ fixo</option>
                <option value="percent">% custo</option>
              </select>
            </div>
          </label>
        </div>

        <label style={{ display: "grid", gap: 6, marginTop: 14 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: "#374151" }}>
            Outros custos diretos
          </span>

          <input
            value={otherCosts}
            onChange={(event) => setOtherCosts(event.target.value)}
            placeholder="Ex: taxas de marketplace, comissão, etiqueta..."
            inputMode="decimal"
            style={{
              width: "100%",
              padding: "12px 14px",
              borderRadius: 12,
              border: "1px solid #d1d5db",
              fontSize: 14,
            }}
          />
        </label>
      </Card>

      <Card>
        <h3 style={{ marginTop: 0, fontSize: 16, fontWeight: 800 }}>
          🧾 Custos Fixos Rateados
        </h3>

        <div
          style={{
            padding: 12,
            borderRadius: 12,
            background: "#f5f3ff",
            border: "1px solid #ddd6fe",
            color: "#4c1d95",
            fontSize: 13,
            fontWeight: 700,
            marginBottom: 14,
          }}
        >
          Custos fixos detectados: {money(monthlyFixedCosts)}
        </div>

        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            marginBottom: 14,
            cursor: "pointer",
            fontSize: 14,
            fontWeight: 700,
            color: "#374151",
          }}
        >
          <input
            type="checkbox"
            checked={useFixedCosts}
            onChange={(event) => setUseFixedCosts(event.target.checked)}
            style={{ width: 18, height: 18 }}
          />
          Ratear custos fixos neste produto
        </label>

        <label style={{ display: "grid", gap: 6 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: "#374151" }}>
            Unidades produzidas por mês
          </span>

          <input
            value={monthlyUnits}
            onChange={(event) => setMonthlyUnits(event.target.value)}
            placeholder="Ex: 10"
            inputMode="numeric"
            style={{
              width: "100%",
              padding: "12px 14px",
              borderRadius: 12,
              border: "1px solid #d1d5db",
              fontSize: 14,
            }}
          />

          <small style={{ color: "#6b7280" }}>
            Rateio por unidade: <strong>{money(fixedCostPerUnit)}</strong>
          </small>
        </label>
      </Card>

      <Card>
        <h3 style={{ marginTop: 0, fontSize: 16, fontWeight: 800 }}>
          👩‍🏭 Mão de Obra
        </h3>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: 14,
          }}
        >
          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: "#374151" }}>
              Horas trabalhadas por unidade
            </span>

            <input
              value={laborHours}
              onChange={(event) => setLaborHours(event.target.value)}
              placeholder="Ex: 2"
              inputMode="decimal"
              style={{
                width: "100%",
                padding: "12px 14px",
                borderRadius: 12,
                border: "1px solid #d1d5db",
                fontSize: 14,
              }}
            />
          </label>

          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: "#374151" }}>
              Valor por hora
            </span>

            <input
              value={hourlyRate}
              onChange={(event) => setHourlyRate(event.target.value)}
              placeholder="Ex: 15,00"
              inputMode="decimal"
              style={{
                width: "100%",
                padding: "12px 14px",
                borderRadius: 12,
                border: "1px solid #d1d5db",
                fontSize: 14,
              }}
            />

            <small style={{ color: "#6b7280" }}>
              Mão de obra por unidade: <strong>{money(laborTotal)}</strong>
            </small>
          </label>
        </div>
      </Card>

      <Card>
        <h3 style={{ marginTop: 0, fontSize: 16, fontWeight: 800 }}>
          📊 Margem & Impostos
        </h3>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: 14,
          }}
        >
          <label style={{ display: "grid", gap: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: "#374151" }}>
              Margem de lucro desejada
            </span>

            <input
              type="range"
              min="5"
              max="80"
              step="1"
              value={margin}
              onChange={(event) => setMargin(event.target.value)}
              style={{ width: "100%" }}
            />

            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontSize: 12,
                color: "#6b7280",
              }}
            >
              <span>5%</span>
              <strong style={{ color: "#4f46e5", fontSize: 15 }}>{margin}%</strong>
              <span>80%</span>
            </div>
          </label>

          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: "#374151" }}>
              Imposto / taxa
            </span>

            <input
              value={taxRate}
              onChange={(event) => setTaxRate(event.target.value)}
              placeholder="Ex: 6"
              inputMode="decimal"
              style={{
                width: "100%",
                padding: "12px 14px",
                borderRadius: 12,
                border: "1px solid #d1d5db",
                fontSize: 14,
              }}
            />
          </label>
        </div>
      </Card>

      <Card>
        <div
          style={{
            background: "linear-gradient(135deg, #111827, #1f2937)",
            borderRadius: 18,
            padding: 18,
            color: "#fff",
          }}
        >
          <h3 style={{ marginTop: 0, marginBottom: 16, fontSize: 17 }}>
            🎯 Resultado da Precificação
          </h3>

          <div style={{ display: "grid", gap: 8, fontSize: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
              <span>🧵 Matéria-prima / insumos</span>
              <strong>{money(materialTotal)}</strong>
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
              <span>📦 Embalagem</span>
              <strong>{money(packagingTotal)}</strong>
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
              <span>🚚 Frete / logística</span>
              <strong>{money(shippingTotal)}</strong>
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
              <span>👩‍🏭 Mão de obra</span>
              <strong>{money(laborTotal)}</strong>
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
              <span>🧾 Rateio custos fixos</span>
              <strong>{money(fixedCostPerUnit)}</strong>
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
              <span>➕ Outros custos diretos</span>
              <strong>{money(otherCostsTotal)}</strong>
            </div>

            <div
              style={{
                height: 1,
                background: "rgba(255,255,255,.18)",
                margin: "8px 0",
              }}
            />

            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: 12,
                fontSize: 15,
              }}
            >
              <strong>Custo total por unidade</strong>
              <strong style={{ color: "#facc15" }}>{money(totalCost)}</strong>
            </div>
          </div>

          <div
            style={{
              textAlign: "center",
              padding: "16px 10px",
              borderRadius: 16,
              background: "rgba(255,255,255,.08)",
              border: "1px solid rgba(255,255,255,.12)",
              marginTop: 18,
              marginBottom: 16,
            }}
          >
            <div
              style={{
                fontSize: 11,
                textTransform: "uppercase",
                letterSpacing: 1,
                color: "#cbd5e1",
                fontWeight: 800,
                marginBottom: 6,
              }}
            >
              Preço de venda sugerido
            </div>

            <div
              style={{
                fontSize: 36,
                lineHeight: 1.1,
                color: "#4ade80",
                fontWeight: 900,
              }}
            >
              {money(suggestedPrice)}
            </div>

            <div style={{ marginTop: 8, fontSize: 12, color: "#cbd5e1" }}>
              Margem: {marginPercent}% · Imposto/taxa: {taxPercent}% · Lucro por
              unidade: {money(grossProfit)}
            </div>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))",
              gap: 10,
              marginBottom: 16,
            }}
          >
            <div
              style={{
                background: "rgba(255,255,255,.09)",
                border: "1px solid rgba(255,255,255,.12)",
                borderRadius: 14,
                padding: 12,
                textAlign: "center",
              }}
            >
              <div style={{ fontSize: 12, color: "#93c5fd", fontWeight: 800 }}>
                🔵 Mínimo
              </div>
              <div style={{ fontSize: 17, fontWeight: 900 }}>
                {money(minimumPrice)}
              </div>
            </div>

            <div
              style={{
                background: "rgba(255,255,255,.09)",
                border: "1px solid rgba(255,255,255,.12)",
                borderRadius: 14,
                padding: 12,
                textAlign: "center",
              }}
            >
              <div style={{ fontSize: 12, color: "#86efac", fontWeight: 800 }}>
                🟢 Ideal
              </div>
              <div style={{ fontSize: 17, fontWeight: 900 }}>
                {money(idealPrice)}
              </div>
            </div>

            <div
              style={{
                background: "rgba(255,255,255,.09)",
                border: "1px solid rgba(255,255,255,.12)",
                borderRadius: 14,
                padding: 12,
                textAlign: "center",
              }}
            >
              <div style={{ fontSize: 12, color: "#fbbf24", fontWeight: 800 }}>
                ⭐ Premium
              </div>
              <div style={{ fontSize: 17, fontWeight: 900 }}>
                {money(premiumPrice)}
              </div>
            </div>
          </div>

          <div
            style={{
              background: "rgba(255,255,255,.08)",
              border: "1px solid rgba(255,255,255,.12)",
              borderRadius: 16,
              padding: 14,
              marginBottom: 16,
            }}
          >
            <div
              style={{
                textTransform: "uppercase",
                letterSpacing: 1,
                fontSize: 11,
                color: "#cbd5e1",
                marginBottom: 10,
                fontWeight: 800,
              }}
            >
              Projeção mensal — {unitsPerMonth} unidades
            </div>

            <div style={{ display: "grid", gap: 8, fontSize: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                <span>Receita projetada</span>
                <strong style={{ color: "#4ade80" }}>
                  {money(projectedRevenue)}
                </strong>
              </div>

              <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                <span>Custos totais</span>
                <strong style={{ color: "#f87171" }}>
                  {money(projectedCosts)}
                </strong>
              </div>

              <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                <span>Lucro projetado</span>
                <strong style={{ color: "#93c5fd" }}>
                  {money(projectedProfit)}
                </strong>
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={saveSuggestedPrice}
            disabled={!suggestedPrice || suggestedPrice <= 0}
            style={{
              width: "100%",
              padding: "13px 16px",
              borderRadius: 14,
              border: "none",
              background:
                !suggestedPrice || suggestedPrice <= 0
                  ? "#6b7280"
                  : "linear-gradient(135deg, #7c3aed, #4f46e5)",
              color: "#fff",
              fontWeight: 900,
              fontSize: 15,
              cursor:
                !suggestedPrice || suggestedPrice <= 0
                  ? "not-allowed"
                  : "pointer",
            }}
          >
            {isNewProduct
              ? "💾 Criar produto com preço sugerido"
              : "💾 Salvar preço sugerido no produto"}
          </button>

          {saveMessage && (
            <div
              style={{
                marginTop: 12,
                padding: 12,
                borderRadius: 12,
                background: "rgba(34,197,94,.15)",
                border: "1px solid rgba(74,222,128,.35)",
                color: "#bbf7d0",
                fontSize: 13,
                fontWeight: 700,
                textAlign: "center",
              }}
            >
              {saveMessage}
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}




// ─────────────────────────────────────────────
// Reports
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
