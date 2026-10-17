import { applySettingsPatch } from '../core/settings.mjs';
import { SETTINGS_SCHEMA } from '../core/templates.mjs';

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
