import test from 'node:test';
import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';
import { installDom } from './dom-runtime.mjs';
import { mountTemplateDesigner } from '../src/ui/template-designer.mjs';
import { createDesign, newElement, bakeDesignLayout, DESIGN_SAMPLE } from '../src/core/design.mjs';
import { localTemplate, defaultTemplates } from '../src/core/templates.mjs';
import { normalizeLayout } from '../src/core/layout.mjs';
import { createLabelRenderer, generatePdf, toMonochrome } from '../src/printing/render.mjs';
import PDFLib from '../vendor/pdf-lib.min.js';

const dom = installDom();
await import('../vendor/JsBarcode.all.min.js');
globalThis.JsBarcode = window.JsBarcode; globalThis.PDFLib = PDFLib;
const wait = async predicate => { for (let i = 0; i < 150; i++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 20)); } throw new Error('设计器状态未就绪'); };
const event = (node, name = 'input') => node.dispatchEvent(new window.Event(name, { bubbles: true }));
function fixture(options = {}) {
  const host = document.createElement('div'); document.body.append(host);
  const root = host.attachShadow({ mode: 'open' }), mainPanel = document.createElement('section'); root.append(mainPanel);
  let saved;
  const designer = mountTemplateDesigner({ root, mainPanel, onSave: async value => { if (options.fail) throw new Error('模拟写入失败'); saved = value; } });
  return { host, root, mainPanel, designer, $: selector => root.querySelector(selector), saved: () => saved };
}
test.after(() => { window.dispatchEvent(new window.Event('pagehide')); dom.window.close(); });

test('可视化模板校验、独立 JSON 往返、嵌入图片限制和旧本地模板转换', () => {
  const template = createDesign(defaultTemplates()[0]);
  assert.equal(template.kind, 'design'); assert(template.elements.some(element => element.type === 'text'));
  const original = JSON.stringify(template);
  assert.deepEqual(localTemplate(JSON.parse(original)), template);
  for (const elements of [
    [{ ...newElement('image'), src: 'https://example.com/picture.png' }],
    [{ ...newElement('text'), x: Infinity }],
    [{ ...newElement('text'), text: '<script>alert(1)</script>', id: 'bad"id' }],
    [template.elements[0], template.elements[0]],
    Array.from({ length: 121 }, () => newElement('text')),
  ]) assert.throws(() => localTemplate({ ...template, elements }));
  assert.equal(JSON.stringify(template), original);
  const placed = bakeDesignLayout({ ...template, layout: normalizeLayout({ parts: { label: { x: 1, y: 2, scale: 120 }, barcode: { x: 1, y: -1, scale: 80 } } }) });
  const before = template.elements.find(element => element.type === 'barcode'), after = placed.elements.find(element => element.type === 'barcode');
  assert(Math.abs(after.x - ((before.x * .8 + 1) * 1.2 + 1)) < .01);
  assert.equal(placed.layout.parts.label.scale, 100); assert.equal(placed.layout.parts.barcode.x, 0);
});

test('新建模板可加文字、变量、图层、对齐、撤销重做并保存，关闭不修改原模板', async () => {
  const f = fixture(); f.designer.open();
  assert.equal(f.$('#editor').hidden, false); assert.equal(f.mainPanel.inert, true);
  f.$('[data-add=text]').click();
  f.$('#design-text').focus(); f.$('#design-text').value = 'SKU {{sku}}'; event(f.$('#design-text')); event(f.$('#design-text'), 'change');
  f.$('[data-prop=bold]').checked = true; event(f.$('[data-prop=bold]'), 'change');
  f.$('[data-align=center]').click();
  assert.equal(Number(f.$('[data-prop=x]').value), 20);
  f.$('[data-action=duplicate]').click(); assert.equal(f.$('#design-layers').children.length, 3);
  f.$('[data-action=undo]').click(); assert.equal(f.$('#design-layers').children.length, 2);
  f.$('[data-action=redo]').click(); assert.equal(f.$('#design-layers').children.length, 3);
  f.$('[data-action=delete]').click(); assert.equal(f.$('#design-layers').children.length, 2);
  f.$('[name=name]').value = '自己的可视化模板';
  event(f.$('#editor'), 'submit'); await wait(() => f.saved());
  assert.equal(f.saved().name, '自己的可视化模板'); assert.equal(f.saved().elements[1].text, 'SKU {{sku}}'); assert.equal(f.saved().elements[1].bold, true);
  assert.equal(f.$('#editor').hidden, true); assert.equal(f.mainPanel.inert, false);
  const original = JSON.stringify(f.saved()); f.designer.open(f.saved()); f.$('[data-add=rect]').click(); f.$('#cancel-editor').click();
  assert.equal(JSON.stringify(f.saved()), original); f.host.remove();
});

