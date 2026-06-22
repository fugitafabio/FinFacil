/*******************************
 * FinFácil — Script Completo (Maiúsculas nas abas)
 * Abas existentes (mantidas):
 *  - Produtos(id, nome, tipo, preco, descricao) + stock, stockUpdatedAt
 *  - Vendas(id, productId, qty, data, nota, mes, ano) + orderId
 *  - Despesas(id, descricao, categoria, valor, data, mes, ano)
 *
 * Novas abas (criadas se não existirem):
 *  - Pedidos
 *  - PedidoItens
 *  - EstoqueMov
 *******************************/

const FINFACIL = {
  tz: Session.getScriptTimeZone() || 'America/Sao_Paulo',
  sheets: {
    produtos: 'Produtos',
    vendas: 'Vendas',
    despesas: 'Despesas',
    pedidos: 'Pedidos',
    pedidoItens: 'PedidoItens',
    estoqueMov: 'EstoqueMov',
  },
  headers: {
    produtos: ['id', 'nome', 'tipo', 'preco', 'descricao', 'stock', 'stockUpdatedAt'],
    vendas: ['id', 'orderId', 'productId', 'qty', 'data', 'nota', 'mes', 'ano'],
    despesas: ['id', 'descricao', 'categoria', 'valor', 'data', 'mes', 'ano'],
    pedidos: [
      'id', 'data', 'status',
      'discountType', 'discountValue',
      'paymentMethod', 'nota',
      'createdAt', 'updatedAt'
    ],
    pedidoItens: ['id', 'orderId', 'productId', 'qty', 'unitPrice', 'nota'],
    estoqueMov: ['id', 'data', 'productId', 'qty', 'reason', 'refId', 'nota'],
  }
};

/** ============ MENU ============ */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('FinFácil')
    .addItem('✅ Checar/Atualizar Estrutura', 'ffEnsureStructure')
    .addSeparator()
    .addItem('➕ Criar Pedido (prompt)', 'ffPromptCreateOrder')
    .addItem('📦 Ajuste de Estoque (prompt)', 'ffPromptStockAdjust')
    .addSeparator()
    .addItem('🔄 Recalcular estoque (a partir de movimentos)', 'ffRebuildStockFromMovements')
    .addToUi();
}

/** Wrapper para garantir estrutura */
function ffEnsureStructure() {
  ensureStructure_();
  SpreadsheetApp.getUi().alert('Estrutura OK: abas/colunas verificadas e ajustadas.');
}

/** ============ ESTRUTURA ============ */
function ensureStructure_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // Garante/cria abas
  Object.values(FINFACIL.sheets).forEach((name) => {
    if (!ss.getSheetByName(name)) ss.insertSheet(name);
  });

  // Reorganiza/garante headers (mantém dados e colunas extras ao final)
  ensureHeadersReordered_(ss.getSheetByName(FINFACIL.sheets.produtos), FINFACIL.headers.produtos);
  ensureHeadersReordered_(ss.getSheetByName(FINFACIL.sheets.vendas), FINFACIL.headers.vendas);
  ensureHeadersReordered_(ss.getSheetByName(FINFACIL.sheets.despesas), FINFACIL.headers.despesas);
  ensureHeadersReordered_(ss.getSheetByName(FINFACIL.sheets.pedidos), FINFACIL.headers.pedidos);
  ensureHeadersReordered_(ss.getSheetByName(FINFACIL.sheets.pedidoItens), FINFACIL.headers.pedidoItens);
  ensureHeadersReordered_(ss.getSheetByName(FINFACIL.sheets.estoqueMov), FINFACIL.headers.estoqueMov);
}

/**
 * Reorganiza a linha de cabeçalhos para ficar exatamente na ordem de expectedHeaders.
 * - Preserva todas as colunas existentes (extras vão para o final).
 * - Mantém todos os dados sem perder nada.
 * - Cria colunas faltantes (vazias) quando necessário.
 */
