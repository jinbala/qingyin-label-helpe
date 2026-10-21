import test from 'node:test';
import assert from 'node:assert/strict';
import { createTemplateBackup, mergeTemplateBackup } from '../src/core/template-backup.mjs';
import { createDesign, newElement } from '../src/core/design.mjs';
import { defaultTemplates, SETTINGS_SCHEMA } from '../src/core/templates.mjs';
import { normalizeLayout } from '../src/core/layout.mjs';
import { createSettingsClient } from '../src/core/settings.mjs';
import { createSettingsStore } from '../src/printing/settings-store.mjs';
import { installDom } from './dom-runtime.mjs';
import { mountLabelApp } from '../src/ui/app.mjs';

const initial = () => ({ schema: SETTINGS_SCHEMA, templates: defaultTemplates(), layouts: {}, selected: 'local-default' });
function sourceSettings() {
  const design = createDesign(), image = newElement('image', 70, 40);
  image.src = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
  design.elements.push(image); design.name = '自建模板备份验证';
  return { ...initial(), templates: [...defaultTemplates(), design], selected: design.id, layouts: { [design.id]: normalizeLayout({ parts: { barcode: { x: 1, scale: 95 } } }) } };
}

test('超过 500 个模板仍可整库备份', () => {
  const base = defaultTemplates()[0];
  const settings = { schema: SETTINGS_SCHEMA, templates: Array.from({ length: 501 }, (_, index) => ({ ...base, id: `local-${index}`, name: `模板 ${index}` })), selected: 'local-0', layouts: {} };
  const backup = createTemplateBackup(settings);
  assert.equal(backup.settings.templates.length, 501);
  assert.equal(backup.settings.selected, 'local-0');
});

test('整库备份经 JSON 跨存储往返，保留模板、嵌入图片和位置；相同模板跳过，冲突另存', () => {
  const source = sourceSettings(), backup = JSON.parse(JSON.stringify(createTemplateBackup(source))), original = JSON.stringify(source);
  const restored = mergeTemplateBackup(initial(), backup);
  assert.equal(restored.added, 1); assert.equal(restored.skipped, 2);
  const id = restored.settings.selected;
  assert(restored.settings.templates.find(template => template.id === id).elements.some(element => element.src?.startsWith('data:image/png;')));
  assert.equal(restored.settings.layouts[id].parts.barcode.x, 1);
  assert.equal(restored.settings.layouts[id].parts.barcode.scale, 95);
  const repeated = mergeTemplateBackup(restored.settings, backup);
  assert.equal(repeated.added, 0); assert.equal(repeated.skipped, 3);
  const conflicting = structuredClone(source); conflicting.templates.at(-1).name = '目标已有模板';
  const merged = mergeTemplateBackup(conflicting, backup);
  assert.equal(merged.added, 1); assert.notEqual(merged.settings.selected, source.selected);
  assert.equal(merged.settings.templates.find(template => template.id === source.selected).name, '目标已有模板');
  assert.equal(merged.settings.layouts[merged.settings.selected].parts.barcode.x, 1);
  assert.equal(JSON.stringify(source), original);
});

test('备份严格拒绝外部对象模板、重复编号或无效位置，失败不修改现有模板', () => {
  const current = initial(), original = JSON.stringify(current), backup = createTemplateBackup(sourceSettings());
  assert.throws(() => mergeTemplateBackup(current, { schema: 'other', settings: backup.settings }), /备份全部模板/);
  const foreign = structuredClone(backup); foreign.settings.templates.push({ kind: 'fabric', content: { objects: [] } });
  assert.throws(() => mergeTemplateBackup(current, foreign), /轻印本地模板/);
  const duplicate = structuredClone(backup); duplicate.settings.templates.push(duplicate.settings.templates[0]);
  assert.throws(() => mergeTemplateBackup(current, duplicate), /重复/);
  const invalid = structuredClone(backup); invalid.settings.layouts[invalid.settings.selected].parts.barcode.x = 1000;
  assert.throws(() => mergeTemplateBackup(current, invalid), /偏移/);
  assert.equal(JSON.stringify(current), original);
});

