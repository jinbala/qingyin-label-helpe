import { SELLER_HOSTS } from '../core/core.mjs';
import { OPEN_PDF, SETTINGS_REQUEST } from './extension-api.mjs';
import { createSettingsClient } from '../core/settings.mjs';

export async function createExtensionServices() {
  const settingsRequest = async (operation, patch) => {
    const response = await chrome.runtime.sendMessage({ type: SETTINGS_REQUEST, operation, ...(patch ? { patch } : {}) });
    if (!response?.ok) throw new Error(response?.error || '无法访问本机模板存储，请重新加载轻印后刷新页面。');
    return response.settings;
  };
  return {
    ...createSettingsClient(settingsRequest),
    async request(config) {
      const url = new URL(config.url);
      if (url.protocol !== 'https:' || !SELLER_HOSTS.has(url.hostname)) throw new Error('不支持的 TEMU 请求地址。');
      return requestInPage(config);
    },
    async openPdf(bytes, filename) {
      if (bytes.length > 24 * 1024 * 1024) throw new Error('PDF 超过 24 MB，请减少商品数量或打印分辨率。');
      let binary = '';
      for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
      const response = await chrome.runtime.sendMessage({ type: OPEN_PDF, base64: btoa(binary), filename });
      if (!response?.ok) throw new Error(response?.error || '无法打开 PDF 打印预览。');
    },
    async getMallId() {
      return localStorage.getItem('agentseller-mall-info-id') || localStorage.getItem('mall-info-id') || '';
    },
  };
}

// Run seller requests through the page's XMLHttpRequest so its existing request
// wrappers/signing continue to apply. Only the read endpoints in page-api.js are allowed.
export function requestInPage(config) {
  return new Promise((resolve, reject) => {
    config.signal?.throwIfAborted();
    const id = crypto.randomUUID();
    let acknowledged = false;
    const cleanup = () => { clearTimeout(timer); clearTimeout(ackTimer); window.removeEventListener('message', receive); config.signal?.removeEventListener('abort', abort); };
    const fail = error => { cleanup(); reject(error); };
    const abort = () => {
      window.postMessage({ type: 'QINGYIN_LABEL_API_CANCEL_V1', id }, location.origin);
      fail(new DOMException('已取消', 'AbortError'));
    };
    const receive = event => {
      if (event.source !== window || event.origin !== location.origin || event.data?.type !== 'QINGYIN_LABEL_API_RESULT_V1' || event.data.id !== id) return;
      if (event.data.accepted) { acknowledged = true; clearTimeout(ackTimer); return; }
      cleanup();
      if (event.data.error) reject(new Error(event.data.error)); else resolve(event.data.result);
    };
    const timer = setTimeout(() => { window.postMessage({ type: 'QINGYIN_LABEL_API_CANCEL_V1', id }, location.origin); fail(new Error('TEMU 请求超时，请稍后重试。')); }, 50000);
    const ackTimer = setTimeout(() => { if (!acknowledged) fail(new Error('页面通信模块未就绪，请重新加载扩展并刷新商家后台。')); }, 2000);
    window.addEventListener('message', receive);
    config.signal?.addEventListener('abort', abort, { once: true });
    window.postMessage({ type: 'QINGYIN_LABEL_API_REQUEST_V1', id, url: config.url, mallId: config.headers.MallId, data: config.data }, location.origin);
  });
}
