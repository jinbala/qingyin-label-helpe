import { designVariables, DESIGN_SAMPLE } from '../core/design.mjs';
import { normalizeLayout } from '../core/layout.mjs';
import { encodeCode128 } from './code128.mjs';
import { fitLines } from './text-fit.mjs';

const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]);
const metrics = new WeakMap();
function textLines(element, text) {
  if (!metrics.has(document)) metrics.set(document, document.createElement('canvas').getContext('2d'));
  const context = metrics.get(document);
  context.font = `${element.bold ? 'bold ' : ''}${element.fontSize * 10}px "${element.fontFamily}"`;
  return fitLines(context, text, element.w * 10);
}

export function elementMarkup(element, record = DESIGN_SAMPLE, origin = 'China', { barcodeSvg, layout } = {}) {
  const { w, h, type } = element;
  if (type === 'text') {
    const clip = `text-clip-${element.id}`;
    const lines = textLines(element, designVariables(element.text, record, origin));
    const x = element.align === 'center' ? w / 2 : element.align === 'right' ? w : 0;
    const anchor = element.align === 'center' ? 'middle' : element.align === 'right' ? 'end' : 'start';
    return `<defs><clipPath id="${clip}"><rect width="${w}" height="${h}"/></clipPath></defs><text clip-path="url(#${clip})" font-family="${escape(element.fontFamily)}" font-size="${element.fontSize}" font-weight="${element.bold ? 'bold' : 'normal'}" text-anchor="${anchor}" fill="black">${lines.map((line, index) => `<tspan x="${x}" y="${element.fontSize * (.88 + index * element.lineHeight)}">${escape(line)}</tspan>`).join('')}</text>`;
  }
  if (type === 'barcode') {
    const svg = barcodeSvg(record, origin, globalThis.JsBarcode, { layout, unitMm: w / 700, unitMmY: h / 185 });
    return svg.replace(/width="[^"]+" height="[^"]+"/, `width="${w}" height="${h}" preserveAspectRatio="none"`);
  }
  if (type === 'code') {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    encodeCode128(svg, designVariables(element.text, record, origin), { format: 'CODE128', width: 1, height: 50, margin: 10, displayValue: false });
    svg.setAttribute('viewBox', `0 0 ${parseFloat(svg.getAttribute('width'))} ${parseFloat(svg.getAttribute('height'))}`);
    svg.setAttribute('width', w); svg.setAttribute('height', h); svg.setAttribute('preserveAspectRatio', 'none');
    return new XMLSerializer().serializeToString(svg);
  }
  if (type === 'image') return `<image xmlns:xlink="http://www.w3.org/1999/xlink" xlink:href="${escape(element.src)}" width="${w}" height="${h}" preserveAspectRatio="xMidYMid meet"/>`;
  if (type === 'line') return `<line x1="0" y1="${h / 2}" x2="${w}" y2="${h / 2}" stroke="black" stroke-width="${element.strokeWidth}"/>`;
  const attributes = `fill="${element.fill}" stroke="black" stroke-width="${element.strokeWidth}"`;
  if (type === 'ellipse') return `<ellipse cx="${w / 2}" cy="${h / 2}" rx="${Math.max(.01, (w - element.strokeWidth) / 2)}" ry="${Math.max(.01, (h - element.strokeWidth) / 2)}" ${attributes}/>`;
  const box = `<rect x="${element.strokeWidth / 2}" y="${element.strokeWidth / 2}" width="${Math.max(.01, w - element.strokeWidth)}" height="${Math.max(.01, h - element.strokeWidth)}" ${attributes}/>`;
  if (type === 'rect') return box;
  if (type === 'grid') {
    const lines = [];
    for (let i = 1; i < element.rows; i++) lines.push(`<path d="M0 ${h * i / element.rows}H${w}"/>`);
    for (let i = 1; i < element.cols; i++) lines.push(`<path d="M${w * i / element.cols} 0V${h}"/>`);
    return box + `<g stroke="black" stroke-width="${element.strokeWidth}" fill="none">${lines.join('')}</g>`;
  }
  return '';
}

export function designSvg(template, record, barcodeSvg, { background = true } = {}) {
  const layout = normalizeLayout(template.layout, template.width, template.height);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${template.width}" height="${template.height}" viewBox="0 0 ${template.width} ${template.height}">${background ? '<rect width="100%" height="100%" fill="white"/>' : ''}${template.elements.filter(element => element.visible).map(element => {
    const part = layout.parts[['barcode', 'code'].includes(element.type) ? 'barcode' : 'content'];
    return `<g transform="translate(${part.x} ${part.y}) scale(${part.scale / 100})"><g data-element-id="${element.id}" transform="translate(${element.x} ${element.y}) rotate(${element.rotation} ${element.w / 2} ${element.h / 2})">${elementMarkup(element, record, template.origin, { barcodeSvg, layout })}</g></g>`;
  }).join('')}</svg>`;
}
