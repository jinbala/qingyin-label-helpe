import test from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './dom-runtime.mjs';
import { mountLabelApp } from '../src/ui/app.mjs';
import { pageType, readSelected } from '../src/integration/dom.mjs';
import { defaultTemplates, SETTINGS_SCHEMA } from '../src/core/templates.mjs';
import { createLabelRenderer, generatePdf, toMonochrome } from '../src/printing/render.mjs';
import PDFLib from '../vendor/pdf-lib.min.js';
import { barcodeSvg } from '../src/printing/render.mjs';
import { designSvg } from '../src/printing/design-svg.mjs';
import { local7040Template, localRecords } from './fixtures/local-template.mjs';
import { normalizeLayout } from '../src/core/layout.mjs';
import { mountLayoutEditor } from '../src/ui/layout-editor.mjs';
import { inflateSync } from 'node:zlib';
import { createSettingsStore } from '../src/printing/settings-store.mjs';
import { createExtensionServices } from '../src/integration/bridge.mjs';
import { SETTINGS_REQUEST } from '../src/integration/extension-api.mjs';

const dom = installDom();
await import('../vendor/JsBarcode.all.min.js');
globalThis.PDFLib = PDFLib; globalThis.JsBarcode = window.JsBarcode;
const row = { key: 'first', productSkuId: '9000000000001', productSkcId: '800000000001', labelCode: '53711398047', skuSpec: 'Black-L', skcSpec: 'Cotton', quantity: 2, tableOrder: 0, selectionRank: 0 };
const template = { id: 'simple', kind: 'simple', name: 'Test', width: 60, height: 40, origin: 'China', productName: 'Product {{sku}}', manufacturer: 'Test Company' };
const pause = () => new Promise(resolve => setTimeout(resolve, 20));
async function until(condition) { for (let i = 0; i < 250; i++) { if (condition()) return; await pause(); } throw new Error('等待界面状态超时'); }

test.after(() => { window.dispatchEvent(new window.Event('pagehide')); dom.window.close(); });

test('持续拖动和停顿期间不重复渲染，松手只更新一次', async () => {
  const container = document.createElement('div'), preview = document.createElement('div'), canvas = document.createElement('canvas');
  preview.append(canvas); document.body.append(container, preview);
  canvas.getBoundingClientRect = () => ({ width: 700, height: 400 });
  let renders = 0;
  const editor = mountLayoutEditor({ container, preview, getKey: () => 'drag-performance', getSavedLayout: () => undefined,
    onSave: async () => {}, onChange: async () => { renders++; } });
  editor.sync({ width: 70, height: 40 });
  canvas.dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true, clientX: 10, clientY: 10, button: 0 }));
  for (let i = 0; i < 100; i++) window.dispatchEvent(new window.MouseEvent('pointermove', { clientX: 10 + i, clientY: 10 }));
  await new Promise(resolve => setTimeout(resolve, 350));
  assert.equal(renders, 0); assert.equal(editor.isPending(), true);
  assert(preview.querySelector('.drag-guide'));
  window.dispatchEvent(new window.MouseEvent('pointerup', { clientX: 110, clientY: 10 }));
  await until(() => !editor.isPending()); assert.equal(renders, 1);
  assert.equal(editor.apply({ width: 70, height: 40 }).layout.parts.label.x, 10);
  container.remove(); preview.remove();
});

test('整体微调复用底图，20 次调整仅生成一次条码布局', async () => {
  const original = globalThis.JsBarcode; let calls = 0;
  globalThis.JsBarcode = (...args) => { calls++; return original(...args); };
  try {
    const render = await createLabelRenderer(local7040Template, { cacheLabelBase: true });
    for (let i = 0; i < 20; i++) {
      const canvas = await render(localRecords[0], { dpi: 96, layout: normalizeLayout({ parts: { label: { x: i / 10 } } }) });
      assert(canvas.width > 200); canvas.width = 1;
    }
    // One encode per label: sizing no longer needs a throwaway measuring render.
    assert.equal(calls, 1);
    await render(localRecords[0], { dpi: 96, layout: normalizeLayout({ parts: { size: { x: 1 } } }) });
    assert.equal(calls, 2);
  } finally { globalThis.JsBarcode = original; }
});

