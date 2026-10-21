import { normalizeLayout } from './layout.mjs';
import { defaultBarcodeBox } from './label-geometry.mjs';

export const DESIGN_SCHEMA = 'qingyin-design/v1';
export const ELEMENT_TYPES = { text: '文字', barcode: '商品条码', code: 'CODE128', line: '线段', rect: '矩形', ellipse: '圆形', image: '图片', grid: '表格' };
export const DESIGN_SAMPLE = { productSkuId: '900000000001', productSkcId: '800000000001', labelCode: '53711398047', skcSpec: 'Black', skuSpec: '2XL', sourceId: 'DEMO001' };
export const roundMm = value => Math.round(value * 100) / 100;
// The full pattern is only worth its cost when untrusted JSON enters the
// library. During editing the payload cannot change, so a prefix check keeps
// every keystroke and pointer release cheap.
const IMAGE_SRC = /^data:image\/(png|jpeg|webp);base64,[a-z0-9+/]+={0,2}$/i;
const IMAGE_PREFIX = /^data:image\/(png|jpeg|webp);base64,/i;
const numeric = (value, fallback, min, max) => {
  const result = Number(value ?? fallback);
  if (!Number.isFinite(result) || result < min || result > max) throw new Error('元素的位置、尺寸或样式超出允许范围。');
  return result;
};

export function validateDesign(template, width = Number(template.width), height = Number(template.height), { trustImages = false } = {}) {
  if (template.schema !== DESIGN_SCHEMA || !Array.isArray(template.elements) || template.elements.length > 120) throw new Error('可视化模板格式无效，最多添加 120 个元素。');
  if (typeof template.name !== 'string' || !template.name.trim() || template.name.length > 80) throw new Error('请填写 1–80 字的模板名称。');
  const seen = new Set(); let imageBytes = 0;
  const elements = template.elements.map(value => {
    if (!value || !Object.hasOwn(ELEMENT_TYPES, value.type) || !/^[\w-]{1,80}$/.test(value.id || '') || seen.has(value.id)) throw new Error('模板元素类型或编号无效。');
    seen.add(value.id);
    const element = {
      id: value.id, type: value.type, name: String(value.name || ELEMENT_TYPES[value.type]).slice(0, 80),
      x: numeric(value.x, 2, -210, 420), y: numeric(value.y, 2, -210, 420),
      w: numeric(value.w, 20, .2, 420), h: numeric(value.h, 5, .2, 420),
      rotation: numeric(value.rotation, 0, -360, 360), visible: value.visible !== false, locked: value.locked === true,
    };
    if (['text', 'code'].includes(value.type)) {
      if (typeof value.text !== 'string' || value.text.length > 6000) throw new Error('文字最多允许 6000 字。');
      element.text = value.text;
      element.fontSize = numeric(value.fontSize, 2, .5, 20);
      element.fontFamily = ['Arial', 'Microsoft YaHei', 'serif', 'monospace'].includes(value.fontFamily) ? value.fontFamily : 'Arial';
      element.bold = value.bold === true;
      element.align = ['left', 'center', 'right'].includes(value.align) ? value.align : 'left';
      element.lineHeight = numeric(value.lineHeight, 1.2, 1, 3);
    }
    if (['rect', 'ellipse', 'line', 'grid'].includes(value.type)) {
      element.strokeWidth = numeric(value.strokeWidth, .2, .05, 5);
      element.fill = ['#000000', '#ffffff', 'none'].includes(value.fill) ? value.fill : 'none';
      if (value.type === 'grid') { element.rows = numeric(value.rows, 3, 1, 20); element.cols = numeric(value.cols, 3, 1, 20); if (!Number.isInteger(element.rows) || !Number.isInteger(element.cols)) throw new Error('表格行列必须为整数。'); }
    }
    if (value.type === 'image') {
      const pattern = trustImages ? IMAGE_PREFIX : IMAGE_SRC;
      if (typeof value.src !== 'string' || value.src.length > 2800000 || !pattern.test(value.src)) throw new Error('图片必须是本机导入的 PNG/JPEG/WebP，每张不超过 2 MB。');
      imageBytes += value.src.length;
      element.src = value.src;
    }
    return element;
  });
  if (imageBytes > 6500000) throw new Error('模板中的图片合计不能超过约 5 MB。');
  const result = { schema: DESIGN_SCHEMA, kind: 'design', id: String(template.id || `design-${crypto.randomUUID()}`), name: template.name.trim(), width, height, origin: String(template.origin ?? 'China').slice(0, 80), elements };
  if (template.layout !== undefined) result.layout = normalizeLayout(template.layout, width, height);
  return result;
}

