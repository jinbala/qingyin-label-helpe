import { SETTINGS_SCHEMA, localTemplate } from './templates.mjs';
import { normalizeLayout } from './layout.mjs';

const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const keyed = values => new Map((values || []).map(value => [value.id, value]));

export function createSettingsClient(request) {
  let baseline, pending = Promise.resolve();
  return {
    async loadSettings() { const settings = await request('load'); baseline = structuredClone(settings); return settings; },
    readSettings() { return pending.catch(() => {}).then(() => request('load')); },
    saveSettings(settings) {
      const snapshot = structuredClone(settings);
      const job = pending.catch(() => {}).then(async () => {
        if (!baseline) throw new Error('本地模板尚未读取成功，请刷新后再保存。');
        await request('save', settingsPatch(baseline, snapshot));
        // This page must not delete templates it has not seen in other tabs.
        baseline = snapshot;
      });
      pending = job; return job;
    },
  };
}

// Send changes made by this page, never its potentially stale whole library.
export function settingsPatch(previous = {}, next = {}) {
  const patch = {};
  if (Array.isArray(next.templates)) {
    const before = keyed(previous.templates), after = keyed(next.templates);
    patch.templates = [...after.values()].filter(template => !same(before.get(template.id), template));
    patch.deletedTemplates = [...before.keys()].filter(id => !after.has(id));
  }
  if (next.layouts) {
    const before = new Map(Object.entries(previous.layouts || {})), after = new Map(Object.entries(next.layouts));
    patch.layouts = Object.fromEntries([...after].filter(([id, layout]) => !same(before.get(id), layout)));
    patch.deletedLayouts = [...before.keys()].filter(id => !after.has(id));
  }
  if (next.selected !== undefined && next.selected !== previous.selected) patch.selected = next.selected;
  return patch;
}

export function applySettingsPatch(current, patch) {
  if (!patch || typeof patch !== 'object' || !Array.isArray(patch.templates || []) || !Array.isArray(patch.deletedTemplates || []) || !Array.isArray(patch.deletedLayouts || [])) throw new Error('模板保存数据无效。');
  const templates = keyed(current.templates), layouts = new Map(Object.entries(current.layouts || {}));
  for (const id of patch.deletedTemplates || []) { templates.delete(id); layouts.delete(id); }
  for (const value of patch.templates || []) { const template = localTemplate(value); templates.set(template.id, template); }
  for (const id of patch.deletedLayouts || []) layouts.delete(id);
  for (const [id, layout] of Object.entries(patch.layouts || {})) layouts.set(id, normalizeLayout(layout));
  const result = { ...current, schema: SETTINGS_SCHEMA, templates: [...templates.values()], layouts: Object.fromEntries(layouts) };
  if (patch.selected !== undefined) result.selected = String(patch.selected);
  if (result.selected && !templates.has(result.selected)) result.selected = result.templates[0]?.id;
  delete result.migrationNotice;
  return result;
}
