export function pageType(pathname = location.pathname) {
  if (pathname === '/main/product/label') return 'sku';
  if (pathname === '/main/order-manager/shipping-list') return 'delivery';
  if (/^\/(main\/order-manage|stock\/fully-mgt\/order-manage)(\/|$)/.test(pathname)) return 'purchase';
  return null;
}

// A checked row on the delivery page is a 发货批次 (batch) row, not a single
// 发货单: the batch and logistics cells use rowspan and the remaining 发货单
// rows are plain siblings without their own checkbox. Reading one ID per row
// therefore printed only the first delivery order of each batch.
const DELIVERY_SN = /(?<![A-Za-z])FH[-\s]?([A-Za-z0-9]{6,})/gi;
const DELIVERY_LABEL = /发货单[号码]?[：:\s]*([A-Za-z0-9_-]{6,})/g;

function deliveryGroupRows(row) {
  const rows = [row, ...row.querySelectorAll('tr')];
  let covered = 0;
  for (const cell of row.cells || []) covered = Math.max(covered, (cell.rowSpan || 1) - 1);
  for (let next = row.nextElementSibling; next && covered > 0; next = next.nextElementSibling) {
    // A following row that carries its own checkbox starts the next batch.
    if (next.querySelector('input[type="checkbox"], [role="checkbox"], td[class*="TB_checkCell"], label[class*="CBX_checkbox"]')) break;
    rows.push(next); covered -= 1;
  }
  return rows;
}

function deliveryIdsIn(element) {
  const ids = [], text = element.textContent || '';
  for (const match of text.matchAll(DELIVERY_LABEL)) ids.push(match[1]);
  for (const match of text.matchAll(DELIVERY_SN)) ids.push(match[0].replace(/\s+/g, ''));
  return ids;
}

function deliveryRowIds(row) {
  const ids = new Set();
  for (const item of deliveryGroupRows(row)) {
    // Read cell by cell: joined row text glues neighbouring cells together
    // ("…574FH2610…"), which hides the start of the next delivery number.
    for (const target of item.cells?.length ? [...item.cells] : [item]) {
      for (const id of deliveryIdsIn(target)) ids.add(id);
    }
  }
  return [...ids];
}

function skuColumnIndex(row) {
  const table = row.closest('table');
  const headers = [...(table ? table.querySelectorAll('thead th') : document.querySelectorAll('#root th'))];
  return headers.findIndex(header => /\bSKU\b/i.test(header.textContent) && !/\bSKC\b/i.test(header.textContent));
}

// Resolved once per read: selecting a hundred rows must not rescan the header a hundred times.
function skuColumnReader(root) {
  const cache = new Map();
  return row => {
    const key = row.closest('table') || root;
    if (!cache.has(key)) cache.set(key, skuColumnIndex(row));
    return cache.get(key);
  };
}

function readRowIds(row, type, column) {
  if (type === 'delivery') {
    const ids = deliveryRowIds(row);
    if (ids.length) return ids;
  }
  return [readRowId(row, type, column)];
}

function readRowId(row, type, column) {
  if (type === 'sku') {
    const index = column === undefined ? skuColumnIndex(row) : column;
    if (index < 0) throw new Error('找不到 SKU 列，请使用手动编号输入。');
    const cell = row.querySelectorAll('td')[index];
    const match = cell?.textContent.match(/\d{4,}/);
    if (!match) throw new Error('勾选行中未找到 SKU ID。');
    return match[0];
  }
  if (type === 'delivery') {
    const node = row.querySelector('div[class*="order-status-tag_main"]');
    const text = node?.parentElement?.children?.[0]?.textContent.trim();
    if (text && /^[\w-]{1,80}$/.test(text)) return text;
  }
  const copy = row.querySelector('div[class*="copy-text_copy"]');
  const value = copy?.previousSibling?.textContent.trim();
  if (value && /^[\w-]{1,80}$/.test(value)) return value;
  // Explicit labelled fields are safe to read; arbitrary numbers elsewhere in a row are not.
  const label = type === 'delivery' ? /发货单[号：:\s]*([A-Za-z0-9_-]+)/ : /备货单[号：:\s]*([A-Za-z0-9_-]+)/;
  const match = row.textContent.match(label);
  if (match) return match[1];
  throw new Error(`未找到${type === 'delivery' ? '发货' : '备货'}单号，请使用手动编号输入。`);
}

export function selectedRows(root = document) {
  return [...root.querySelectorAll('#root tbody tr')].filter(row =>
    row.querySelector('input[type="checkbox"]:checked, [role="checkbox"][aria-checked="true"], label[class*="CBX_active"], label[class*="CBX_checked"]'),
  );
}

export function readSelected(type, clickOrder = new Map(), root = document) {
  const rows = selectedRows(root);
  if (!rows.length) throw new Error('请先勾选当前页中的订单或商品，或手动输入编号。');
  // One group per selected row: on the delivery page a row is a whole 发货批次,
  // so the groups let later steps tell batches apart (and separate them).
  const column = type === 'sku' ? skuColumnReader(root) : undefined;
  const groups = rows.map(row => readRowIds(row, type, column?.(row)));
  const ids = [...new Set(groups.flat())];
  const selectionOrder = [...ids].sort((a, b) => (clickOrder.get(a) ?? 1e12) - (clickOrder.get(b) ?? 1e12));
  return { ids, selectionOrder, groups };
}

export function trackSelections(clickOrder) {
  let sequence = 0;
  const onClick = event => {
    const target = event.target;
    if (!(target instanceof Element) || !target.closest('input[type="checkbox"], [role="checkbox"], label[class*="CBX_checkbox"]')) return;
    const row = target.closest('#root tbody tr'), type = pageType();
    if (!row || !type) return;
    setTimeout(() => {
      try {
        const ids = readRowIds(row, type);
        const checked = row.querySelector('input[type="checkbox"]:checked, [aria-checked="true"], label[class*="CBX_active"], label[class*="CBX_checked"]');
        for (const id of ids) {
          if (checked) { if (!clickOrder.has(id)) clickOrder.set(id, sequence++); }
          else clickOrder.delete(id);
        }
      } catch { /* Missing page fields are reported when the user reads the selection. */ }
    }, 0);
  };
  document.addEventListener('click', onClick, true);
  return () => document.removeEventListener('click', onClick, true);
}