test('位置编辑可按模板保存、恢复、切换，拖动考虑父级缩放且保存失败有提示', async () => {
  const container = document.createElement('div'), preview = document.createElement('div'), canvas = document.createElement('canvas');
  preview.append(canvas); document.body.append(container, preview);
  canvas.getBoundingClientRect = () => ({ width: 300, height: 200 });
  let key = 'local-position', fail = false, saved = {};
  const editor = mountLayoutEditor({ container, preview, getKey: () => key, getSavedLayout: id => saved[id],
    onChange() {}, onSave: async (id, layout) => { if (fail) throw new Error('模拟保存失败'); saved[id] = structuredClone(layout); } });
  const $ = id => container.querySelector(id), metadata = { width: 70, height: 40 };
  editor.sync(metadata);
  $('#layout-x').value = '2.5'; $('#layout-x').dispatchEvent(new window.Event('input'));
  $('#layout-save').click(); await until(() => saved[key]);
  assert.equal(saved[key].parts.label.x, 2.5);
  key = 'local-other'; editor.sync(metadata); assert.equal($('#layout-x').value, '0');
  key = 'local-position'; editor.sync(metadata); assert.equal($('#layout-x').value, '2.5');
  $('#layout-reset').click(); assert.equal(editor.apply(metadata).layout.parts.label.x, 0); assert.equal(saved[key].parts.label.x, 2.5);
  $('#layout-scale').value = '150'; $('#layout-scale').dispatchEvent(new window.Event('input'));
  $('#layout-part').value = 'barcode'; $('#layout-part').dispatchEvent(new window.Event('change'));
  $('#layout-scale').value = '125'; $('#layout-scale').dispatchEvent(new window.Event('input'));
  $('#layout-part').value = 'sku'; $('#layout-part').dispatchEvent(new window.Event('change'));
  $('#layout-drag').checked = true; $('#layout-drag').dispatchEvent(new window.Event('change'));
  canvas.dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true, clientX: 10, clientY: 10, button: 0 }));
  window.dispatchEvent(new window.MouseEvent('pointerup', { clientX: 30, clientY: 10 }));
  assert.equal(editor.apply(metadata).layout.parts.sku.x, 2.5);
  fail = true; $('#layout-save').click(); await until(() => $('#layout-status').textContent.includes('保存失败'));
  assert.equal(saved[key].parts.sku.x, 0);
  container.remove(); preview.remove();
});

test('毫米偏移作用于真实图像：内容和条码独立，文字可移出条码框，整体移动保持比例', async () => {
  const template = structuredClone(local7040Template);
  const render = async layout => (await createLabelRenderer({ ...template, layout }))(localRecords[0]);
  const samePixels = (a, b) => Buffer.from(a).equals(Buffer.from(b));
  const original = await render(), context = original.getContext('2d');
  const content = await render(normalizeLayout({ parts: { content: { x: 1 } } }));
  assert(samePixels(content.getContext('2d').getImageData(0, 236, 827, 236).data, context.getImageData(0, 236, 827, 236).data), '移动上方内容不应改变条码');
  assert(!samePixels(content.getContext('2d').getImageData(0, 0, 827, 236).data, context.getImageData(0, 0, 827, 236).data), '上方图片应发生移动');
  const shifted = await render(normalizeLayout({ parts: { label: { x: 10 * 25.4 / 300 } } }));
  const originalMono = toMonochrome(original), shiftedMono = toMonochrome(shifted), stride = Math.ceil(827 / 8);
  for (let y = 0; y < 472; y++) for (let x = 0; x < 817; x++) {
    const before = Boolean(originalMono.packed[y * stride + (x >> 3)] & (128 >> (x & 7)));
    const after = Boolean(shiftedMono.packed[y * stride + ((x + 10) >> 3)] & (128 >> ((x + 10) & 7)));
    assert.equal(after, before, `整体移动十个像素：${x},${y}`);
  }
  const onlyPlaceholder = { ...defaultTemplates()[1] };
  const unmoved = await (await createLabelRenderer(onlyPlaceholder))(localRecords[0]);
  const moved = await (await createLabelRenderer({ ...onlyPlaceholder, layout: normalizeLayout({ parts: { skc: { y: -5 } } }) }))(localRecords[0]);
  assert(moved.getContext('2d').getImageData(0, 210, 230, 25).data.some((value, i) => i % 4 !== 3 && value < 128), '文字移出条码区域后仍应出现在纸张上');
  const unchangedBars = toMonochrome(unmoved), movedText = toMonochrome(moved);
  for (let y = 306; y < 406; y++) for (let x = 0; x < 827; x++) {
    const bit = 128 >> (x & 7), offset = y * stride + (x >> 3);
    assert.equal(Boolean(movedText.packed[offset] & bit), Boolean(unchangedBars.packed[offset] & bit), '只移动编号不应改变最终打印的条码线条');
  }
});

