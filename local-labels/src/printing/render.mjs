import { makeJobs, validateTemplate } from '../core/core.mjs';
import { normalizeLayout, isDefaultAdjustment } from '../core/layout.mjs';
import { designVariables } from '../core/design.mjs';
import { designSvg } from './design-svg.mjs';
import { encodeCode128 } from './code128.mjs';
import { fitLines } from './text-fit.mjs';
import { defaultBarcodeBox, BARCODE_FRAME_MM } from '../core/label-geometry.mjs';

const MM_TO_PT = 72 / 25.4;
const FONT = 'Arial, "Microsoft YaHei", "Noto Sans SC", sans-serif';
// Our barcode layout uses a fixed 700 x 185 coordinate space: a heading row,
// a CODE128 slot with ten-module quiet zones, and a footer row. Callers size
// the region from these constants instead of rendering it once to measure it.
export const BARCODE_VIEW_WIDTH = 700;
export const BARCODE_VIEW_HEIGHT = 185;
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

export function barcodeSvg(record, origin, JsBarcode = globalThis.JsBarcode, { layout, unitMm = 25.4 / 300, unitMmY = unitMm, padding = 0 } = {}) {
  const adjustments = normalizeLayout(layout).parts;
  const transform = (part, x, y) => {
    const adjustment = adjustments[part];
    return isDefaultAdjustment(adjustment) ? '' : ` transform="translate(${adjustment.x / unitMm} ${adjustment.y / unitMmY}) translate(${x} ${y}) scale(${adjustment.scale / 100}) translate(${-x} ${-y})"`;
  };
  // Our layout uses a fixed 700 x 185 coordinate space: a heading row,
  // a CODE128 slot with ten-module quiet zones, and a footer row.
  const width = BARCODE_VIEW_WIDTH, height = BARCODE_VIEW_HEIGHT, barsTop = 46, barsHeight = 106;
  const barcode = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  encodeCode128(barcode, record.labelCode, { format: 'CODE128', width: 1, height: barsHeight, margin: 0, displayValue: false }, JsBarcode);
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

// The separator sheet uses the paper size of the chosen template: a frame,
// two heavy bars and the warning text between them.
function renderSeparator(template, dpi) {
  const width = Math.round(template.width / 25.4 * dpi), height = Math.round(template.height / 25.4 * dpi);
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  const mm = dpi / 25.4;
  context.fillStyle = 'white'; context.fillRect(0, 0, width, height);
  context.fillStyle = 'black'; context.strokeStyle = 'black';
  const margin = Math.max(1, 2 * mm), stroke = Math.max(1, 0.3 * mm);
  context.lineWidth = stroke;
  context.strokeRect(margin, margin, width - margin * 2, height - margin * 2);
  const barHeight = Math.max(stroke * 2, height * 0.14), barInset = margin + width * 0.045, barWidth = width - barInset * 2;
  context.fillRect(barInset, margin + height * 0.10, barWidth, barHeight);
  context.fillRect(barInset, height - margin - height * 0.10 - barHeight, barWidth, barHeight);
  const text = '前后规格不同，请不要贴错', maxWidth = width - margin * 2 - 4 * mm;
  let size = Math.min(height * 0.24, 12 * mm);
  const setFont = value => { context.font = `bold ${value.toFixed(2)}px ${FONT}`; };
  setFont(size);
  while (size > 1 * mm && context.measureText(text).width > maxWidth) { size *= 0.95; setFont(size); }
  context.textAlign = 'center'; context.textBaseline = 'middle';
  context.fillText(text, width / 2, height / 2);
  return canvas;
}

async function renderSimple(template, record, { dpi, separator, signal }) {
  if (separator) return renderSeparator(template, dpi);
  const layout = normalizeLayout(template.layout, template.width, template.height);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(template.width / 25.4 * dpi);
  canvas.height = Math.round(template.height / 25.4 * dpi);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.fillStyle = 'white'; context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = 'black'; context.textBaseline = 'top';
  const content = layout.parts.content, contentScale = content.scale / 100;
  // The context is scaled below, so wrapping and the height check must work in
  // the same scaled coordinate space; otherwise 120–150% clips the text.
  const margin = 2 / 25.4 * dpi;
  const usableWidth = (canvas.width - margin * 2) / contentScale;
  const fields = [template.productName, template.manufacturer && `Manufacturer: ${template.manufacturer}`,
    template.address, template.responsiblePerson && `Responsible person: ${template.responsiblePerson}`,
    template.contact, template.warning].filter(Boolean).map(text => designVariables(text, record, template.origin));
  const textHeight = (canvas.height * 0.48 - margin) / contentScale;
  let size = Math.max(12, dpi / 15), lines;
  do {
    context.font = `${size}px ${FONT}`;
    lines = fields.flatMap(text => fitLines(context, text, usableWidth));
    if (lines.length * size * 1.35 <= textHeight) break;
    size -= dpi / 150;
  } while (size >= dpi / 28);
  if (lines.length * size * 1.35 > textHeight) throw new Error('模板文字超出标签上半区，请减少文字或增大纸张尺寸。');
  context.save();
  context.translate(content.x / 25.4 * dpi, content.y / 25.4 * dpi); context.scale(contentScale, contentScale);
  lines.forEach((line, index) => context.fillText(line, margin, margin + index * size * 1.35));
  context.restore();
  // The region occupies the fixed 700 x 185 barcode coordinate space, so its
  // scale comes from constants rather than from a throwaway measuring render.
  const box = defaultBarcodeBox(template.width, template.height);
  const scale = Math.min(box.w / BARCODE_VIEW_WIDTH, box.h / BARCODE_VIEW_HEIGHT) * dpi / 25.4;
  const unitMm = scale * 25.4 / dpi;
  const svg = barcodeSvg(record, template.origin, globalThis.JsBarcode, { layout, unitMm });
  // Rasterize vectors on the paper's fixed pixel grid. Extra space for moved
  // text must never shift barcode bars onto a different sampling grid.
  const region = layout.parts.barcode;
  const raster = `<svg xmlns="http://www.w3.org/2000/svg" width="${canvas.width}" height="${canvas.height}" viewBox="0 0 ${canvas.width} ${canvas.height}"><g transform="translate(${(box.x + region.x) / 25.4 * dpi} ${(box.y + region.y) / 25.4 * dpi}) scale(${scale * region.scale / 100})">${svg}</g></svg>`;
  const url = URL.createObjectURL(new Blob([raster], { type: 'image/svg+xml' }));
  try {
    const image = await imageFromUrl(url, signal);
    context.drawImage(image, 0, 0);
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
    const svg = designSvg({ ...template, elements }, record, barcodeSvg, { background: false })
      .replace(`width="${template.width}" height="${template.height}"`, `width="${width}" height="${height}"`);
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    try { context.drawImage(await imageFromUrl(url, config.signal), 0, 0, width, height); }
    finally { URL.revokeObjectURL(url); }
  };
  // Composite raster images directly, preserving their order between SVG runs.
  // This avoids depending on nested-image support in different SVG decoders.
  const content = normalizeLayout(template.layout, template.width, template.height).parts.content;
  let run = [];
  for (const element of template.elements) {
    if (!element.visible) continue;
    if (element.type !== 'image') { run.push(element); continue; }
    await paintVectors(run); run = [];
    const image = images.get(element.src), scale = Math.min(element.w / image.naturalWidth, element.h / image.naturalHeight);
    context.save(); context.scale(config.dpi / 25.4, config.dpi / 25.4); context.translate(content.x, content.y); context.scale(content.scale / 100, content.scale / 100);
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
    if (source) { bases.delete(key); bases.set(key, source); } // refresh recency for the eviction order
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
  const payload = new Uint8Array(await compressed);
  const dictionary = pdf.context.obj({ Type: 'XObject', Subtype: 'Image', Width: image.width, Height: image.height, ColorSpace: 'DeviceGray', BitsPerComponent: 1, Filter: 'FlateDecode' });
  return { ref: pdf.context.register(globalThis.PDFLib.PDFRawStream.of(dictionary, payload)), bytes: payload.length };
}

export function appendImagePage(pdf, imageRef, widthMm, heightMm) {
  const lib = globalThis.PDFLib, width = widthMm * MM_TO_PT, height = heightMm * MM_TO_PT;
  const page = pdf.addPage([width, height]), name = page.node.newXObject('Label', imageRef);
  page.pushOperators(lib.pushGraphicsState(), lib.concatTransformationMatrix(width, 0, 0, height, 0, 0), lib.drawObject(name), lib.popGraphicsState());
}

// The message channel refuses PDFs over 12 MB. Estimate before rendering so a
// large run fails in milliseconds instead of minutes, then keep checking the
// real compressed size while embedding as a hard guarantee.
export const PDF_LIMIT_BYTES = 12 * 1024 * 1024;
export const PDF_PREFLIGHT_BYTES = 10 * 1024 * 1024;
export const PDF_BUILD_BUDGET_BYTES = 11.5 * 1024 * 1024;
const PAGE_OVERHEAD_BYTES = 200;
const megabyte = bytes => `${(bytes / 1024 / 1024).toFixed(1)} MB`;
const LIMIT_HINT = '请减少不同 SKU 的数量、改用 300 DPI，或分批打印。';

const labelKey = record => JSON.stringify([record.labelCode, record.productSkuId, record.productSkcId, record.fulfilmentProductSkuId, record.skuExtCode, record.skuSpec, record.skcSpec, record.sourceId]);

export function estimatePdfBytes(template, jobs, pages, dpi) {
  const unique = new Set();
  for (const job of jobs) unique.add(job.separator ? 'separator' : labelKey(job.record));
  const pixels = Math.ceil(template.width / 25.4 * dpi) * Math.ceil(template.height / 25.4 * dpi);
  const hasImages = template.kind === 'design' && (template.elements || []).some(element => element.type === 'image' && element.visible !== false);
  // Measured on simple labels: ~2.7 KB at 300 DPI and ~5.8 KB at 600 DPI.
  // Photo-heavy designs are bounded by their packed bitmap because dithered
  // noise barely compresses.
  const perLabel = hasImages ? Math.ceil(pixels / 8 * .85) : dpi === 600 ? 7 * 1024 : 3.5 * 1024;
  return Math.ceil(unique.size * perLabel * 1.3 + pages * PAGE_OVERHEAD_BYTES);
}

export async function generatePdf({ records, template, separators = false, batchSeparators = false, dpi = 300, signal, onProgress = () => {} }) {
  template = validateTemplate(template);
  dpi = Number(dpi);
  if (![300, 600].includes(dpi)) throw new Error('请选择 300 或 600 DPI。');
  const { jobs, pages } = makeJobs(records, separators, batchSeparators);
  const estimate = estimatePdfBytes(template, jobs, pages, dpi);
  if (estimate > PDF_PREFLIGHT_BYTES) throw new Error(`PDF 体积预计约 ${megabyte(estimate)}，超过 12 MB 上限。${LIMIT_HINT}`);
  const render = await createLabelRenderer(template, { signal });
  const pdf = await globalThis.PDFLib.PDFDocument.create();
  pdf.setTitle('合规标签'); pdf.setCreator('轻印标签助手');
  const cache = new Map();
  let completed = 0, embedded = 0, lastYield = Date.now(), lastProgress = -1, lastProgressAt = 0;
  // Yield on a time budget instead of once per job: a timer round trip costs up
  // to 4 ms in a browser once nesting kicks in, which adds up over large runs.
  const breathe = async () => {
    if (Date.now() - lastYield < 8) return;
    signal?.throwIfAborted();
    await yieldFrame(); lastYield = Date.now();
  };
  // Updating the DOM once per job can mean ten thousand writes on large runs.
  const report = () => {
    const percent = Math.min(95, Math.round(completed / pages * 95)), now = Date.now();
    if (completed < pages && (percent === lastProgress || now - lastProgressAt < 100)) return;
    lastProgress = percent; lastProgressAt = now;
    onProgress({ percent, completed, pages });
  };
  for (const job of jobs) {
    signal?.throwIfAborted();
    const { record } = job;
    const key = job.separator ? 'separator' : labelKey(record);
    if (!cache.has(key)) {
      const canvas = await render(record, { dpi, separator: job.separator, signal });
      const embeddedImage = await embedMonochrome(pdf, toMonochrome(canvas));
      embedded += embeddedImage.bytes;
      if (embedded + (completed + job.quantity) * PAGE_OVERHEAD_BYTES > PDF_BUILD_BUDGET_BYTES) {
        throw new Error(`PDF 体积已超过 12 MB（约 ${megabyte(embedded)}），生成已停止。${LIMIT_HINT}`);
      }
      cache.set(key, embeddedImage.ref);
      canvas.width = 1; canvas.height = 1;
    }
    for (let i = 0; i < job.quantity; i++) {
      appendImagePage(pdf, cache.get(key), template.width, template.height);
      completed++;
      if (completed % 50 === 0) await breathe();
    }
    report();
    await breathe();
  }
  signal?.throwIfAborted();
  const bytes = await pdf.save();
  signal?.throwIfAborted();
  onProgress({ percent: 100, completed: pages, pages });
  return { bytes, pages, images: cache.size };
}
