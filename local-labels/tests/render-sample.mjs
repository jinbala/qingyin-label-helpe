import { mkdir, writeFile } from 'node:fs/promises';
import { installDom } from './dom-runtime.mjs';
import PDFLib from '../vendor/pdf-lib.min.js';
import { createLabelRenderer, generatePdf } from '../src/printing/render.mjs';
import { local7040Template, localRecords } from './fixtures/local-template.mjs';
const dom = installDom();
await import('../vendor/JsBarcode.all.min.js');
globalThis.JsBarcode = window.JsBarcode; globalThis.PDFLib = PDFLib;
try {
  const out = new URL('../docs/validation/', import.meta.url); await mkdir(out, { recursive: true });
  const render = await createLabelRenderer(local7040Template), canvas = await render(localRecords[0]);
  await writeFile(new URL('own-label.png', out), Buffer.from(canvas.toDataURL('image/png').split(',')[1], 'base64'));
  const result = await generatePdf({ records: localRecords, template: local7040Template, separators: true });
  await writeFile(new URL('own-labels.pdf', out), result.bytes);
  await writeFile(new URL('own-template.json', out), JSON.stringify(local7040Template, null, 2));
  console.log(JSON.stringify({ width: canvas.width, height: canvas.height, pages: result.pages, bytes: result.bytes.length }));
} finally { dom.window.close(); }