test('自主条码排版：固定区域、规格同行、静区和长文字适配', () => {
  const svg = new window.DOMParser().parseFromString(barcodeSvg(localRecords[0], 'China'), 'image/svg+xml');
  assert.equal(svg.documentElement.getAttribute('width'), '700');
  assert.equal(svg.documentElement.getAttribute('height'), '185');
  const nodes = ['lt', 'tc', 'rt'].map(role => svg.querySelector(`[data-role="${role}"]`));
  assert.deepEqual(nodes.map(node => node.textContent), ['800000000001', 'Black', '2XL']);
  assert.equal(new Set(nodes.map(node => node.getAttribute('y'))).size, 1);
  assert(nodes.every(node => node.getAttribute('font-weight') === 'bold' && node.getAttribute('font-size') === '21'));
  const frame = svg.querySelector('[data-role="frame"]');
  const frameStroke = Number(frame.getAttribute('stroke-width'));
  assert(Math.abs(frameStroke * 25.4 / 300 - .2) < 1e-8);
  assert.equal(Number(frame.getAttribute('x')), frameStroke / 2);
  assert.equal(Number(frame.getAttribute('width')) + frameStroke, 700);
  assert.equal(Number(frame.getAttribute('height')) + frameStroke, 185);
  assert.equal(svg.querySelector('[data-role="lt"]').getAttribute('x'), '14');
  assert.equal(svg.querySelector('[data-role="lb"]').getAttribute('x'), '14');
  assert.equal(svg.querySelector('g rect').getAttribute('height'), '106');
  assert.equal(svg.querySelector('[data-role="lb"]').textContent, '9000000000001');
  assert.equal(svg.querySelector('[data-role="rb"]').textContent, 'Made In China');
});

test('更换条码不会改变上方自建文字内容；颜色、编号不会混入条码线条', async () => {
  const render = await createLabelRenderer(local7040Template);
  const first = await render(localRecords[0]), second = await render(localRecords[1]);
  assert.deepEqual(first.getContext('2d').getImageData(0, 0, 827, 220).data, second.getContext('2d').getImageData(0, 0, 827, 220).data);
  const black = first.getContext('2d').getImageData(0, 245, 827, 225).data;
  assert(black.some((value, i) => i % 4 !== 3 && value < 128));
  const svg = new window.DOMParser().parseFromString(barcodeSvg({ ...localRecords[0], skcSpec: 'Black and white with stripes' }, 'China'), 'image/svg+xml');
  assert(Number(svg.querySelector('[data-role="tc"]').getAttribute('font-size')) < 21);
  assert.equal(svg.querySelector('[data-role="rt"]').getAttribute('text-anchor'), 'end');
});

test('批次提示页按模板纸张生成边框、上下黑条与居中文字', async () => {
  const render = await createLabelRenderer({ ...template, width: 70, height: 40 });
  const canvas = await render(row, { separator: true, dpi: 300 });
  assert.equal(canvas.width, Math.round(70 / 25.4 * 300));
  const context = canvas.getContext('2d'), width = canvas.width, height = canvas.height;
  const dark = (x, y) => context.getImageData(x, y, 1, 1).data[0] < 128;
  const margin = 2 / 25.4 * 300;
  assert(dark(width / 2, Math.round(margin + height * 0.10 + height * 0.07)), '上黑条');
  assert(dark(width / 2, Math.round(height - margin - height * 0.10 - height * 0.07)), '下黑条');
  assert(dark(Math.round(margin), Math.round(height / 2)), '左边框');
  let text = false;
  for (let y = Math.round(height * 0.4); y <= Math.round(height * 0.6) && !text; y++) {
    for (let x = 0; x < width; x++) if (dark(x, y)) { text = true; break; }
  }
  assert(text, '文字位于两条黑条之间');
  canvas.width = 1;
});

test('页面识别及勾选提取不会把 SKC 列当成 SKU', () => {
  assert.equal(pageType('/main/order-manager/shipping-list'), 'delivery');
  assert.equal(pageType('/stock/fully-mgt/order-manage'), 'purchase');
  assert.equal(pageType('/stock/fully-mgt/order-manage-urgency'), null);
  document.body.innerHTML = '<div id="root"><table><thead><tr><th>选择</th><th>SKC ID</th><th>SKU ID</th></tr></thead><tbody><tr><td><input type="checkbox" checked></td><td>111111</td><td>9000000000001</td></tr><tr><td><input type="checkbox"></td><td>222222</td><td>9000000000002</td></tr></tbody></table></div>';
  assert.deepEqual(readSelected('sku').ids, ['9000000000001']);
});

