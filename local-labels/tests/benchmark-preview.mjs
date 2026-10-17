import { mkdir, writeFile } from 'node:fs/promises';
import { installDom } from './dom-runtime.mjs';
import { createLabelRenderer } from '../src/printing/render.mjs';
import { normalizeLayout } from '../src/core/layout.mjs';
import { local7040Template, localRecords } from './fixtures/local-template.mjs';
const dom = installDom();
await import('../vendor/JsBarcode.all.min.js'); globalThis.JsBarcode = window.JsBarcode;
try {
  const iterations = 20, render = await createLabelRenderer(local7040Template, { cacheLabelBase: true });
  const start = performance.now();
  for (let index = 0; index < iterations; index++) {
    const canvas = await render(localRecords[0], { dpi: 96, layout: normalizeLayout({ parts: { label: { x: index / 10 } } }) });
    canvas.width = 1;
  }
  const result = { environment: 'Node.js + jsdom + native canvas; not real Chrome timing', iterations, milliseconds: Math.round(performance.now() - start), previewDpi: 96, printDpi: [300, 600] };
  const out = new URL('../docs/validation/', import.meta.url); await mkdir(out, { recursive: true });
  await writeFile(new URL('preview-performance.json', out), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally { dom.window.close(); }
