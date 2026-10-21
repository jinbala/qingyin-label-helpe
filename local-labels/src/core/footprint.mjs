// chrome.storage.local keeps 10 MB unless the extension requests
// unlimitedStorage. This extension deliberately asks only for `storage`, so the
// budget is enforced here instead of surfacing as an opaque quota failure after
// the user has spent time editing.
export const STORAGE_BUDGET_BYTES = 9.5 * 1024 * 1024;
export const STORAGE_LIMIT_LABEL = '10 MB';

const MEGABYTE = 1024 * 1024;
const text = value => (typeof value === 'string' ? value.length : 0);

// Cheap estimate of what a template costs once stored. Embedded images and
// free text dominate, and base64 keeps one character per stored byte, so this
// needs no serialisation of the whole library.
export function templatePayloadBytes(template) {
  if (!template) return 0;
  let bytes = 96;
  for (const key of ['id', 'name', 'productName', 'manufacturer', 'address', 'responsiblePerson', 'contact', 'warning', 'origin']) bytes += text(template[key]);
  for (const element of template.elements || []) {
    bytes += 64 + text(element.name) + text(element.text) + text(element.src);
  }
  return bytes;
}

export function settingsPayloadBytes(settings) {
  let bytes = 256;
  for (const template of settings?.templates || []) bytes += templatePayloadBytes(template);
  return bytes;
}

export const formatMegabytes = bytes => `${(bytes / MEGABYTE).toFixed(1)} MB`;

// The largest templates, so a refusal can name what the user should remove.
export function largestTemplates(settings, count = 3) {
  return [...(settings?.templates || [])]
    .map(template => ({ name: String(template.name || '未命名模板'), bytes: templatePayloadBytes(template) }))
    .filter(item => item.bytes > MEGABYTE / 2)
    .sort((left, right) => right.bytes - left.bytes)
    .slice(0, count);
}