test('100 次拖动不重建条码；支持吸附、调整大小、锁定和取消拖动', async () => {
  const f = fixture(), originalBarcode = globalThis.JsBarcode; let encodes = 0;
  globalThis.JsBarcode = (...args) => { encodes++; return originalBarcode(...args); };
  try {
    f.designer.open(); const svg = f.$('#design-paper > svg'); svg.getBoundingClientRect = () => ({ width: 700, height: 400 });
    const group = f.$('[data-element-id]'), x = Number(f.$('[data-prop=x]').value), start = encodes;
    group.dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 100, clientY: 100 }));
    for (let i = 1; i <= 100; i++) window.dispatchEvent(new window.MouseEvent('pointermove', { clientX: 100 + i, clientY: 100 }));
    assert.equal(encodes, start); assert.equal(Number(f.$('[data-prop=x]').value), x + 10);
    window.dispatchEvent(new window.MouseEvent('pointerup', { clientX: 200, clientY: 100 })); assert.equal(encodes, start + 1);
    f.$('[data-handle=resize]').dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 200, clientY: 100 }));
    window.dispatchEvent(new window.MouseEvent('pointerup', { clientX: 210, clientY: 110 }));
    assert.equal(Number(f.$('[data-prop=w]').value), 65);
    const latest = f.$('[data-element-id]'); latest.dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 100, clientY: 100 }));
    window.dispatchEvent(new window.MouseEvent('pointermove', { clientX: 300, clientY: 100 })); window.dispatchEvent(new window.Event('pointercancel'));
    assert.equal(Number(f.$('[data-prop=x]').value), x + 10);
    f.$('[data-lock]').click(); assert.equal(f.$('[data-prop=x]').disabled, true); assert.equal(f.$('[data-handle]'), null);
    f.$('#cancel-editor').click(); f.host.remove();
  } finally { globalThis.JsBarcode = originalBarcode; }
});

test('本机图片嵌入、图层隐藏与保存失败都保留可操作状态', async () => {
  const options = { fail: true }, f = fixture(options); f.designer.open();
  const canvas = document.createElement('canvas'); canvas.width = 10; canvas.height = 10; canvas.getContext('2d').fillRect(0, 0, 10, 10);
  const bytes = Buffer.from(canvas.toDataURL('image/png').split(',')[1], 'base64');
  const input = f.$('#design-image'); Object.defineProperty(input, 'files', { configurable: true, value: [new window.File([bytes], 'own.png', { type: 'image/png' })] });
  event(input, 'change'); await wait(() => f.$('#design-paper image'));
  assert.match(f.$('#design-paper image').getAttribute('xlink:href'), /^data:image\/png;base64,/);
  f.$('[data-visible]').click(); assert.equal(f.$('#design-paper image'), null);
  f.$('[data-visible]').click(); assert(f.$('#design-paper image'));
  event(f.$('#editor'), 'submit'); await wait(() => f.$('#design-status').textContent.includes('模拟写入失败'));
  assert.equal(f.$('#design-alert').hidden, false); assert.match(f.$('#design-alert').textContent, /模拟写入失败/);
  assert.equal(f.$('#editor').hidden, false); assert.equal(f.$('#design-save').disabled, false);
  options.fail = false; event(f.$('#editor'), 'submit'); await wait(() => f.saved());
  assert.equal(f.saved().elements[1].type, 'image'); f.host.remove();
});

