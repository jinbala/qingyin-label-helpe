import { localTemplate, SETTINGS_SCHEMA } from './templates.mjs';
import { normalizeLayout } from './layout.mjs';

export const BACKUP_SCHEMA = 'qingyin-template-backup/v1';

function checkedSettings(value) {
  if (!value || !Array.isArray(value.templates) || !value.templates.length || value.templates.length > 500) throw new Error('备份需包含 1–500 个轻印本地模板。');
  if (value.layouts !== undefined && (!value.layouts || typeof value.layouts !== 'object' || Array.isArray(value.layouts))) throw new Error('备份的位置设置格式无效。');
  const templates = value.templates.map(localTemplate), seen = new Set(), layouts = [];
  for (const template of templates) {
    if (typeof template.id !== 'string' || !/^[\w-]{1,160}$/.test(template.id)) throw new Error('备份的模板编号无效。');
    if (seen.has(template.id)) throw new Error('备份中有重复的模板编号。');
    seen.add(template.id);
    if (Object.hasOwn(value.layouts || {}, template.id)) layouts.push([template.id, normalizeLayout(value.layouts[template.id], template.width, template.height)]);
  }
  return { schema: SETTINGS_SCHEMA, templates, layouts: Object.fromEntries(layouts), selected: seen.has(value.selected) ? value.selected : templates[0].id };
}

export function createTemplateBackup(settings) {
  return { schema: BACKUP_SCHEMA, createdAt: new Date().toISOString(), settings: checkedSettings(settings) };
}

// Merge a portable backup into a different extension's storage. Never replace
// an existing template or position with a conflicting imported ID.
export function mergeTemplateBackup(current, backup) {
  if (backup?.schema !== BACKUP_SCHEMA || backup.settings?.schema !== SETTINGS_SCHEMA) throw new Error('请选择轻印“备份全部模板”导出的备份 JSON。单个模板请使用“导入 JSON”。');
  const incoming = checkedSettings(backup.settings), templates = [...current.templates], layouts = new Map(Object.entries(current.layouts || {})), mapping = new Map();
  const byId = new Map(templates.map(template => [template.id, template]));
  let added = 0, skipped = 0;
  for (const original of incoming.templates) {
    let template = original;
    const existing = byId.get(template.id), layout = incoming.layouts[template.id] || template.layout || {};
    if (existing) {
      const existingLayout = normalizeLayout(layouts.get(existing.id) || existing.layout || {}, existing.width, existing.height);
      if (JSON.stringify(localTemplate(existing)) === JSON.stringify(template) && JSON.stringify(existingLayout) === JSON.stringify(normalizeLayout(layout, template.width, template.height))) {
        mapping.set(original.id, existing.id); skipped++; continue;
      }
      template = localTemplate({ ...template, id: `local-${crypto.randomUUID()}`, name: `${String(template.name || '未命名模板').slice(0, 74)}（导入）` });
    }
    mapping.set(original.id, template.id); templates.push(template); byId.set(template.id, template); added++;
    if (Object.hasOwn(incoming.layouts, original.id)) layouts.set(template.id, incoming.layouts[original.id]);
  }
  return { settings: { schema: SETTINGS_SCHEMA, templates, layouts: Object.fromEntries(layouts), selected: mapping.get(incoming.selected) || current.selected }, added, skipped };
}
