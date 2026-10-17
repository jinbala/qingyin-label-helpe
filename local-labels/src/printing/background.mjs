import { pdfStore, cleanupPdfs } from './pdf-store.mjs';
import { OPEN_PDF, SETTINGS_REQUEST } from '../integration/extension-api.mjs';
import { createSettingsStore } from './settings-store.mjs';

const settingsStore = createSettingsStore(chrome.storage.local);

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (message?.type === SETTINGS_REQUEST) {
    const seller = /^https:\/\/(seller\.kuajingmaihuo\.com|agentseller(?:-us|-eu)?\.temu\.com|seller\.temu\.com)\//.test(sender.url || '');
    const preview = (sender.url || '').startsWith(chrome.runtime.getURL('preview/'));
    if (sender.id !== chrome.runtime.id || !seller && !preview) { reply({ ok: false, error: '请从轻印或 TEMU 商家后台保存模板。' }); return; }
    settingsStore(message.operation, message.patch).then(settings => reply({ ok: true, settings }), error => reply({ ok: false, error: error.message }));
    return true;
  }
  if (message?.type !== OPEN_PDF) return;
  if (sender.id !== chrome.runtime.id || !sender.tab || !/^https:\/\/(seller\.kuajingmaihuo\.com|agentseller(?:-us|-eu)?\.temu\.com|seller\.temu\.com)\//.test(sender.url || '')) {
    reply({ ok: false, error: '请从 TEMU 商家后台打开打印预览。' });
    return;
  }
  (async () => {
    if (typeof message.base64 !== 'string' || message.base64.length > 34 * 1024 * 1024) throw new Error('PDF 数据过大。');
    const binary = atob(message.base64);
    if (!binary.startsWith('%PDF-')) throw new Error('无效的 PDF 文件。');
    const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
    const id = crypto.randomUUID();
    await cleanupPdfs();
    await pdfStore('readwrite', store => store.put({
      id, createdAt: Date.now(), blob: new Blob([bytes], { type: 'application/pdf' }),
      filename: String(message.filename || '合规标签.pdf').replace(/[\\/:*?"<>|]/g, '_'),
    }));
    try { const url = new URL('./print.html', import.meta.url); url.searchParams.set('id', id); await chrome.tabs.create({ url: url.href }); }
    catch (error) { await pdfStore('readwrite', store => store.delete(id)); throw error; }
    reply({ ok: true });
  })().catch(error => reply({ ok: false, error: error.message }));
  return true;
});