function ensureHeadersReordered_(sheet, expectedHeaders) {
  if (!sheet) throw new Error('Sheet não encontrada.');

  const lastCol = Math.max(sheet.getLastColumn(), 1);
  const lastRow = Math.max(sheet.getLastRow(), 1);

  // Lê headers atuais
  const currentHeaders = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(v => String(v || '').trim());
  const allEmpty = currentHeaders.every(h => !h);

  // Se vazio, só escreve os headers esperados
  if (allEmpty) {
    ensureColumnsCount_(sheet, expectedHeaders.length);
    sheet.getRange(1, 1, 1, expectedHeaders.length).setValues([expectedHeaders]);
    sheet.setFrozenRows(1);
    return;
  }

  // Identifica colunas extras (não previstas)
  const expectedSet = new Set(expectedHeaders);
  const extraHeaders = currentHeaders.filter(h => h && !expectedSet.has(h));

  // Headers alvo = esperados + extras existentes (na ordem original)
  const targetHeaders = expectedHeaders.concat(extraHeaders);

  // Garante quantidade de colunas suficiente
  ensureColumnsCount_(sheet, targetHeaders.length);

  const dataRows = Math.max(0, lastRow - 1);
  let srcData = [];
  if (dataRows > 0) {
    srcData = sheet.getRange(2, 1, dataRows, lastCol).getValues();
  }

  // Mapa header -> índice atual (0-based)
  const idxMap = {};
  currentHeaders.forEach((h, i) => { if (h) idxMap[h] = i; });

  // Monta nova matriz de dados, reordenando colunas
  const newData = dataRows > 0
    ? Array.from({ length: dataRows }, () => Array(targetHeaders.length).fill(''))
    : [];

  targetHeaders.forEach((h, j) => {
    const srcIdx = (h in idxMap) ? idxMap[h] : -1;
    if (srcIdx >= 0 && dataRows > 0) {
      for (let r = 0; r < dataRows; r++) {
        newData[r][j] = srcData[r][srcIdx];
      }
    }
  });

  // Escreve headers e dados reordenados
  sheet.getRange(1, 1, 1, targetHeaders.length).setValues([targetHeaders]);
  if (dataRows > 0) {
    sheet.getRange(2, 1, dataRows, targetHeaders.length).setValues(newData);
  }
  sheet.setFrozenRows(1);
}

/** Garante que a planilha tenha pelo menos "cols" colunas */
function ensureColumnsCount_(sheet, cols) {
  const maxCols = sheet.getMaxColumns();
  if (maxCols < cols) {
    sheet.insertColumnsAfter(maxCols, cols - maxCols);
  }
}

/** ============ UTILITÁRIOS ============ */
function nowISO_() {
  return new Date().toISOString();
}

function makeId_(prefix) {
  const rand = Math.random().toString(16).slice(2, 8);
  return `${prefix}_${Date.now()}_${rand}`;
}

function toDate_(input) {
  if (input instanceof Date) return input;
  if (typeof input === 'number') return new Date(input);
  if (typeof input === 'string' && input.trim()) {
    const s = input.trim();
    const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m) return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
    const m2 = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (m2) return new Date(Number(m2[1]), Number(m2[2]) - 1, Number(m2[3]));
    const d = new Date(s);
    if (!isNaN(d.getTime())) return d;
  }
  return new Date();
}

function monthYear_(date) {
  const d = toDate_(date);
  return { mes: d.getMonth() + 1, ano: d.getFullYear() };
}

function getHeaderIndexMap_(sheet) {
  const lastCol = Math.max(sheet.getLastColumn(), 1);
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(v => String(v || '').trim());
  const map = {};
  headers.forEach((h, i) => { if (h) map[h] = i + 1; });
  return map;
}

function appendRowByHeaders_(sheet, headerMap, obj) {
  const row = [];
  Object.keys(headerMap).forEach((h) => {
    row[headerMap[h] - 1] = (h in obj) ? obj[h] : '';
  });
  sheet.appendRow(row);
}

function findRowByValue_(sheet, headerName, value) {
  const map = getHeaderIndexMap_(sheet);
  const col = map[headerName];
  if (!col) throw new Error(`Header "${headerName}" não encontrado em ${sheet.getName()}`);

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;

  const values = sheet.getRange(2, col, lastRow - 1, 1).getValues().flat();
  const idx = values.findIndex(v => String(v) === String(value));
  if (idx === -1) return null;
  return 2 + idx;
}

/** ============ PRODUTOS / ESTOQUE ============ */
function getProductById_(productId) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(FINFACIL.sheets.produtos);
  const map = getHeaderIndexMap_(sheet);
  const row = findRowByValue_(sheet, 'id', productId);
  if (!row) return null;

  const get = (h) => sheet.getRange(row, map[h]).getValue();
  return {
    row,
    id: get('id'),
    nome: get('nome'),
    tipo: get('tipo'),
    preco: Number(get('preco') || 0),
    descricao: get('descricao'),
    stock: Number(get('stock') || 0),
    stockUpdatedAt: get('stockUpdatedAt')
  };
}

