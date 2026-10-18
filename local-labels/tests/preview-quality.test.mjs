import test from 'node:test';
import assert from 'node:assert/strict';
import { previewDpi } from '../src/ui/preview-quality.mjs';
import { installDom } from './dom-runtime.mjs';
import { mountLabelApp } from '../src/ui/app.mjs';
import { createDesign, newElement } from '../src/core/design.mjs';

test('70×40 大图按屏幕尺寸和 1×/2× 像素密度渲染，超大窗口限制像素和内存', () => {
  const template = { width: 70, height: 40 }, viewport = { width: 816, height: 528 };
  for (const ratio of [1, 2]) {
    const dpi = previewDpi(template, viewport, ratio);
    assert(template.width / 25.4 * dpi >= viewport.width * ratio * 1.5);
  }
  assert(previewDpi(template, viewport, 2) > previewDpi(template, viewport, 1));
  for (const template of [{ width: 210, height: 15 }, { width: 210, height: 210 }, { width: 70, height: 40 }]) {
    const dpi = previewDpi(template, { width: 10000, height: 10000 }, 5);
    const w = Math.round(template.width / 25.4 * dpi), h = Math.round(template.height / 25.4 * dpi);
    assert(Math.max(w, h) <= 3200); assert(w * h <= 4004000, '约 400 万像素的预览预算，含取整误差');
  }
});

test('大图保留小字抗锯齿，100 次拖动不重绘，窗口或屏幕密度变化只更新一次', async () => {
  const dom = installDom();
  await import('../vendor/JsBarcode.all.min.js');
  const originalBarcode = globalThis.JsBarcode, originalObserver = window.ResizeObserver;
  globalThis.JsBarcode = window.JsBarcode;
  const nativeBarcode = globalThis.JsBarcode; let barcodes = 0, observer, stageWidth = 866;
  globalThis.JsBarcode = (...args) => { barcodes++; return nativeBarcode(...args); };
  window.ResizeObserver = class { constructor(callback) { this.callback = callback; observer = this; } observe() {} disconnect() { this.disconnected = true; } };
  Object.defineProperty(window, 'devicePixelRatio', { configurable: true, writable: true, value: 1 });
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const until = async condition => { for (let i = 0; i < 250; i++) { if (condition()) return; await wait(20); } throw new Error('等待高清预览超时'); };
  try {
    const template = createDesign(), text = newElement('text', 70, 40);
    Object.assign(text, { x: 3, y: 2, w: 64, h: 5, fontSize: 1.4, text: 'Example Studio: 123 Sample Street, Example City' });
    template.elements.unshift(text);
    await mountLabelApp({ demo: true, loadSettings: async () => ({ templates: [template], selected: template.id }), saveSettings: async () => {}, getMallId: async () => '' }, './style.css');
    const root = document.querySelector('#qingyin-label-helper-root').shadowRoot, $ = selector => root.querySelector(selector);
    $('#demo').click(); await until(() => $('#preview canvas') && $('#preview').getAttribute('aria-busy') === 'false');
    const thumbnail = $('#preview canvas');
    const stage = $('#layout-preview'); stage.style.padding = '24px'; stage.style.border = '1px solid black';
    stage.getBoundingClientRect = () => ({ width: stageWidth, height: 540, top: 0, left: 0 });
    $('#preview').click(); await until(() => $('#layout-preview canvas')?.width > thumbnail.width && $('#preview').getAttribute('aria-busy') === 'false');
    const large = $('#layout-preview canvas'), firstWidth = large.width;
    assert(large.width >= 816 * 1.5, '不能再把 496 px 位图放大至 816 px');
    assert.equal(large.style.width, '816px'); assert.equal(large.style.filter, 'grayscale(1)');
    const pixels = large.getContext('2d').getImageData(0, 0, large.width, Math.round(large.height / 4)).data;
    assert(pixels.some((value, index) => index % 4 !== 3 && value > 0 && value < 255), '小字边缘保留中间灰阶，避免提前硬阈值导致断笔');
    large.getBoundingClientRect = () => ({ width: 816, height: 816 * 40 / 70 });
    const beforeDrag = barcodes;
    large.dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true, clientX: 20, clientY: 20, button: 0 }));
    for (let i = 0; i < 100; i++) window.dispatchEvent(new window.MouseEvent('pointermove', { clientX: 20 + i, clientY: 20 }));
    await wait(350); assert.equal(barcodes, beforeDrag);
    const beforeDrop = $('#preview canvas');
    window.dispatchEvent(new window.MouseEvent('pointerup', { clientX: 120, clientY: 20 }));
    await until(() => $('#preview canvas') !== beforeDrop && $('#preview').getAttribute('aria-busy') === 'false');
    assert.equal(barcodes, beforeDrag, '整体移动复用高清底图，不重新生成条码');
    window.devicePixelRatio = 2;
    for (let i = 0; i < 30; i++) window.dispatchEvent(new window.Event('resize'));
    await until(() => $('#layout-preview canvas').width > firstWidth && $('#preview').getAttribute('aria-busy') === 'false');
    assert.equal(barcodes, beforeDrag + 1, '屏幕密度变化合并成一次高分辨率更新');
    const beforeResize = barcodes;
    stageWidth = 700; for (let i = 0; i < 30; i++) observer.callback();
    await until(() => $('#layout-preview canvas').style.width === '650px' && $('#preview').getAttribute('aria-busy') === 'false');
    await wait(200); assert.equal(barcodes, beforeResize + 1);
    for (let i = 0; i < 30; i++) observer.callback();
    await wait(200); assert.equal(barcodes, beforeResize + 1, '画布自身尺寸变化不触发循环重绘');
    window.dispatchEvent(new window.Event('pagehide')); assert.equal(observer.disconnected, true);
  } finally {
    window.dispatchEvent(new window.Event('pagehide')); window.ResizeObserver = originalObserver;
    if (originalBarcode) globalThis.JsBarcode = originalBarcode; else delete globalThis.JsBarcode;
    dom.window.close();
  }
});
