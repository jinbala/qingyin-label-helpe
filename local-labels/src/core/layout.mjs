export const LAYOUT_PARTS = {
  label: '整张标签', content: '上方文字', barcode: '条码区域整体',
  skc: 'SKC 编号', color: '颜色 / 主规格', size: '尺码 / 次规格',
  sku: 'SKU 编号', origin: '产地文字', bars: '条码线条', frame: '条码边框',
};

export function normalizeLayout(value = {}, width = 210, height = 210) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || (value.version !== undefined && value.version !== 1)) throw new Error('位置设置格式无效。');
  const input = value.parts ?? {};
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !Object.hasOwn(LAYOUT_PARTS, key))) throw new Error('位置设置包含不支持的调整部分。');
  const parts = {};
  for (const key of Object.keys(LAYOUT_PARTS)) {
    const raw = input[key] ?? {};
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('位置设置格式无效。');
    const x = Number(raw.x ?? 0), y = Number(raw.y ?? 0), scale = Number(raw.scale ?? 100);
    if (![x, y, scale].every(Number.isFinite) || Math.abs(x) > width || Math.abs(y) > height || scale < 50 || scale > 150) throw new Error('偏移不能超过标签宽高，缩放范围为 50–150%。');
    parts[key] = { x, y, scale };
  }
  return { version: 1, parts };
}

export function isDefaultAdjustment(part) { return !part.x && !part.y && part.scale === 100; }

export function dragParentScale(layout, part) {
  if (part === 'label') return 1;
  const labelScale = layout.parts.label.scale / 100;
  return ['content', 'barcode'].includes(part) ? labelScale : labelScale * layout.parts.barcode.scale / 100;
}