test('发货批次勾选会取出该批次下全部发货单，而不是只取第一条', () => {
  document.body.innerHTML = `<div id="root"><table>
    <thead><tr><th>选择</th><th>发货批次</th><th>物流信息</th><th>发货单号</th><th>商品信息</th><th>发货信息</th></tr></thead>
    <tbody>
      <tr><td class="TB_checkCell TB_leftSticky"><label class="CBX_checkbox CBX_active"><input type="checkbox" checked></label></td>
        <td rowspan="3"><div><span>EB2610201953738</span><div class="order-status-tag_main">待快递揽收</div></div></td>
        <td>物流单号 772083597287574</td><td>FH2610204714287</td><td>备货单号：WB2610196410786</td><td>24</td></tr>
      <tr><td>FH2610204714284</td><td>备货单号：WB26101935803342</td><td>17</td></tr>
      <tr><td>FH2610200251282</td><td>备货单号：WB2610193530698</td><td>9</td></tr>
      <tr><td class="TB_checkCell TB_leftSticky"><label class="CBX_checkbox"></label></td>
        <td><div><span>EB2610202027272</span><div class="order-status-tag_main">物流运输中</div></div></td>
        <td>物流单号 772083597287575</td><td>FH261020471188</td><td>备货单号：WB2610171061812</td><td>6</td></tr>
    </tbody></table></div>`;
  assert.deepEqual(readSelected('delivery').ids, ['FH2610204714287', 'FH2610204714284', 'FH2610200251282']);
  assert.deepEqual(readSelected('delivery').groups, [['FH2610204714287', 'FH2610204714284', 'FH2610200251282']]);
  document.querySelectorAll('#root tbody tr')[3].querySelector('input[type="checkbox"], label')?.setAttribute('class', 'CBX_checkbox CBX_active');
  assert.deepEqual(readSelected('delivery').ids, ['FH2610204714287', 'FH2610204714284', 'FH2610200251282', 'FH261020471188']);
  assert.deepEqual(readSelected('delivery').groups, [
    ['FH2610204714287', 'FH2610204714284', 'FH2610200251282'], ['FH261020471188'],
  ]);
});

test('使用真实条码和画布生成黑白 PDF，数量、提示页和纸张尺寸正确', async () => {
  const render = await createLabelRenderer(template);
  const canvas = await render(row);
  assert.equal(canvas.width, 709);
  assert.equal(canvas.height, 472);
  const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
  assert(pixels.some((value, i) => i % 4 !== 3 && value === 0));
  const result = await generatePdf({ records: [row, { ...row, productSkuId: '9000000000002', labelCode: '53711398048', quantity: 3 }], template, separators: true });
  assert.equal(result.pages, 6); assert.equal(result.images, 3);
  const pdf = await PDFLib.PDFDocument.load(result.bytes);
  assert.equal(pdf.getPageCount(), 6);
  assert(Math.abs(pdf.getPage(0).getHeight() - 40 * 72 / 25.4) < .01);
});

