import test from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './dom-runtime.mjs';
import { createSettingsStore } from '../src/printing/settings-store.mjs';
import { defaultTemplates, SETTINGS_SCHEMA } from '../src/core/templates.mjs';

// The loader is a classic content script: it must register its message
// listener synchronously, show a launcher, and only import the panel on the
// first open. Importing it here executes that script for real; chrome-extension
// URLs are mapped to the source files so Node can resolve the dynamic imports.
const dom = installDom();
globalThis.localStorage = dom.window.localStorage;
const wait = async predicate => { for (let i = 0; i < 150; i++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 20)); } throw new Error('加载器状态未就绪'); };

test('加载器按需挂载：打开前不读取模板，点击后加载并打开面板', async () => {
  const project = new URL('../', import.meta.url);
  const data = { qingyinLabelSettings: { schema: SETTINGS_SCHEMA, templates: defaultTemplates(), layouts: {}, selected: 'local-default' } };
  const storage = {
    async get(keys) { return structuredClone(Object.fromEntries(keys.map(key => [key, data[key]]))); },
    async set(values) { Object.assign(data, structuredClone(values)); },
  };
  const store = createSettingsStore(storage);
  let requests = 0, listener;
  const previousChrome = globalThis.chrome;
  globalThis.chrome = {
    runtime: {
      id: 'own-extension',
      getURL: path => new URL(path, project).href,
      getManifest: () => ({ content_scripts: [{ js: ['vendor/JsBarcode.all.min.js', 'src/integration/loader.js'] }] }),
      onMessage: { addListener: value => { listener = value; } },
      sendMessage: async packet => { requests++; return { ok: true, settings: await store(packet.operation, packet.patch) }; },
    },
    tabs: { create: async () => ({}) },
  };
  try {
    await import(new URL('src/integration/loader.js', project).href);
    await wait(() => {
      const button = document.querySelector('#qingyin-label-helper-launcher')?.shadowRoot?.querySelector('button');
      return button && !button.hidden;
    });
    assert.equal(requests, 0, '打开面板前不得读取模板存储');
    assert.equal(document.querySelector('#qingyin-label-helper-root'), null);
    assert.equal(typeof listener, 'function', '消息监听必须同步注册');
    const button = document.querySelector('#qingyin-label-helper-launcher').shadowRoot.querySelector('button');
    button.click();
    await wait(() => document.querySelector('#qingyin-label-helper-root')?.shadowRoot?.querySelector('#overlay')?.hidden === false);
    assert(requests > 0, '打开后才读取模板');
    assert.equal(document.querySelector('#qingyin-label-helper-launcher'), null, '面板挂载后移除轻量入口');
    let reply;
    assert.equal(listener({ type: 'QINGYIN_LABEL_OPEN_PANEL_V1' }, { id: 'own-extension' }, value => { reply = value; }), true);
    await wait(() => reply !== undefined);
    assert.equal(reply.ok, true, JSON.stringify(reply));
  } finally {
    window.dispatchEvent(new window.Event('pagehide'));
    document.querySelector('#qingyin-label-helper-root')?.remove();
    document.querySelector('#qingyin-label-helper-launcher')?.remove();
    if (previousChrome) globalThis.chrome = previousChrome; else delete globalThis.chrome;
  }
});

test.after(() => { dom.window.close(); });