test('界面备份读取最新保存的数据；另一扩展导入失败不变，重试并重新挂载仍保留模板和位置', async () => {
  const dom = installDom(); await import('../vendor/JsBarcode.all.min.js'); globalThis.JsBarcode = window.JsBarcode;
  const storage = () => {
    const data = {}; let fail = false;
    return { data, setFail(value) { fail = value; }, async get(keys) { return structuredClone(Object.fromEntries(keys.map(key => [key, data[key]]))); }, async set(values) { if (fail) throw new Error('QUOTA_BYTES exceeded'); Object.assign(data, structuredClone(values)); } };
  };
  const pause = () => new Promise(resolve => setTimeout(resolve, 20));
  const until = async condition => { for (let i = 0; i < 250; i++) { if (condition()) return; await pause(); } throw new Error('备份界面等待超时'); };
  const savedCreate = URL.createObjectURL, savedClick = window.HTMLAnchorElement.prototype.click;
  let downloadedBlob, filename;
  URL.createObjectURL = blob => { downloadedBlob = blob; return savedCreate(blob); };
  window.HTMLAnchorElement.prototype.click = function () { filename = this.download; };
  try {
    const a = storage(), aStore = createSettingsStore(a), aClient = createSettingsClient(aStore);
    await aClient.loadSettings(); await aClient.saveSettings(initial());
    await mountLabelApp({ ...aClient, getMallId: async () => '' }, './style.css');
    let root = document.querySelector('#qingyin-label-helper-root').shadowRoot;
    const anotherPage = createSettingsClient(aStore); await anotherPage.loadSettings();
    const source = sourceSettings(); await anotherPage.saveSettings(source);
    root.querySelector('#backup-templates').click(); await until(() => downloadedBlob && filename);
    const backup = JSON.parse(await downloadedBlob.text()); assert.match(filename, /轻印模板备份.*\.json/);
    assert.equal(backup.settings.templates.length, 3, '导出包含其他页面刚保存的模板');
    window.dispatchEvent(new window.Event('pagehide')); document.querySelector('#qingyin-label-helper-root').remove();
    const b = storage(), bClient = createSettingsClient(createSettingsStore(b));
    await bClient.loadSettings();
    const existing = { ...source.templates.at(-1), name: '这个模板不能被覆盖' };
    await bClient.saveSettings({ ...initial(), templates: [existing], selected: existing.id });
    await mountLabelApp({ ...bClient, getMallId: async () => '' }, './style.css');
    root = document.querySelector('#qingyin-label-helper-root').shadowRoot;
    const file = { size: downloadedBlob.size, text: () => downloadedBlob.text() }, input = root.querySelector('#backup-file');
    Object.defineProperty(input, 'files', { configurable: true, value: [file] });
    b.setFail(true); input.dispatchEvent(new window.Event('change'));
    await until(() => root.querySelector('#notice').textContent.includes('存储空间不足'));
    assert.equal(root.querySelector('#templates').children.length, 1); assert.equal(b.data.qingyinLabelSettings.templates.length, 1);
    b.setFail(false); input.dispatchEvent(new window.Event('change'));
    await until(() => root.querySelector('#notice').textContent.includes('备份导入完成'));
    assert.equal(b.data.qingyinLabelSettings.templates.length, 4);
    assert.equal(b.data.qingyinLabelSettings.templates.find(template => template.id === existing.id).name, existing.name);
    const imported = b.data.qingyinLabelSettings.selected;
    assert.equal(b.data.qingyinLabelSettings.layouts[imported].parts.barcode.x, 1);
    window.dispatchEvent(new window.Event('pagehide')); document.querySelector('#qingyin-label-helper-root').remove();
    await mountLabelApp({ ...createSettingsClient(createSettingsStore(b)), getMallId: async () => '' }, './style.css');
    root = document.querySelector('#qingyin-label-helper-root').shadowRoot;
    assert.equal(root.querySelector('#templates').children.length, 4);
    root.querySelector('#layout-part').value = 'barcode'; root.querySelector('#layout-part').dispatchEvent(new window.Event('change'));
    assert.equal(root.querySelector('#layout-x').value, '1'); assert.equal(root.querySelector('#layout-scale').value, '95');
  } finally {
    URL.createObjectURL = savedCreate; window.HTMLAnchorElement.prototype.click = savedClick;
    window.dispatchEvent(new window.Event('pagehide')); dom.window.close();
  }
});
