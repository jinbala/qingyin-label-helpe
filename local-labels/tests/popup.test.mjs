import test from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './dom-runtime.mjs';

const html = '<!doctype html><html><body><p id="status">就绪</p><button id="open"></button><button id="preview"></button></body></html>';
const tick = () => new Promise(resolve => setTimeout(resolve, 10));

test('弹窗在商家页打开面板，成功后关闭窗口', async () => {
  const dom = installDom(html), previousChrome = globalThis.chrome, sent = [];
  let closed = false; dom.window.close = () => { closed = true; };
  globalThis.chrome = {
    tabs: { query: async () => [{ id: 7, url: 'https://seller.kuajingmaihuo.com/main/product/label' }], sendMessage: async (id, message) => { sent.push({ id, message }); return { ok: true }; }, create: async () => ({}) },
  };
  try {
    await import('../src/ui/popup.mjs?case=success');
    dom.window.document.querySelector('#open').click();
    await tick();
    assert.deepEqual(sent, [{ id: 7, message: { type: 'QINGYIN_LABEL_OPEN_PANEL_V1' } }]);
    assert.equal(closed, true);
  } finally {
    if (previousChrome) globalThis.chrome = previousChrome; else delete globalThis.chrome;
  }
});

test('弹窗把连接失效转成刷新提示', async () => {
  const dom = installDom(html), previousChrome = globalThis.chrome;
  globalThis.chrome = {
    tabs: { query: async () => [{ id: 7, url: 'https://seller.kuajingmaihuo.com/main/product/label' }], sendMessage: async () => { throw new Error('Could not establish connection. Receiving end does not exist.'); }, create: async () => ({}) },
  };
  try {
    await import('../src/ui/popup.mjs?case=stale');
    dom.window.document.querySelector('#open').click();
    await tick();
    assert.equal(dom.window.document.querySelector('#status').textContent, '请刷新 TEMU 页面后重试。');
    assert.equal(dom.window.document.querySelector('#open').disabled, false);
  } finally {
    if (previousChrome) globalThis.chrome = previousChrome; else delete globalThis.chrome;
  }
});
