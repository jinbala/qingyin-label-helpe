import { makeJobs, validateTemplate } from '../core/core.mjs';
import { normalizeLayout, isDefaultAdjustment } from '../core/layout.mjs';
import { designSvg } from './design-svg.mjs';
import { defaultBarcodeBox, BARCODE_FRAME_MM } from '../core/label-geometry.mjs';

const MM_TO_PT = 72 / 25.4;
const FONT = 'Arial, "Microsoft YaHei", "Noto Sans SC", sans-serif';
const yieldFrame = () => new Promise(resolve => setTimeout(resolve, 0));
const fontReadiness = new WeakMap();
function waitForFonts() {
  const fonts = document.fonts;
  if (!fonts) return Promise.resolve();
  if (!fontReadiness.has(fonts)) fontReadiness.set(fonts, new Promise(resolve => {
    const timer = setTimeout(resolve, 8000);
    Promise.resolve(fonts.ready).then(() => { clearTimeout(timer); resolve(); }, () => { clearTimeout(timer); resolve(); });
  }));
  return fontReadiness.get(fonts);
}
const xml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]);

function imageFromUrl(url, signal) {
  return new Promise((resolve, reject) => {
    signal?.throwIfAborted();
    const image = new Image();
    const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); };
    const abort = () => { cleanup(); image.src = ''; reject(new DOMException('已取消', 'AbortError')); };
    const timer = setTimeout(() => { cleanup(); image.src = ''; reject(new Error('标签图片加载超时。')); }, 20000);
    signal?.addEventListener('abort', abort, { once: true });
    image.onload = () => { cleanup(); resolve(image); };
    image.onerror = () => { cleanup(); reject(new Error('标签图片加载失败。')); };
    image.src = url;
  });
}

function variables(text, record) {
  const values = { sku: record.productSkuId, skc: record.productSkcId, skuSpec: record.skuSpec, skcSpec: record.skcSpec, sourceId: record.sourceId };
  return String(text || '').replace(/\{\{(sku|skc|skuSpec|skcSpec|sourceId)\}\}/g, (_, key) => values[key] || '');
}

