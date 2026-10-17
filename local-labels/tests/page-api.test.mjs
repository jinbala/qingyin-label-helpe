import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../src/integration/page-api.js', import.meta.url), 'utf8');
function environment() {
  const callbacks = new Map(), sent = [], requests = [];
  const window = {
    __otherExtensionActive: true,
    __otherPageApi: true,
    __otherInterceptor: Object.freeze({ originalFetch: 'other-extension-sentinel' }),
    addEventListener(name, fn) { callbacks.set(name, fn); },
    postMessage(message) { sent.push(message); },
  };
  class Xhr {
    constructor() { this.headers = {}; requests.push(this); }
    open(method, url) { this.method = method; this.url = url; }
    setRequestHeader(key, value) { this.headers[key] = value; }
    send(body) { this.body = body; }
    abort() { this.aborted = true; this.onabort?.(); }
  }
  const origin = 'https://seller.kuajingmaihuo.com';
  vm.runInNewContext(source, { window, location: { origin }, URL, XMLHttpRequest: Xhr });
  const dispatch = data => callbacks.get('message')({ data, source: window, origin });
  return { dispatch, sent, requests, callbacks, window, Xhr };
}
const message = () => ({ type: 'QINGYIN_LABEL_API_REQUEST_V1', id: crypto.randomUUID(), url: 'https://seller.kuajingmaihuo.com/bg-visage-mms/labelcode/pageQuery', mallId: '123', data: { page: 1, productSkuIdList: ['1001'] } });

test('页面请求保留页面 XMLHttpRequest、凭证与店铺头，并传回结果', () => {
  const env = environment(), request = message(); env.dispatch(request);
  assert.equal(env.sent[0].accepted, true);
  const xhr = env.requests[0]; assert.equal(xhr.withCredentials, true); assert.equal(xhr.timeout, 45000);
  assert.equal(xhr.method, 'POST'); assert.equal(xhr.headers.MallId, '123'); assert.equal(xhr.headers.Clientid, undefined);
  xhr.status = 200; xhr.responseText = '{"success":true,"result":{"pageItems":[]}}'; xhr.onload();
  assert.equal(env.sent.at(-1).result.success, true);
  assert.equal(env.sent.at(-1).id, request.id);
});

test('页面通道拒绝修改接口、外站、URL 凭证和错误店铺 ID', () => {
  for (const data of [
    { url: 'https://seller.kuajingmaihuo.com/product/delete' },
    { url: 'https://example.com/bg-visage-mms/labelcode/pageQuery' },
    { url: 'https://user:password@seller.kuajingmaihuo.com/bg-visage-mms/labelcode/pageQuery' },
    { mallId: '<script>' },
  ]) {
    const env = environment(); env.dispatch({ ...message(), ...data });
    assert.equal(env.requests.length, 0); assert.equal(typeof env.sent.at(-1).error, 'string');
  }
});

test('取消和 HTTP 错误释放请求；可重试同一个 ID', () => {
  const env = environment(), request = message(); env.dispatch(request);
  env.dispatch({ type: 'QINGYIN_LABEL_API_CANCEL_V1', id: request.id });
  assert.equal(env.requests[0].aborted, true);
  assert.match(env.sent.at(-1).error, /取消/);
  env.dispatch(request); assert.equal(env.requests.length, 2);
  env.requests[1].status = 403; env.requests[1].onload();
  assert.match(env.sent.at(-1).error, /403/);
});

test('保留其他扩展的全局标记与拦截器，忽略其他扩展的通信包', () => {
  const env = environment();
  assert.equal(env.window.__otherExtensionActive, true);
  assert.equal(env.window.__otherPageApi, true);
  assert.equal(env.window.__otherInterceptor.originalFetch, 'other-extension-sentinel');
  assert.equal(env.window.__qingyinLabelPageApiV1, true);
  assert.equal(env.requests.length, 0);
  env.dispatch({ ...message(), type: 'OTHER_EXTENSION_API_REQUEST' });
  env.dispatch({ otherExtensionPacket: true, type: 'request', name: 'getClientId' });
  assert.equal(env.requests.length, 0); assert.equal(env.sent.length, 0);
  env.dispatch(message()); assert.equal(env.requests.length, 1);
  assert.equal(env.window.__otherInterceptor.originalFetch, 'other-extension-sentinel');
});