test('界面可读取勾选、修改数量、生成 PDF；失败和切换店铺会清空旧数据', async () => {
  document.body.innerHTML = '<div id="root"><table><thead><tr><th>选择</th><th>SKC ID</th><th>SKU ID</th></tr></thead><tbody><tr><td><input type="checkbox" checked></td><td>111111</td><td>9000000000001</td></tr></tbody></table></div>';
  let mode = 'normal', openedPdf, settings = {};
  const services = {
    getMallId: async () => '123', loadSettings: async () => settings, saveSettings: async data => { settings = data; },
    request: async config => {
      if (mode === 'slow') await new Promise(resolve => setTimeout(resolve, 100));
      if (mode === 'error') throw new Error('模拟接口失败');
      return { success: true, result: { pageItems: mode === 'empty' ? [] : config.data.productSkuIdList.map(id => ({ labelCodeVO: { productSkuId: id, productSkcId: '800000000001', labelCode: '53711398047' } })) } };
    },
    openPdf: async bytes => { openedPdf = await PDFLib.PDFDocument.load(bytes); },
  };
  await mountLabelApp(services, './style.css');
  const root = document.querySelector('#qingyin-label-helper-root').shadowRoot, $ = id => root.querySelector(id);
  $('#launcher').click(); await until(() => !$('#overlay').hidden && $('#mall').value === '123');
  $('#preview').click();
  assert.equal($('.layout-overlay').hidden, false); assert.equal($('.panel').inert, true);
  assert($('#layout-controls #layout-editor'), '调整控件应在大图窗口中');
  root.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal($('.layout-overlay').hidden, true); assert.equal($('#overlay').hidden, false);
  assert.equal($('.panel').inert, false);
  assert.equal($('#generate').disabled, true);
  $('#read-selected').click(); await until(() => $('#rows').children.length === 1 && !$('#read-selected').disabled);
  const count = $('#rows input'); count.value = '4'; count.dispatchEvent(new window.Event('input', { bubbles: true }));
  assert.match($('#count').textContent, /4 张/);
  $('#generate').click(); await until(() => openedPdf && !$('#generate').disabled);
  assert.equal(openedPdf.getPageCount(), 4);
  mode = 'error'; $('#read-selected').click(); await until(() => $('#notice').textContent.includes('模拟接口失败'));
  assert.equal($('#rows').children.length, 0); assert.equal($('#generate').disabled, true);
  mode = 'empty'; $('#read-selected').click(); await until(() => $('#notice').textContent.includes('没有返回'));
  assert.equal($('#generate').disabled, true);
  $('#mall').value = '456'; $('#mall').dispatchEvent(new window.Event('input', { bubbles: true }));
  assert.equal($('#rows').children.length, 0); assert.equal($('#generate').disabled, true);
  mode = 'slow'; $('#read-selected').click();
  await until(() => !$('#cancel').hidden); $('#cancel').click();
  await until(() => $('#notice').textContent.includes('已取消读取') && !$('#read-selected').disabled);
  assert.equal($('#generate').disabled, true);
  mode = 'normal';
  $('#new-template').click();
  $('#editor input[name=name]').value = '界面保存的模板';
  $('#editor').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await until(() => settings.templates?.some(item => item.name === '界面保存的模板'));
  assert.equal($('#templates button[aria-pressed=true] strong').textContent, '界面保存的模板');
  const ownCard = [...$('#templates').children].find(card => card.textContent.includes('70 × 40')); ownCard.click();
  $('#read-selected').click(); await until(() => $('#rows').children.length === 1 && !$('#read-selected').disabled);
  assert($('#preview canvas'), '自建模板应显示黑白预览');
  const amount = $('#rows input'); amount.value = '0'; amount.dispatchEvent(new window.Event('input', { bubbles: true }));
  assert.equal($('#generate').disabled, true);
  amount.value = '1'; amount.dispatchEvent(new window.Event('input', { bubbles: true }));
  assert.equal($('#generate').disabled, false);
  $('#preview').click(); await until(() => $('#layout-preview canvas') && $('#preview').getAttribute('aria-busy') === 'false');
  assert.equal($('.layout-overlay').hidden, false);
  const beforeAdjustment = $('#preview canvas');
  $('#layout-part').value = 'barcode'; $('#layout-part').dispatchEvent(new window.Event('change'));
  $('#layout-x').value = '-1'; $('#layout-x').dispatchEvent(new window.Event('input'));
  $('#layout-y').value = '-0.5'; $('#layout-y').dispatchEvent(new window.Event('input'));
  $('#layout-scale').value = '95'; $('#layout-scale').dispatchEvent(new window.Event('input'));
  $('#layout-save').click(); await until(() => settings.layouts?.['local-7040']);
  assert.deepEqual(settings.layouts['local-7040'].parts.barcode, { x: -1, y: -0.5, scale: 95 });
  await until(() => $('#preview canvas') && $('#preview canvas') !== beforeAdjustment && !$('#generate').disabled);
  const expected = toMonochrome($('#preview canvas'));
  openedPdf = undefined; $('#generate').click(); await until(() => openedPdf && !$('#generate').disabled);
  const images = openedPdf.getPage(0).node.Resources().lookup(PDFLib.PDFName.of('XObject'), PDFLib.PDFDict);
  const image = images.lookup(images.keys()[0], PDFLib.PDFRawStream);
  const printed = { width: image.dict.get(PDFLib.PDFName.of('Width')).asNumber(), height: image.dict.get(PDFLib.PDFName.of('Height')).asNumber(), packed: inflateSync(image.contents) };
  assert.equal(printed.width, Math.round(70 / 25.4 * 300), '打印仍保持所选 300 DPI，不受大图预览分辨率影响');
  assert(expected.width > 70 / 25.4 * 180, '大图不能继续使用 180 DPI 的低分辨率位图');
  const bounds = ({ width, height, packed }) => {
    const stride = Math.ceil(width / 8); let left = width, top = height, right = 0, bottom = 0;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (!(packed[y * stride + (x >> 3)] & (128 >> (x & 7)))) { left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y); }
    return [left / width, top / height, right / width, bottom / height];
  };
  const screenBounds = bounds(expected), printBounds = bounds(printed);
  for (let i = 0; i < 4; i++) assert(Math.abs(screenBounds[i] - printBounds[i]) < 2 / Math.min(expected.width, expected.height), '交互预览与高清打印的物理位置应一致');
  $('#close-layout-preview').click(); assert.equal($('.layout-overlay').hidden, true);
  $('#layout-x').value = '999'; $('#layout-x').dispatchEvent(new window.Event('input'));
  assert.equal($('#generate').disabled, true);
  $('#layout-x').value = '-1'; $('#layout-x').dispatchEvent(new window.Event('input'));
  await until(() => !$('#generate').disabled);
  $('#new-template').click(); $('#editor input[name=name]').value = '保留位置设置的模板';
  $('#editor').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await until(() => settings.templates.some(item => item.name === '保留位置设置的模板'));
  assert.equal(settings.layouts['local-7040'].parts.barcode.x, -1);
  document.querySelector('#qingyin-label-helper-root').remove();
  await mountLabelApp(services, './style.css');
  const restoredRoot = document.querySelector('#qingyin-label-helper-root').shadowRoot;
  [...restoredRoot.querySelector('#templates').children].find(card => card.textContent.includes('70 × 40')).click();
  restoredRoot.querySelector('#layout-part').value = 'barcode'; restoredRoot.querySelector('#layout-part').dispatchEvent(new window.Event('change'));
  assert.equal(restoredRoot.querySelector('#layout-x').value, '-1');
  assert.equal(restoredRoot.querySelector('#layout-scale').value, '95');
});