function setProductStock_(productId, newStock) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(FINFACIL.sheets.produtos);
  const map = getHeaderIndexMap_(sheet);
  const row = findRowByValue_(sheet, 'id', productId);
  if (!row) throw new Error(`Produto não encontrado: ${productId}`);

  sheet.getRange(row, map['stock']).setValue(Number(newStock));
  sheet.getRange(row, map['stockUpdatedAt']).setValue(nowISO_());
}

function addStockMovement_(movement) {
  // movement: {date, productId, qty, reason, refId, nota}
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(FINFACIL.sheets.estoqueMov);
  const map = getHeaderIndexMap_(sheet);

  const id = makeId_('mov');
  appendRowByHeaders_(sheet, map, {
    id,
    data: toDate_(movement.date),
    productId: movement.productId,
    qty: Number(movement.qty || 0),
    reason: movement.reason || '',
    refId: movement.refId || '',
    nota: movement.nota || ''
  });

  return id;
}

/** Reconstrói o stock em Produtos somando EstoqueMov */
function ffRebuildStockFromMovements() {
  ensureStructure_();

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const shMov = ss.getSheetByName(FINFACIL.sheets.estoqueMov);
  const shProd = ss.getSheetByName(FINFACIL.sheets.produtos);

  const movMap = getHeaderIndexMap_(shMov);
  const prodMap = getHeaderIndexMap_(shProd);

  const movLast = shMov.getLastRow();
  const prodLast = shProd.getLastRow();

  // zera stock
  if (prodLast >= 2) {
    shProd.getRange(2, prodMap.stock, prodLast - 1, 1).setValue(0);
    shProd.getRange(2, prodMap.stockUpdatedAt, prodLast - 1, 1).setValue(nowISO_());
  }

  if (movLast < 2 || prodLast < 2) {
    SpreadsheetApp.getUi().alert('Rebuild concluído (sem dados suficientes).');
    return;
  }

  const movData = shMov.getRange(2, 1, movLast - 1, shMov.getLastColumn()).getValues();
  const movHeaders = shMov.getRange(1, 1, 1, shMov.getLastColumn()).getValues()[0].map(h => String(h||'').trim());

  const colIndex = (name) => movHeaders.indexOf(name);
  const iProductId = colIndex('productId');
  const iQty = colIndex('qty');

  const sums = {};
  movData.forEach(r => {
    const pid = String(r[iProductId] || '').trim();
    const q = Number(r[iQty] || 0);
    if (!pid) return;
    sums[pid] = (sums[pid] || 0) + q;
  });

  const prodIds = shProd.getRange(2, prodMap.id, prodLast - 1, 1).getValues().flat().map(v => String(v||'').trim());
  prodIds.forEach((pid, idx) => {
    if (!pid) return;
    const stock = Number(sums[pid] || 0);
    const row = 2 + idx;
    shProd.getRange(row, prodMap.stock).setValue(stock);
    shProd.getRange(row, prodMap.stockUpdatedAt).setValue(nowISO_());
  });

  SpreadsheetApp.getUi().alert('Rebuild de estoque concluído.');
}

/** ============ PEDIDOS / VENDAS ============ */
/**
 * Cria um pedido + itens.
 * items: [{productId, qty, unitPrice?, nota?}]
 * opts: {date, status, discountType, discountValue, paymentMethod, nota}
 *
 * Efeitos:
 * - escreve em Pedidos
 * - escreve em PedidoItens
 * - escreve em Vendas (1 linha por item) com orderId
 * - gera EstoqueMov (saída) e atualiza stock em Produtos
 */
