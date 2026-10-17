export function pageType(pathname = location.pathname) {
  if (pathname === '/main/product/label') return 'sku';
  if (pathname === '/main/order-manager/shipping-list') return 'delivery';
  if (/^\/(main\/order-manage|stock\/fully-mgt\/order-manage)(\/|$)/.test(pathname)) return 'purchase';
  return null;
}

function readRowId(row, type) {
  if (type === 'sku') {
    const headers = [...(row.closest('table')?.querySelectorAll('thead th') || document.querySelectorAll('#root th'))];
    const column = headers.findIndex(header => /\bSKU\b/i.test(header.textContent) && !/\bSKC\b/i.test(header.textContent));
    if (column < 0) throw new Error('找不到 SKU 列，请使用手动编号输入。');
    const cell = row.querySelectorAll('td')[column];
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
  const ids = [...new Set(rows.map(row => readRowId(row, type)))];
  const selectionOrder = [...ids].sort((a, b) => (clickOrder.get(a) ?? 1e12) - (clickOrder.get(b) ?? 1e12));
  return { ids, selectionOrder };
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
        const id = readRowId(row, type);
        const checked = row.querySelector('input[type="checkbox"]:checked, [aria-checked="true"], label[class*="CBX_active"], label[class*="CBX_checked"]');
        if (checked) { if (!clickOrder.has(id)) clickOrder.set(id, sequence++); }
        else clickOrder.delete(id);
      } catch { /* Missing page fields are reported when the user reads the selection. */ }
    }, 0);
  };
  document.addEventListener('click', onClick, true);
  return () => document.removeEventListener('click', onClick, true);
}