export function newElement(type, width = 70, height = 40) {
  const base = { id: `el-${crypto.randomUUID()}`, type, x: 2, y: 2, w: Math.min(30, width - 4), h: 6, rotation: 0, visible: true, locked: false };
  if (type === 'text') Object.assign(base, { text: '双击编辑文字', fontSize: 2, fontFamily: 'Arial', bold: false, align: 'left', lineHeight: 1.2 });
  if (type === 'barcode') Object.assign(base, defaultBarcodeBox(width, height));
  if (type === 'code') Object.assign(base, { text: '{{labelCode}}', w: width - 8, h: 10, fontSize: 2 });
  if (['rect', 'ellipse', 'line', 'grid'].includes(type)) Object.assign(base, { strokeWidth: .2, fill: 'none', h: type === 'line' ? .2 : 10, rows: 3, cols: 3 });
  if (type === 'image') Object.assign(base, { h: 15, src: '' });
  return base;
}

export function createDesign(source) {
  if (source?.kind === 'design') return structuredClone(source);
  const width = source?.width || 70, height = source?.height || 40;
  const result = { schema: DESIGN_SCHEMA, kind: 'design', id: source?.id || `design-${crypto.randomUUID()}`, name: source?.name || '新建标签模板', width, height, origin: source?.origin ?? 'China', elements: [newElement('barcode', width, height)] };
  if (source?.layout) result.layout = structuredClone(source.layout);
  if (source) {
    const text = [source.productName, source.manufacturer && `Manufacturer: ${source.manufacturer}`, source.address, source.responsiblePerson && `Responsible person: ${source.responsiblePerson}`, source.contact, source.warning].filter(Boolean).join('\n');
    if (text) result.elements.unshift({ ...newElement('text', width, height), text, w: width - 4, h: height * .48 - 2, fontSize: 1.7 });
  }
  return validateDesign(result);
}

export function bakeDesignLayout(source) {
  const template = createDesign(source), layout = normalizeLayout(template.layout, template.width, template.height);
  const overall = layout.parts.label;
  for (const element of template.elements) {
    const local = layout.parts[['barcode', 'code'].includes(element.type) ? 'barcode' : 'content'];
    const scale = local.scale * overall.scale / 10000;
    element.x = roundMm((element.x * local.scale / 100 + local.x) * overall.scale / 100 + overall.x);
    element.y = roundMm((element.y * local.scale / 100 + local.y) * overall.scale / 100 + overall.y);
    element.w = roundMm(element.w * scale); element.h = roundMm(element.h * scale);
    if (element.fontSize) element.fontSize = Math.max(.5, Math.min(20, element.fontSize * scale));
    if (element.strokeWidth) element.strokeWidth = Math.max(.05, Math.min(5, element.strokeWidth * scale));
  }
  for (const part of ['label', 'content', 'barcode']) layout.parts[part] = { x: 0, y: 0, scale: 100 };
  template.layout = layout;
  return validateDesign(template);
}

export function designVariables(text, record = DESIGN_SAMPLE, origin = '') {
  const values = { sku: record.productSkuId, skc: record.productSkcId, skuSpec: record.skuSpec, skcSpec: record.skcSpec, sourceId: record.sourceId, labelCode: record.labelCode, origin };
  return String(text || '').replace(/\{\{(sku|skc|skuSpec|skcSpec|sourceId|labelCode|origin)\}\}/g, (_, key) => values[key] || '');
}
