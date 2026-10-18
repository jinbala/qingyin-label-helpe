import { mkdir, writeFile } from 'node:fs/promises';
import { installDom } from './dom-runtime.mjs';
import { createLabelRenderer, toMonochrome } from '../src/printing/render.mjs';
import { createDesign, newElement } from '../src/core/design.mjs';
import { normalizeLayout } from '../src/core/layout.mjs';
import { previewDpi } from '../src/ui/preview-quality.mjs';
import { localRecords } from './fixtures/local-template.mjs';

const dom = installDom();
await import('../vendor/JsBarcode.all.min.js'); globalThis.JsBarcode = window.JsBarcode;
try {
  const template = createDesign();
  const text = newElement('text', 70, 40);
  Object.assign(text, { x: 3, y: 2, w: 64, h: 17, fontSize: 1.4, lineHeight: 1.16, text: 'For sample only\nManufacturer: Example Studio Limited\nAddress: First Floor, 123 Sample Street, Example City\nElectronic address: labels@example.com\n\nExample contact information for preview verification' });
  template.elements.unshift(text);
  const render = await createLabelRenderer(template, { cacheLabelBase: true });
  const old = await render(localRecords[0], { dpi: 180 }), mono = toMonochrome(old), context = old.getContext('2d');
  const pixels = context.createImageData(old.width, old.height), stride = Math.ceil(old.width / 8);
  for (let y = 0; y < old.height; y++) for (let x = 0; x < old.width; x++) {
    const value = mono.packed[y * stride + (x >> 3)] & (128 >> (x & 7)) ? 255 : 0, offset = (y * old.width + x) * 4;
    pixels.data[offset] = pixels.data[offset + 1] = pixels.data[offset + 2] = value; pixels.data[offset + 3] = 255;
  }
  context.putImageData(pixels, 0, 0);
  const viewport = { width: 816, height: 528 }, dpi = previewDpi(template, viewport, 1);
  const clear = await render(localRecords[0], { dpi });
  const comparison = document.createElement('canvas'); comparison.width = 1680; comparison.height = 540;
  const paint = comparison.getContext('2d'); paint.fillStyle = '#e9edf3'; paint.fillRect(0, 0, comparison.width, comparison.height);
  paint.font = '20px Arial'; paint.fillStyle = '#18273d';
  paint.fillText(`Before: ${old.width} px, hard black/white`, 16, 30);
  paint.fillText(`After: ${clear.width} px, smooth text edges`, 848, 30);
  paint.drawImage(old, 16, 50, 816, 816 * 40 / 70); paint.drawImage(clear, 848, 50, 816, 816 * 40 / 70);
  const iterations = 20, highDpi = previewDpi(template, viewport, 2), started = performance.now();
  for (let i = 0; i < iterations; i++) {
    const canvas = await render(localRecords[0], { dpi: highDpi, layout: normalizeLayout({ parts: { label: { x: i / 10 } } }) }); canvas.width = 1;
  }
  const result = { environment: 'Node + jsdom + native canvas; not real Chrome timing', viewport, old: { dpi: 180, width: old.width }, improved: { dpi, width: clear.width }, highDensity: { pixelRatio: 2, dpi: highDpi, iterations, milliseconds: Math.round(performance.now() - started) } };
  const out = new URL('../docs/validation/', import.meta.url); await mkdir(out, { recursive: true });
  await writeFile(new URL('preview-quality-comparison.png', out), Buffer.from(comparison.toDataURL().split(',')[1], 'base64'));
  await writeFile(new URL('preview-quality.json', out), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally { dom.window.close(); }
