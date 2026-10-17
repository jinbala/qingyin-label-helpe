import { SELLER_HOSTS } from '../core/core.mjs';
import { OPEN_PANEL } from '../integration/extension-api.mjs';

const status = document.querySelector('#status'), button = document.querySelector('#open');
button.addEventListener('click', async () => {
  button.disabled = true;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url || !SELLER_HOSTS.has(new URL(tab.url).hostname)) throw new Error('请先切到 TEMU 商家后台的备货、发货或商品标签页面。');
    const response = await chrome.tabs.sendMessage(tab.id, { type: OPEN_PANEL });
    if (!response?.ok) throw new Error(response?.error || '打开标签打印失败。');
    window.close();
  } catch (error) { status.textContent = error.message.includes('Receiving end') ? '请刷新 TEMU 页面后重试。' : error.message; }
  finally { button.disabled = false; }
});
document.querySelector('#preview').addEventListener('click', () => chrome.tabs.create({ url: new URL('../../preview/index.html', import.meta.url).href }));
