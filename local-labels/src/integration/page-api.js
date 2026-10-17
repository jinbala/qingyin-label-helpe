(() => {
  if (window.__qingyinLabelPageApiV1) return;
  window.__qingyinLabelPageApiV1 = true;
  const paths = new Set([
    '/bg-visage-mms/labelcode/pageQuery',
    '/marvel-mms/cn/api/kiana/venom/purchase/order/printProductSkuLabelForPurchaseOrder',
    '/mms/venom/api/supplier/purchase/manager/printProductSkuLabelForPurchaseOrder',
    '/oms/bg/venom/api/supplier/purchase/manager/querySubOrderList',
    '/mms/venom/api/supplier/purchase/manager/querySubOrderList',
    '/bgSongbird-api/supplier/deliverGoods/management/printProductSkuLabel',
    '/bg-anniston-mms/translation/batchQuery',
  ]);
  const hosts = new Set(['seller.kuajingmaihuo.com', 'agentseller.temu.com', 'seller.temu.com', 'agentseller-us.temu.com', 'agentseller-eu.temu.com']);
  const pending = new Map();
  const reply = data => window.postMessage({ type: 'QINGYIN_LABEL_API_RESULT_V1', ...data }, location.origin);
  window.addEventListener('message', event => {
    if (event.source !== window || event.origin !== location.origin) return;
    const message = event.data;
    if (!message || !/^[a-f0-9-]{36}$/.test(message.id || '')) return;
    if (message.type === 'QINGYIN_LABEL_API_CANCEL_V1') { pending.get(message.id)?.abort(); return; }
    if (message.type !== 'QINGYIN_LABEL_API_REQUEST_V1') return;
    const { id } = message;
    try {
      const url = new URL(message.url);
      if (url.protocol !== 'https:' || !hosts.has(url.hostname) || !paths.has(url.pathname) || url.search || url.hash || url.username || url.password || url.port) throw new Error('不支持的标签接口地址。');
      if (!/^\d{1,30}$/.test(String(message.mallId))) throw new Error('店铺 Mall ID 无效。');
      if (pending.has(id) || pending.size >= 8) throw new Error('请求过多，请等待当前任务完成。');
      const body = JSON.stringify(message.data);
      if (!body || body.length > 200000) throw new Error('标签请求数据无效或过大。');
      const xhr = new XMLHttpRequest();
      pending.set(id, xhr); reply({ id, accepted: true });
      const finish = data => { if (!pending.delete(id)) return; reply({ id, ...data }); };
      xhr.open('POST', url.href, true); xhr.withCredentials = true; xhr.timeout = 45000;
      xhr.setRequestHeader('Content-Type', 'application/json;charset=UTF-8');
      xhr.setRequestHeader('MallId', String(message.mallId));
      xhr.onload = () => {
        if (xhr.status < 200 || xhr.status >= 300) { finish({ error: `TEMU 返回 HTTP ${xhr.status}，请确认后台登录状态。` }); return; }
        try { finish({ result: JSON.parse(xhr.responseText) }); }
        catch { finish({ error: 'TEMU 返回了非 JSON 数据，请刷新后台后重试。' }); }
      };
      xhr.onerror = () => finish({ error: 'TEMU 网络请求失败，请检查登录状态与网络。' });
      xhr.ontimeout = () => finish({ error: 'TEMU 请求超时，请稍后重试。' });
      xhr.onabort = () => finish({ error: '请求已取消。' });
      xhr.send(body);
    } catch (error) { pending.delete(id); reply({ id, error: error.message }); }
  });
  window.addEventListener('pagehide', () => { for (const xhr of pending.values()) xhr.abort(); pending.clear(); }, { once: true });
})();