test('多个发货批次一起读取后提供提示页选项，勾选后 PDF 含区分页', async () => {
  window.dispatchEvent(new window.Event('pagehide'));
  document.querySelector('#qingyin-label-helper-root')?.remove();
  window.history.pushState({}, '', '/main/order-manager/shipping-list');
  document.body.innerHTML = `<div id="root"><table>
    <thead><tr><th>选择</th><th>发货批次</th><th>发货单号</th></tr></thead>
    <tbody>
      <tr><td><label class="CBX_checkbox CBX_active"></label></td><td><div><span>EB2610201953738</span><div class="order-status-tag_main">待快递揽收</div></div></td><td>FH2610204714287</td></tr>
      <tr><td><label class="CBX_checkbox CBX_active"></label></td><td><div><span>EB2610202027272</span><div class="order-status-tag_main">物流运输中</div></div></td><td>FH261020471188</td></tr>
    </tbody></table></div>`;
  let openedPdf, settings = {};
  const services = {
    getMallId: async () => '123', loadSettings: async () => settings, saveSettings: async data => { settings = data; },
    request: async config => ({ success: true, result: config.data.deliveryOrderSnList.map(id => ({ productSkuId: id, productSkcId: '800000000001', labelCode: '53711398047', deliveryNum: 1 })) }),
    openPdf: async bytes => { openedPdf = await PDFLib.PDFDocument.load(bytes); },
  };
  await mountLabelApp(services, './style.css');
  const root = document.querySelector('#qingyin-label-helper-root').shadowRoot, $ = id => root.querySelector(id);
  $('#launcher').click(); await until(() => !$('#overlay').hidden && $('#mall').value === '123');
  assert.equal($('#type').value, 'delivery');
  assert.equal($('#batch-separator-row').hidden, true);
  $('#read-selected').click(); await until(() => $('#rows').children.length === 2 && !$('#read-selected').disabled);
  assert.equal($('#batch-separator-row').hidden, false, '两个批次时应出现提示页选项');
  $('#batch-separators').checked = true;
  $('#batch-separators').dispatchEvent(new window.Event('change', { bubbles: true }));
  assert.match($('#count').textContent, /3 张/);
  $('#ack').checked = true; $('#ack').dispatchEvent(new window.Event('change', { bubbles: true }));
  $('#generate').click(); await until(() => openedPdf && !$('#generate').disabled);
  assert.equal(openedPdf.getPageCount(), 3);
  document.querySelector('#qingyin-label-helper-root')?.remove();
  window.dispatchEvent(new window.Event('pagehide'));
});

