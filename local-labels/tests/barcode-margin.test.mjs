import test from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './dom-runtime.mjs';
import { createDesign, DESIGN_SAMPLE } from '../src/core/design.mjs';
import { defaultTemplates } from '../src/core/templates.mjs';
import { barcodeBounds, insetBarcodeLayout } from '../src/core/label-geometry.mjs';
import { normalizeLayout } from '../src/core/layout.mjs';
import { createLabelRenderer, generatePdf, toMonochrome } from '../src/printing/render.mjs';
import { mountLayoutEditor } from '../src/ui/layout-editor.mjs';
import PDFLib from '../vendor/pdf-lib.min.js';

const dom = installDom(); await import('../vendor/JsBarcode.all.min.js');
globalThis.JsBarcode = window.JsBarcode; globalThis.PDFLib = PDFLib;
test.after(() => { window.dispatchEvent(new window.Event('pagehide')); dom.window.close(); });
const checkMargin = (bounds, width = 70, height = 40) => {
  assert(bounds.left >= 2.95); assert(bounds.top >= 2.95);
  assert(width - bounds.right >= 2.95); assert(height - bounds.bottom >= 2.95);
};

test('70×40 新建模板的条码框宽 64 mm，左右及底部至少留白 3 mm', () => {
  const template = createDesign(), bounds = barcodeBounds(template);
  assert.equal(bounds.width, 64); assert.equal(bounds.left, 3); assert.equal(bounds.bottom, 37); checkMargin(bounds);
  checkMargin(barcodeBounds(defaultTemplates()[1]));
});

test('旧模板的贴边、旋转、单独放大边框和父级缩放均可内缩，保留上方内容', () => {
  for (const rotation of [0, 8]) for (const frameScale of [100, 125]) {
    const template = createDesign(); Object.assign(template.elements[0], { x: 0, y: 24, w: 70, h: 16, rotation });
    const old = normalizeLayout({ parts: { label: { x: -1, y: -.5, scale: 110 }, content: { x: 1 }, barcode: { x: .5, y: 1, scale: 115 }, frame: { scale: frameScale } } });
    const source = JSON.stringify([template, old]), next = insetBarcodeLayout(template, old);
    checkMargin(barcodeBounds(template, next));
    for (const part of ['label','content','frame','skc','sku','origin']) assert.deepEqual(next.parts[part], old.parts[part]);
    assert.equal(JSON.stringify([template, old]), source);
  }
});

test('203/300/600 DPI 输出经模拟纸边裁切后仍保留四条边框，PDF 保持 70×40 mm', async () => {
  for (const template of [defaultTemplates()[1], createDesign()]) {
    const render = await createLabelRenderer(template);
    for (const dpi of [203, 300, 600]) {
      const canvas = await render(DESIGN_SAMPLE, { dpi }), mono = toMonochrome(canvas), stride = Math.ceil(canvas.width / 8);
      const crop = Math.ceil(2 * dpi / 25.4);
      const dark = (x,y) => x >= crop && x < canvas.width - crop && y >= crop && y < canvas.height - crop && !(mono.packed[y * stride + (x >> 3)] & (128 >> (x & 7)));
      let left = canvas.width, right = 0, top = canvas.height, bottom = 0;
      for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) if (dark(x,y)) { left = Math.min(left,x); right = Math.max(right,x); top = Math.min(top,y); bottom = Math.max(bottom,y); }
      const horizontal = y => Array.from({ length: right - left + 1 }, (_, i) => Number(dark(left + i,y))).reduce((a,b) => a+b,0);
      const vertical = x => Array.from({ length: bottom - top + 1 }, (_, i) => Number(dark(x,top + i))).reduce((a,b) => a+b,0);
      assert(horizontal(top) > (right - left) * .85, `上边框 ${template.kind} ${dpi}`);
      assert(horizontal(bottom) > (right - left) * .85, `下边框 ${template.kind} ${dpi}`);
      assert(vertical(left) > (bottom - top) * .85, `左边框 ${template.kind} ${dpi}`);
      assert(vertical(right) > (bottom - top) * .85, `右边框 ${template.kind} ${dpi}`);
      assert(left * 25.4 / dpi > 2.8); assert((canvas.height - bottom) * 25.4 / dpi > 2.8);
    }
    const result = await generatePdf({ template, records: [{ ...DESIGN_SAMPLE, quantity: 1 }] });
    const pdf = await PDFLib.PDFDocument.load(result.bytes), page = pdf.getPage(0);
    assert(Math.abs(page.getWidth() * 25.4 / 72 - 70) < .001); assert(Math.abs(page.getHeight() * 25.4 / 72 - 40) < .001);
  }
});

test('大图内缩按钮立即应用预览参数，保存后可恢复且不改动上方布局', async () => {
  const container = document.createElement('div'), preview = document.createElement('div'); document.body.append(container, preview);
  const template = createDesign(); Object.assign(template.elements[0], { x: 0, y: 24, w: 70, h: 16 });
  let saved, renders = 0;
  const editor = mountLayoutEditor({ container, preview, getKey: () => 'old-design', getSavedLayout: () => saved,
    onChange: async () => { renders++; }, onSave: async (_, value) => { saved = structuredClone(value); } });
  editor.sync(template); container.querySelector('#layout-inset-barcode').click();
  checkMargin(barcodeBounds(template, editor.apply(template).layout));
  assert.equal(editor.isValid(), true); assert.equal(container.querySelector('#layout-part').value, 'barcode');
  assert.match(container.querySelector('#layout-status').textContent, /上方文字未移动/);
  container.querySelector('#layout-save').click(); await new Promise(resolve => setTimeout(resolve, 330));
  assert(saved); assert.equal(renders, 1); checkMargin(barcodeBounds(template, saved));
  container.remove(); preview.remove();
});