function createOrder_(items, opts) {
  ensureStructure_();

  if (!Array.isArray(items) || items.length === 0) throw new Error('Pedido precisa de ao menos 1 item.');

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const shPedidos = ss.getSheetByName(FINFACIL.sheets.pedidos);
  const shItens = ss.getSheetByName(FINFACIL.sheets.pedidoItens);
  const shVendas = ss.getSheetByName(FINFACIL.sheets.vendas);

  const pedidosMap = getHeaderIndexMap_(shPedidos);
  const itensMap = getHeaderIndexMap_(shItens);
  const vendasMap = getHeaderIndexMap_(shVendas);

  const orderId = makeId_('ord');
  const date = toDate_(opts?.date || new Date());
  const status = opts?.status || 'CONFIRMADO';

  // 1) grava pedido
  appendRowByHeaders_(shPedidos, pedidosMap, {
    id: orderId,
    data: date,
    status,
    discountType: opts?.discountType || '',
    discountValue: Number(opts?.discountValue || 0),
    paymentMethod: opts?.paymentMethod || '',
    nota: opts?.nota || '',
    createdAt: nowISO_(),
    updatedAt: nowISO_(),
  });

  const { mes, ano } = monthYear_(date);

  // 2) itens + vendas + estoque
  items.forEach((it) => {
    const pid = String(it.productId || '').trim();
    const qty = Number(it.qty || 0);
    if (!pid) throw new Error('Item sem productId.');
    if (!qty || qty <= 0) throw new Error(`Qty inválida para productId=${pid}: ${qty}`);

    const prod = getProductById_(pid);
    if (!prod) throw new Error(`Produto não encontrado: ${pid}`);

    const unitPrice = (it.unitPrice != null && it.unitPrice !== '')
      ? Number(it.unitPrice)
      : Number(prod.preco || 0);

    const itemId = makeId_('item');

    // PedidoItens
    appendRowByHeaders_(shItens, itensMap, {
      id: itemId,
      orderId,
      productId: pid,
      qty,
      unitPrice,
      nota: it.nota || ''
    });

    // Vendas (1 linha por item)
    const vendaId = makeId_('ven');
    appendRowByHeaders_(shVendas, vendasMap, {
      id: vendaId,
      orderId,
      productId: pid,
      qty,
      data: date,
      nota: opts?.nota || it.nota || '',
      mes,
      ano
    });

    // EstoqueMov (saída)
    addStockMovement_({
      date,
      productId: pid,
      qty: -Math.abs(qty),
      reason: 'VENDA',
      refId: orderId,
      nota: opts?.nota || ''
    });

    // Atualiza stock do produto
    const newStock = Number(prod.stock || 0) - Math.abs(qty);
    setProductStock_(pid, newStock);
  });

  return orderId;
}

/** ============ PROMPTS ============ */
function ffPromptCreateOrder() {
  ensureStructure_();
  const ui = SpreadsheetApp.getUi();

  const r1 = ui.prompt(
    'Criar Pedido',
    'Itens (formato): productId:qty, productId:qty\nEx: p1:2,p3:1',
    ui.ButtonSet.OK_CANCEL
  );
  if (r1.getSelectedButton() !== ui.Button.OK) return;

  const itemsStr = r1.getResponseText().trim();
  const items = itemsStr.split(',').map(s => s.trim()).filter(Boolean).map(pair => {
    const [productId, qtyStr] = pair.split(':').map(x => (x || '').trim());
    return { productId, qty: Number(qtyStr) };
  });

  const r2 = ui.prompt('Criar Pedido', 'Nota (opcional):', ui.ButtonSet.OK_CANCEL);
  if (r2.getSelectedButton() !== ui.Button.OK) return;
  const nota = r2.getResponseText().trim();

  const orderId = createOrder_(items, { nota, status: 'CONFIRMADO', date: new Date() });
  ui.alert(`Pedido criado: ${orderId}`);
}

function ffPromptStockAdjust() {
  ensureStructure_();
  const ui = SpreadsheetApp.getUi();

  const r1 = ui.prompt('Ajuste de Estoque', 'ProductId:', ui.ButtonSet.OK_CANCEL);
  if (r1.getSelectedButton() !== ui.Button.OK) return;
  const productId = r1.getResponseText().trim();

  const r2 = ui.prompt('Ajuste de Estoque', 'Quantidade (use negativo para saída):', ui.ButtonSet.OK_CANCEL);
  if (r2.getSelectedButton() !== ui.Button.OK) return;
  const qty = Number(r2.getResponseText().trim());

  const r3 = ui.prompt('Ajuste de Estoque', 'Motivo (ex.: AJUSTE, COMPRA, PERDA):', ui.ButtonSet.OK_CANCEL);
  if (r3.getSelectedButton() !== ui.Button.OK) return;
  const reason = r3.getResponseText().trim() || 'AJUSTE';

  const r4 = ui.prompt('Ajuste de Estoque', 'Nota (opcional):', ui.ButtonSet.OK_CANCEL);
  if (r4.getSelectedButton() !== ui.Button.OK) return;
  const nota = r4.getResponseText().trim();

  const prod = getProductById_(productId);
  if (!prod) throw new Error(`Produto não encontrado: ${productId}`);

  addStockMovement_({
    date: new Date(),
    productId,
    qty,
    reason,
    refId: '',
    nota
  });

  setProductStock_(productId, Number(prod.stock || 0) + Number(qty || 0));
  ui.alert('Ajuste lançado e estoque atualizado.');
}
