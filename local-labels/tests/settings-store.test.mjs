import test from 'node:test';
import assert from 'node:assert/strict';
import { createSettingsStore } from '../src/printing/settings-store.mjs';
import { createSettingsClient, settingsPatch } from '../src/core/settings.mjs';
import { defaultTemplates, SETTINGS_SCHEMA, localTemplate } from '../src/core/templates.mjs';
import { createDesign, newElement } from '../src/core/design.mjs';
import { normalizeLayout } from '../src/core/layout.mjs';
import { SETTINGS_REQUEST } from '../src/integration/extension-api.mjs';

function memoryStorage() {
  const data = {}; let failure = false, discard = false;
  return { data, fail: value => { failure = value; }, discard: value => { discard = value; },
    async get(keys) { await new Promise(resolve => setTimeout(resolve, 1)); return structuredClone(Object.fromEntries(keys.map(key => [key, data[key]]))); },
    async set(values) { await new Promise(resolve => setTimeout(resolve, 1)); if (failure) throw new Error('QUOTA_BYTES quota exceeded'); if (!discard) Object.assign(data, structuredClone(values)); },
  };
}
const initial = () => ({ schema: SETTINGS_SCHEMA, templates: defaultTemplates(), selected: 'local-default', layouts: {} });

test('两个旧页面同时新建，后续选择、保存位置和删除都不会覆盖另一页的新模板', async () => {
  const storage = memoryStorage(), store = createSettingsStore(storage);
  await store('save', settingsPatch({}, initial()));
  const tabA = createSettingsClient(store), tabB = createSettingsClient(store);
  const a = await tabA.loadSettings(), b = await tabB.loadSettings();
  const alpha = { ...createDesign(), id: 'alpha', name: '页面 A 的模板' }, beta = { ...createDesign(), id: 'beta', name: '页面 B 的模板' };
  const nextA = { ...a, templates: [...a.templates, alpha], selected: 'alpha' }, nextB = { ...b, templates: [...b.templates, beta], selected: 'beta' };
  await Promise.all([tabA.saveSettings(nextA), tabB.saveSettings(nextB)]);
  await tabB.saveSettings({ ...nextB, selected: 'local-default', layouts: { beta: normalizeLayout({ parts: { barcode: { x: 1 } } }) } });
  assert((await tabA.readSettings()).templates.some(template => template.id === 'beta'), '导出备份读取最新库，不改变页面保存基线');
  await tabA.saveSettings({ ...nextA, layouts: { alpha: normalizeLayout({ parts: { label: { x: .5 } } }) } });
  const refreshed = await createSettingsClient(store).loadSettings();
  assert(refreshed.templates.some(template => template.id === 'alpha')); assert(refreshed.templates.some(template => template.id === 'beta'));
  assert.equal(refreshed.layouts.alpha.parts.label.x, .5); assert.equal(refreshed.layouts.beta.parts.barcode.x, 1);
  await tabA.saveSettings({ ...initial(), selected: 'local-default' });
  const deleted = await store('load'); assert(!deleted.templates.some(template => template.id === 'alpha')); assert(deleted.templates.some(template => template.id === 'beta'));
  assert.equal(deleted.layouts.beta.parts.barcode.x, 1);
});

test('写入失败或写后核对失败不能报告成功，失败后可重试且旧模板保留', async () => {
  const storage = memoryStorage(), store = createSettingsStore(storage), client = createSettingsClient(store);
  await client.loadSettings(); const value = initial();
  storage.fail(true); await assert.rejects(client.saveSettings(value), /存储空间不足/);
  assert.equal(storage.data.qingyinLabelSettings, undefined);
  storage.fail(false); storage.discard(true); await assert.rejects(client.saveSettings(value), /未能核对成功/);
  storage.discard(false); await client.saveSettings(value);
  const reloaded = await createSettingsClient(createSettingsStore(storage)).loadSettings();
  assert.equal(reloaded.templates.length, 2); assert.equal(reloaded.selected, 'local-default');
});

test('模板总量超出浏览器配额时在写入前拒绝，并指出占用最大的模板', async () => {
  const storage = memoryStorage(), store = createSettingsStore(storage), client = createSettingsClient(store);
  await client.loadSettings();
  await client.saveSettings(initial());
  const heavy = (id, label) => {
    const template = createDesign();
    template.id = id; template.name = label;
    const image = (suffix, x) => ({ ...newElement('image'), id: `image-${id}-${suffix}`, x, src: `data:image/png;base64,${'A'.repeat(2_700_000)}` });
    template.elements.push(image('a', 1), image('b', 10));
    return localTemplate(template);
  };
  const before = storage.data.qingyinLabelSettings.templates.length;
  await assert.rejects(
    client.saveSettings({ schema: SETTINGS_SCHEMA, templates: [...defaultTemplates(), heavy('heavy-a', '大图模板 A'), heavy('heavy-b', '大图模板 B')], selected: 'heavy-a', layouts: {} }),
    error => /存储空间不足/.test(error.message) && /10 MB/.test(error.message) && /占用最大：大图模板/.test(error.message),
  );
  assert.equal(storage.data.qingyinLabelSettings.templates.length, before, '拒绝时不写入存储');
});

test('后台只接受本扩展的商家页面与模拟验证页的模板读写', async () => {
  const storage = memoryStorage(); let listener;
  const previous = globalThis.chrome;
  globalThis.chrome = { storage: { local: storage }, runtime: { id: 'own-extension', getURL: file => `chrome-extension://own-extension/${file}`, onMessage: { addListener: value => { listener = value; } } } };
  try {
    await import(`../src/printing/background.mjs?settings-test=${crypto.randomUUID()}`);
    const send = (message, sender) => new Promise(resolve => listener(message, sender, resolve));
    const packet = { type: SETTINGS_REQUEST, operation: 'save', patch: settingsPatch({}, initial()) };
    assert.equal((await send(packet, { id: 'other-extension', url: 'https://agentseller.temu.com/stock/' })).ok, false);
    assert.equal((await send(packet, { id: 'own-extension', url: 'https://example.com/' })).ok, false);
    assert.equal((await send(packet, { id: 'own-extension', url: 'https://agentseller.temu.com/stock/order' })).ok, true);
    const preview = await send({ type: SETTINGS_REQUEST, operation: 'load' }, { id: 'own-extension', url: 'chrome-extension://own-extension/preview/index.html' });
    assert.equal(preview.ok, true); assert.equal(preview.settings.templates.length, 2);
  } finally { if (previous) globalThis.chrome = previous; else delete globalThis.chrome; }
});
