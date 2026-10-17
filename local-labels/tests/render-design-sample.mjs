import { mkdir, writeFile } from 'node:fs/promises';
import { installDom } from './dom-runtime.mjs';
import PDFLib from '../vendor/pdf-lib.min.js';
import { createDesign, newElement, DESIGN_SAMPLE } from '../src/core/design.mjs';
import { createLabelRenderer, generatePdf } from '../src/printing/render.mjs';

const dom = installDom(); await import('../vendor/JsBarcode.all.min.js');
globalThis.JsBarcode = window.JsBarcode; globalThis.PDFLib = PDFLib;
try {
  const template = createDesign(); template.name = '轻印可视化模板示例';
  template.elements.unshift(
    { ...newElement('text'), x: 2, y: 2, w: 65, h: 15, fontSize: 1.9, text: 'PRODUCT INFORMATION\nManufacturer: Example Studio\nAddress: 123 Sample Street\nContact: labels@example.com\nOrder: {{sourceId}}' },
    { ...newElement('line'), x: 2, y: 17, w: 66, h: .2 },
  );
  const renderer = await createLabelRenderer(template), canvas = await renderer(DESIGN_SAMPLE);
  const out = new URL('../docs/validation/', import.meta.url); await mkdir(out, { recursive: true });
  await writeFile(new URL('designer-label.png', out), Buffer.from(canvas.toDataURL('image/png').split(',')[1], 'base64'));
  await writeFile(new URL('designer-template.json', out), JSON.stringify(template, null, 2));
  const pdf = await generatePdf({ records: [{ ...DESIGN_SAMPLE, quantity: 2 }], template });
  await writeFile(new URL('designer-labels.pdf', out), pdf.bytes);
  console.log(JSON.stringify({ pixels: [canvas.width, canvas.height], pages: pdf.pages, bytes: pdf.bytes.length }));
} finally { dom.window.close(); }