test('真实设计器保存经扩展通信持久化，旧页面保存后重新挂载仍可编辑新模板', async () => {
  window.dispatchEvent(new window.Event('pagehide'));
  document.querySelector('#qingyin-label-helper-root')?.remove();
  const stored = {}, storage = {
    async get(keys) { return structuredClone(Object.fromEntries(keys.map(key => [key, stored[key]]))); },
    async set(values) { Object.assign(stored, structuredClone(values)); },
  };
  const store = createSettingsStore(storage), previousChrome = globalThis.chrome;
  globalThis.chrome = { runtime: { sendMessage: async packet => {
    assert.equal(packet.type, SETTINGS_REQUEST);
    return { ok: true, settings: await store(packet.operation, packet.patch) };
  } } };
  try {
    const oldPage = await createExtensionServices(); await oldPage.loadSettings();
    await mountLabelApp(await createExtensionServices(), './style.css');
    let root = document.querySelector('#qingyin-label-helper-root').shadowRoot;
    root.querySelector('#new-template').click();
    root.querySelector('#editor input[name=name]').value = '刷新后应保留的模板';
    root.querySelector('#editor').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    await until(() => root.querySelector('#notice').textContent.includes('已保存在本机'));
    const own = stored.qingyinLabelSettings.templates.find(item => item.name === '刷新后应保留的模板');
    assert(own); assert.equal(root.querySelector('#editor').hidden, true);
    await oldPage.saveSettings({ templates: defaultTemplates(), selected: 'local-default', layouts: {} });
    document.querySelector('#qingyin-label-helper-root').remove();
    await mountLabelApp(await createExtensionServices(), './style.css');
    root = document.querySelector('#qingyin-label-helper-root').shadowRoot;
    const card = [...root.querySelector('#templates').children].find(item => item.textContent.includes(own.name));
    assert(card, '模拟刷新后仍须从持久存储恢复新模板');
    card.click(); root.querySelector('#edit-template').click();
    assert.equal(root.querySelector('#editor input[name=name]').value, own.name);
    assert(root.querySelector('#design-stage svg'), '保存后的模板重新打开可继续编辑');
  } finally {
    window.dispatchEvent(new window.Event('pagehide'));
    if (previousChrome) globalThis.chrome = previousChrome; else delete globalThis.chrome;
  }
});

test('CODE128 非法或空内容给出中文错误，而不是 undefined', () => {
  const code = { id: 'code', type: 'code', name: '条码', x: 2, y: 2, w: 30, h: 8, rotation: 0, visible: true, locked: false, text: '{{skuSpec}}', fontSize: 2, fontFamily: 'Arial', bold: false, align: 'left', lineHeight: 1.2 };
  const template = { schema: 'qingyin-design/v1', kind: 'design', id: 'code-test', name: '条码测试', width: 70, height: 40, origin: 'China', elements: [code] };
  const check = (record, expected) => assert.throws(
    () => designSvg(template, record, barcodeSvg),
    error => error instanceof Error && expected.test(error.message),
  );
  check({ productSkuId: '1', skuSpec: '黑色' }, /CODE128/);
  check({ productSkuId: '1' }, /CODE128/);
  assert.throws(() => designSvg({ ...template, elements: [{ ...code, text: '' }] }, {}, barcodeSvg), error => error instanceof Error && /CODE128/.test(error.message));
});

test('上方文字在 150% 缩放时不裁切、不贴到画布边缘', async () => {
  const simple = { schema: 'qingyin-template/v1', kind: 'simple', id: 'scaled', name: '缩放', width: 60, height: 40, origin: 'China',
    productName: '这是一段很长的商品名称用于测试自动换行是否考虑内容缩放比例这是第二段同样很长的文字内容用来占满整行宽度确保在百分之一百时刚好换行', manufacturer: '', address: '', responsiblePerson: '', contact: '', warning: '' };
  const record = { productSkuId: '9000000000001', productSkcId: '800000000001', labelCode: '53711398047', skuSpec: 'Black-L', skcSpec: 'Cotton', sourceId: 'S1' };
  for (const scale of [100, 150]) {
    const render = await createLabelRenderer({ ...simple, layout: normalizeLayout({ parts: { content: { scale } } }, 60, 40) });
    const canvas = await render(record, { dpi: 150 });
    const { data } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
    let rightmost = -1;
    for (let y = 0; y < canvas.height; y++) for (let x = canvas.width - 1; x >= 0; x--) {
      if (data[(y * canvas.width + x) * 4] < 128) { rightmost = Math.max(rightmost, x); break; }
    }
    assert(rightmost < canvas.width - 1, `scale ${scale} 的文字不得贴到最后一列`);
    canvas.width = 1;
  }
});