test('无效字段点击保存会显示顶部错误，修正后能保存且保留编辑内容', async () => {
  const f = fixture(); f.designer.open(); f.$('[data-add=text]').click();
  f.$('#design-text').value = '仍然保留的文字'; event(f.$('#design-text'));
  f.$('[name=name]').value = ''; event(f.$('#editor'), 'submit');
  assert.equal(f.$('#editor').noValidate, true); assert.equal(f.$('#design-alert').hidden, false);
  assert.match(f.$('#design-alert').textContent, /模板名称/); assert.equal(f.saved(), undefined);
  f.$('[name=name]').value = '修正后的模板'; event(f.$('#editor'), 'submit'); await wait(() => f.saved());
  assert.equal(f.saved().elements[1].text, '仍然保留的文字'); f.host.remove();
});

test('设计器输出按 300/600 DPI 渲染，变量生效且黑白 PDF 与同 DPI 预览逐位一致', async () => {
  const template = createDesign();
  template.elements.unshift({ ...newElement('text'), text: 'Own label {{sku}}', fontSize: 2, w: 65 });
  template.elements.unshift({ ...newElement('grid'), x: 2, y: 8, w: 30, h: 8, rows: 2, cols: 3 });
  const bitmap = document.createElement('canvas'); bitmap.width = 10; bitmap.height = 10; bitmap.getContext('2d').fillRect(0, 0, 10, 10);
  template.elements.unshift({ ...newElement('image'), x: 50, y: 10, w: 5, h: 5, src: bitmap.toDataURL('image/png') });
  const render = await createLabelRenderer(template), canvas = await render(DESIGN_SAMPLE, { dpi: 300 });
  assert.equal(canvas.width, 827); assert.equal(canvas.height, 472);
  assert.equal(canvas.getContext('2d').getImageData(Math.round(52 * 300 / 25.4), Math.round(12 * 300 / 25.4), 1, 1).data[0], 0, '本机图片应出现在最终打印图像中');
  const changed = await render({ ...DESIGN_SAMPLE, productSkuId: '999999' }, { dpi: 300 });
  assert.notDeepEqual(toMonochrome(canvas).packed, toMonochrome(changed).packed);
  const high = await render(DESIGN_SAMPLE, { dpi: 600 }); assert.equal(high.width, 1654); assert.equal(high.height, 945);
  const result = await generatePdf({ template, records: [{ ...DESIGN_SAMPLE, quantity: 2 }] });
  const pdf = await PDFLib.PDFDocument.load(result.bytes); assert.equal(pdf.getPageCount(), 2);
  const images = pdf.getPage(0).node.Resources().lookup(PDFLib.PDFName.of('XObject'), PDFLib.PDFDict);
  const image = images.lookup(images.keys()[0], PDFLib.PDFRawStream);
  assert.deepEqual(new Uint8Array(inflateSync(image.contents)), toMonochrome(canvas).packed);
});

test('JPEG 图片保留原格式，不再强制转换成 PNG', async () => {
  const f = fixture(); f.designer.open();
  const canvas = document.createElement('canvas'); canvas.width = 12; canvas.height = 8;
  const context = canvas.getContext('2d'); context.fillStyle = '#c33'; context.fillRect(0, 0, 12, 8);
  const bytes = Buffer.from(canvas.toDataURL('image/jpeg', .9).split(',')[1], 'base64');
  const input = f.$('#design-image');
  Object.defineProperty(input, 'files', { configurable: true, value: [new window.File([bytes], 'photo.jpg', { type: 'image/jpeg' })] });
  event(input, 'change'); await wait(() => f.$('#design-paper image'));
  assert.match(f.$('#design-paper image').getAttribute('xlink:href'), /^data:image\/jpeg;base64,/);
  assert.equal(f.$('#design-alert').hidden, true);
  f.host.remove();
});
