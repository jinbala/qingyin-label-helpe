import { applySettingsPatch } from '../core/settings.mjs';
import { SETTINGS_SCHEMA } from '../core/templates.mjs';
import { STORAGE_BUDGET_BYTES, STORAGE_LIMIT_LABEL, settingsPayloadBytes, largestTemplates, formatMegabytes } from '../core/footprint.mjs';

export function createSettingsStore(storage) {
  let pending = Promise.resolve();
  return (operation, patch) => {
    const job = pending.catch(() => {}).then(async () => {
      const stored = await storage.get(['qingyinLabelSettings']);
      let settings = stored.qingyinLabelSettings || {}, migrationNotice;
      if (stored.qingyinLabelSettings && settings.schema !== SETTINGS_SCHEMA) {
        const archive = await storage.get(['qingyinArchivedSettingsV1']);
        if (!archive.qingyinArchivedSettingsV1) await storage.set({ qingyinArchivedSettingsV1: settings });
        settings = { schema: SETTINGS_SCHEMA };
        await storage.set({ qingyinLabelSettings: settings });
        migrationNotice = '旧版模板已备份并停用。请使用轻印本地模板，填写自己的标签内容。';
      }
      if (operation === 'load') return { ...settings, ...(migrationNotice ? { migrationNotice } : {}) };
      if (operation !== 'save') throw new Error('不支持的模板存储操作。');
      const next = { ...applySettingsPatch(settings, patch), writeId: crypto.randomUUID() };
      // Refuse before writing: the browser would otherwise reject the save with
      // an opaque quota error after the user has already spent time editing.
      const footprint = settingsPayloadBytes(next);
      if (footprint > STORAGE_BUDGET_BYTES) {
        const largest = largestTemplates(next).map(item => `${item.name}（${formatMegabytes(item.bytes)}）`).join('、');
        throw new Error(`本机模板存储空间不足：模板与图片合计约 ${formatMegabytes(footprint)}，浏览器上限约 ${STORAGE_LIMIT_LABEL}。请先导出备份，再删除不用的模板或缩小图片${largest ? `；占用最大：${largest}` : ''}。`);
      }
      try { await storage.set({ qingyinLabelSettings: next }); }
      catch (error) {
        if (/quota|QUOTA_BYTES/i.test(error.message)) throw new Error('本机模板存储空间不足，请导出备份后删除不用的模板或缩小图片。');
        throw error;
      }
      const check = await storage.get(['qingyinLabelSettings']);
      if (check.qingyinLabelSettings?.writeId !== next.writeId) throw new Error('模板写入后未能核对成功，请保持编辑器打开并重试。');
      return next;
    });
    pending = job; return job;
  };
}