test('损坏的模板或位置只被跳过，后续保存不会删除其他模板', async () => {
  const valid = { schema: 'qingyin-template/v1', kind: 'simple', id: 'valid', name: '有效模板', width: 70, height: 40, productName: '商品 {{sku}}' };
  const broken = { schema: 'qingyin-template/v1', kind: 'simple', id: 'broken', name: '坏模板', width: 70, height: 40, productName: 'x'.repeat(201) };
  const seed = { schema: SETTINGS_SCHEMA, templates: [...defaultTemplates(), valid, broken], selected: 'valid',
    layouts: { valid: { version: 1, parts: { unknown: { x: 1, y: 0, scale: 100 } } } } };
  const data = { qingyinLabelSettings: structuredClone(seed) }; let writes = 0;
  const storage = {
    async get(keys) { return structuredClone(Object.fromEntries(keys.map(key => [key, data[key]]))); },
    async set(values) { writes++; Object.assign(data, structuredClone(values)); },
  };
  const store = createSettingsStore(storage), previousChrome = globalThis.chrome;
  globalThis.chrome = { runtime: { sendMessage: async packet => ({ ok: true, settings: await store(packet.operation, packet.patch) }) } };
  try {
    window.dispatchEvent(new window.Event('pagehide'));
    document.querySelector('#qingyin-label-helper-root')?.remove();
    await mountLabelApp(await createExtensionServices(), './style.css');
    const root = document.querySelector('#qingyin-label-helper-root').shadowRoot;
    assert.match(root.querySelector('#notice').textContent, /无法读取/);
    assert.equal(root.querySelector('#templates').children.length, 3, '默认模板 + 一个有效模板');
    const card = [...root.querySelector('#templates').children].find(node => node.textContent.includes('有效模板'));
    assert(card); card.click();
    await until(() => writes > 0);
    const saved = data.qingyinLabelSettings;
    assert(saved.templates.some(template => template.id === 'valid'));
    assert(saved.templates.some(template => template.id === 'broken'), '坏模板必须保留在存储中');
    assert(saved.templates.some(template => template.id === 'local-default'), '默认模板不得被当作删除');
    assert(saved.layouts.valid, '无法解析的位置也必须保留在存储中');
  } finally {
    window.dispatchEvent(new window.Event('pagehide'));
    document.querySelector('#qingyin-label-helper-root')?.remove();
    if (previousChrome) globalThis.chrome = previousChrome; else delete globalThis.chrome;
  }
});

test('修改产地会在防抖后保存到当前模板', async () => {
  const seed = { schema: SETTINGS_SCHEMA, templates: defaultTemplates(), selected: 'local-default', layouts: {} };
  const data = { qingyinLabelSettings: structuredClone(seed) };
  const storage = {
    async get(keys) { return structuredClone(Object.fromEntries(keys.map(key => [key, data[key]]))); },
    async set(values) { Object.assign(data, structuredClone(values)); },
  };
  const store = createSettingsStore(storage), previousChrome = globalThis.chrome;
  globalThis.chrome = { runtime: { sendMessage: async packet => ({ ok: true, settings: await store(packet.operation, packet.patch) }) } };
  try {
    window.dispatchEvent(new window.Event('pagehide'));
    document.querySelector('#qingyin-label-helper-root')?.remove();
    await mountLabelApp(await createExtensionServices(), './style.css');
    const root = document.querySelector('#qingyin-label-helper-root').shadowRoot, input = root.querySelector('#origin');
    assert.equal(input.value, 'China');
    input.value = 'Vietnam'; input.dispatchEvent(new window.Event('input'));
    await until(() => data.qingyinLabelSettings.templates.find(template => template.id === 'local-default')?.origin === 'Vietnam');
    assert.equal(data.qingyinLabelSettings.templates.find(template => template.id === 'local-7040').origin, 'China');
  } finally {
    window.dispatchEvent(new window.Event('pagehide'));
    document.querySelector('#qingyin-label-helper-root')?.remove();
    if (previousChrome) globalThis.chrome = previousChrome; else delete globalThis.chrome;
  }
});

test('重复标签的 PDF 只上报少量进度事件', async () => {
  const events = [];
  const result = await generatePdf({ records: [{ ...localRecords[0], quantity: 300 }], template: local7040Template, dpi: 300, onProgress: event => events.push(event) });
  assert.equal(result.pages, 300);
  assert(events.length <= 5, `进度事件应节流，实际 ${events.length} 次`);
  assert.equal(events.at(-1).percent, 100);
});