export function barcodeSvg(record, origin, JsBarcode = globalThis.JsBarcode, { layout, unitMm = 25.4 / 300, unitMmY = unitMm, padding = 0 } = {}) {
  const adjustments = normalizeLayout(layout).parts;
  const transform = (part, x, y) => {
    const adjustment = adjustments[part];
    return isDefaultAdjustment(adjustment) ? '' : ` transform="translate(${adjustment.x / unitMm} ${adjustment.y / unitMmY}) translate(${x} ${y}) scale(${adjustment.scale / 100}) translate(${-x} ${-y})"`;
  };
  // Our layout uses a fixed 700 x 185 coordinate space: a heading row,
  // a CODE128 slot with ten-module quiet zones, and a footer row.
  const width = 700, height = 185, barsTop = 46, barsHeight = 106;
  const barcode = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  JsBarcode(barcode, String(record.labelCode), { format: 'CODE128', width: 1, height: barsHeight, margin: 0, displayValue: false });
  const bars = barcode.querySelector('g');
  const barsWidth = parseFloat(barcode.getAttribute('width'));
  if (!bars || !Number.isFinite(barsWidth) || barsWidth < 1 || barsWidth > 2000) throw new Error('条码尺寸无效或内容过长。');
  const moduleScale = (width - 52) / (barsWidth + 20), barsLeft = 26 + 10 * moduleScale;
  const font = 'Arial, Helvetica, sans-serif', fontSize = 21;
  const context = document.createElement('canvas').getContext('2d');
  context.font = `bold ${fontSize}px ${font}`;
  const leftTop = String(record.skuExtCode || record.productSkcId || ''), rightTop = String(record.skuSpec || '');
  const leftBottom = String(record.fulfilmentProductSkuId || record.productSkuId || '');
  const rightBottom = origin ? `Made In ${origin}` : '', centerTop = String(record.skcSpec || '');
  const measure = text => context.measureText(text).width;
  const roles = { lt: 'skc', lb: 'sku', rt: 'size', rb: 'origin', tc: 'color' };
  const text = (value, x, y, role, available, anchor = 'start') => {
    if (!value) return '';
    const size = Math.min(fontSize, fontSize * available / Math.max(1, measure(value)));
    if (size < 9) throw new Error('编号或规格文字过长，请简化内容或单独调整标签。');
    return `<text data-role="${role}" x="${x}" y="${y}"${transform(roles[role], x, y)} font-family="${font}" font-size="${size}" font-weight="bold" text-anchor="${anchor}">${xml(value)}</text>`;
  };
  const group = bars.cloneNode(true); group.removeAttribute('transform');
  const stroke = Math.max(BARCODE_FRAME_MM / unitMm, BARCODE_FRAME_MM / unitMmY), inset = stroke / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width + padding * 2}" height="${height + padding * 2}" viewBox="${-padding} ${-padding} ${width + padding * 2} ${height + padding * 2}" overflow="visible">
    <rect width="${width}" height="${height}" fill="white"/>
    <rect data-role="frame" x="${inset}" y="${inset}" width="${width - stroke}" height="${height - stroke}"${transform('frame', inset, inset)} fill="none" stroke="black" stroke-width="${stroke}"/>
    <g data-role="bars"${transform('bars', barsLeft, barsTop)}><g transform="translate(${barsLeft} ${barsTop}) scale(${moduleScale} 1)">${new XMLSerializer().serializeToString(group)}</g></g>
    ${text(leftTop, 14, 33, 'lt', 220)}${text(centerTop, 350, 33, 'tc', 250, 'middle')}${text(rightTop, 686, 33, 'rt', 90, 'end')}
    ${text(leftBottom, 14, 175, 'lb', 320)}${text(rightBottom, 686, 175, 'rb', 300, 'end')}</svg>`;
}

function adjustmentPadding(layout, template, unitMm) {
  return ['skc', 'color', 'size', 'sku', 'origin', 'bars', 'frame'].some(key => !isDefaultAdjustment(layout.parts[key]))
    ? Math.ceil(Math.max(template.width, template.height) / unitMm) : 0;
}

function wrapText(context, text, maxWidth) {
  const lines = [];
  for (const paragraph of String(text).split('\n')) {
    let line = '';
    for (const char of paragraph) {
      if (line && context.measureText(line + char).width > maxWidth) { lines.push(line); line = ''; }
      line += char;
    }
    lines.push(line);
  }
  return lines;
}

async function renderSimple(template, record, { dpi, separator, signal }) {
  const layout = normalizeLayout(template.layout, template.width, template.height);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(template.width / 25.4 * dpi);
  canvas.height = Math.round(template.height / 25.4 * dpi);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.fillStyle = 'white'; context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = 'black'; context.textBaseline = 'top';
  const margin = 2 / 25.4 * dpi, usableWidth = canvas.width - margin * 2;
  if (separator) {
    const fontSize = Math.max(12, dpi / 12);
    context.font = `bold ${fontSize}px ${FONT}`;
    const lines = wrapText(context, '前后规格不同，请不要贴错', usableWidth);
    lines.forEach((line, index) => context.fillText(line, margin, canvas.height / 2 - lines.length * fontSize / 2 + index * fontSize * 1.35));
    return canvas;
  }
  const fields = [template.productName, template.manufacturer && `Manufacturer: ${template.manufacturer}`,
    template.address, template.responsiblePerson && `Responsible person: ${template.responsiblePerson}`,
    template.contact, template.warning].filter(Boolean).map(text => variables(text, record));
  const textHeight = canvas.height * 0.48 - margin;
  let size = Math.max(12, dpi / 15), lines;
  do {
    context.font = `${size}px ${FONT}`;
    lines = fields.flatMap(text => wrapText(context, text, usableWidth));
    if (lines.length * size * 1.35 <= textHeight) break;
    size -= dpi / 150;
  } while (size >= dpi / 28);
  if (lines.length * size * 1.35 > textHeight) throw new Error('模板文字超出标签上半区，请减少文字或增大纸张尺寸。');
  context.save();
  const content = layout.parts.content;
  context.translate(content.x / 25.4 * dpi, content.y / 25.4 * dpi); context.scale(content.scale / 100, content.scale / 100);
  lines.forEach((line, index) => context.fillText(line, margin, margin + index * size * 1.35));
  context.restore();
  const initialSvg = barcodeSvg(record, template.origin);
  const dimensions = new DOMParser().parseFromString(initialSvg, 'image/svg+xml').documentElement;
  const naturalWidth = Number(dimensions.getAttribute('width')), naturalHeight = Number(dimensions.getAttribute('height'));
  const box = defaultBarcodeBox(template.width, template.height);
  const scale = Math.min(box.w / naturalWidth, box.h / naturalHeight) * dpi / 25.4;
  const unitMm = scale * 25.4 / dpi, padding = adjustmentPadding(layout, template, unitMm);
  const svg = barcodeSvg(record, template.origin, globalThis.JsBarcode, { layout, unitMm, padding });
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    const image = await imageFromUrl(url, signal);
    const region = layout.parts.barcode;
    context.save();
    context.translate((box.x + region.x) / 25.4 * dpi, (box.y + region.y) / 25.4 * dpi);
    context.scale(region.scale / 100, region.scale / 100);
    context.drawImage(image, -padding * scale, -padding * scale, image.naturalWidth * scale, image.naturalHeight * scale); context.restore();
  } finally { URL.revokeObjectURL(url); }
  return canvas;
}

async function renderDesign(template, record, config, images) {
  if (config.separator) return renderSimple(template, record, config);
  const width = Math.round(template.width / 25.4 * config.dpi), height = Math.round(template.height / 25.4 * config.dpi);
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.fillStyle = 'white'; context.fillRect(0, 0, width, height);
  const paintVectors = async elements => {
    if (!elements.length) return;
    config.signal?.throwIfAborted();
    const svg = designSvg({ ...template, elements }, record, barcodeSvg)
      .replace(`width="${template.width}" height="${template.height}"`, `width="${width}" height="${height}"`)
      .replace('<rect width="100%" height="100%" fill="white"/>', '');
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    try { context.drawImage(await imageFromUrl(url, config.signal), 0, 0, width, height); }
    finally { URL.revokeObjectURL(url); }
  };
  // Composite raster images directly, preserving their order between SVG runs.
  // This avoids depending on nested-image support in different SVG decoders.
  let run = [];
  for (const element of template.elements) {
    if (!element.visible) continue;
    if (element.type !== 'image') { run.push(element); continue; }
    await paintVectors(run); run = [];
    const image = images.get(element.src), scale = Math.min(element.w / image.naturalWidth, element.h / image.naturalHeight);
    const part = normalizeLayout(template.layout, template.width, template.height).parts.content;
    context.save(); context.scale(config.dpi / 25.4, config.dpi / 25.4); context.translate(part.x, part.y); context.scale(part.scale / 100, part.scale / 100);
    context.translate(element.x + element.w / 2, element.y + element.h / 2); context.rotate(element.rotation * Math.PI / 180);
    context.drawImage(image, -image.naturalWidth * scale / 2, -image.naturalHeight * scale / 2, image.naturalWidth * scale, image.naturalHeight * scale); context.restore();
  }
  await paintVectors(run); return canvas;
}

export async function createLabelRenderer(template, { signal, cacheLabelBase = false } = {}) {
  template = validateTemplate(template);
  await waitForFonts();
  const images = new Map(); let decodedPixels = 0;
  for (const element of template.elements || []) if (element.type === 'image' && !images.has(element.src)) {
    const image = await imageFromUrl(element.src, signal);
    decodedPixels += image.naturalWidth * image.naturalHeight;
    if (image.naturalWidth > 4096 || image.naturalHeight > 4096 || decodedPixels > 20000000) throw new Error('模板图片像素过大，请缩小图片后重试。');
    images.set(element.src, image);
  }
  const bases = new Map();
  const copy = source => {
    const canvas = document.createElement('canvas'); canvas.width = source.width; canvas.height = source.height;
    canvas.getContext('2d', { willReadFrequently: true }).drawImage(source, 0, 0); return canvas;
  };
  return async (record, options = {}) => {
    const config = { dpi: 300, ...options, signal: options.signal || signal };
    config.signal?.throwIfAborted();
    const effective = options.layout ? { ...template, layout: normalizeLayout(options.layout, template.width, template.height) } : template;
    const layout = normalizeLayout(effective.layout, template.width, template.height);
    const adjustment = layout.parts.label;
    const localParts = { ...layout.parts, label: { x: 0, y: 0, scale: 100 } };
    const key = cacheLabelBase ? JSON.stringify([record, config.dpi, Boolean(config.separator), localParts]) : null;
    let source = key ? bases.get(key) : undefined;
    if (!source) {
      source = await (template.kind === 'design' ? renderDesign(effective, record, config, images) : renderSimple(effective, record, config));
      config.signal?.throwIfAborted();
      if (key) { if (bases.size >= 4) bases.delete(bases.keys().next().value); bases.set(key, copy(source)); }
    }
    if (isDefaultAdjustment(adjustment)) return key ? copy(source) : source;
    const canvas = document.createElement('canvas'); canvas.width = source.width; canvas.height = source.height;
    const context = canvas.getContext('2d', { willReadFrequently: true }); context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height);
    context.translate(adjustment.x / 25.4 * config.dpi, adjustment.y / 25.4 * config.dpi);
    context.scale(adjustment.scale / 100, adjustment.scale / 100); context.drawImage(source, 0, 0);
    if (!key) { source.width = 1; source.height = 1; } return canvas;
  };
}

export function toMonochrome(canvas, threshold = 128) {
  const context = canvas.getContext('2d', { willReadFrequently: true });
  const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
  const stride = Math.ceil(canvas.width / 8), packed = new Uint8Array(stride * canvas.height).fill(255);
  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) {
      const offset = (y * canvas.width + x) * 4, alpha = data[offset + 3] / 255;
      const grey = (data[offset] * .299 + data[offset + 1] * .587 + data[offset + 2] * .114) * alpha + 255 * (1 - alpha);
      if (grey < threshold) packed[y * stride + (x >> 3)] &= ~(128 >> (x & 7));
    }
  }
  return { width: canvas.width, height: canvas.height, packed };
}

export async function embedMonochrome(pdf, image) {
  const compressor = new CompressionStream('deflate');
  const writer = compressor.writable.getWriter();
  const compressed = new Response(compressor.readable).arrayBuffer();
  await writer.write(image.packed); await writer.close();
  const dictionary = pdf.context.obj({ Type: 'XObject', Subtype: 'Image', Width: image.width, Height: image.height, ColorSpace: 'DeviceGray', BitsPerComponent: 1, Filter: 'FlateDecode' });
  return pdf.context.register(globalThis.PDFLib.PDFRawStream.of(dictionary, new Uint8Array(await compressed)));
}

export function appendImagePage(pdf, imageRef, widthMm, heightMm) {
  const lib = globalThis.PDFLib, width = widthMm * MM_TO_PT, height = heightMm * MM_TO_PT;
  const page = pdf.addPage([width, height]), name = page.node.newXObject('Label', imageRef);
  page.pushOperators(lib.pushGraphicsState(), lib.concatTransformationMatrix(width, 0, 0, height, 0, 0), lib.drawObject(name), lib.popGraphicsState());
}

export async function generatePdf({ records, template, separators = false, dpi = 300, signal, onProgress = () => {} }) {
  template = validateTemplate(template);
  if (![300, 600].includes(Number(dpi))) throw new Error('请选择 300 或 600 DPI。');
  const { jobs, pages } = makeJobs(records, separators);
  const render = await createLabelRenderer(template, { signal });
  const pdf = await globalThis.PDFLib.PDFDocument.create();
  pdf.setTitle('合规标签'); pdf.setCreator('轻印标签助手');
  const cache = new Map();
  let completed = 0;
  for (const job of jobs) {
    signal?.throwIfAborted();
    const { record } = job;
    const key = job.separator ? 'separator' : JSON.stringify([record.labelCode, record.productSkuId, record.productSkcId, record.fulfilmentProductSkuId, record.skuExtCode, record.skuSpec, record.skcSpec, record.sourceId]);
    if (!cache.has(key)) {
      const canvas = await render(record, { dpi, separator: job.separator, signal });
      cache.set(key, await embedMonochrome(pdf, toMonochrome(canvas)));
      canvas.width = 1; canvas.height = 1;
    }
    for (let i = 0; i < job.quantity; i++) {
      appendImagePage(pdf, cache.get(key), template.width, template.height);
      completed++;
      if (completed % 50 === 0) { signal?.throwIfAborted(); await yieldFrame(); }
    }
    onProgress({ percent: Math.round(completed / pages * 95), completed, pages });
    await yieldFrame();
  }
  signal?.throwIfAborted();
  const bytes = await pdf.save();
  signal?.throwIfAborted();
  onProgress({ percent: 100, completed: pages, pages });
  return { bytes, pages, images: cache.size };
}
