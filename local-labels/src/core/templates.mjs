import { validateTemplate } from './core.mjs';
import { DESIGN_SCHEMA } from './design.mjs';

export const TEMPLATE_SCHEMA = 'qingyin-template/v1';
export const SETTINGS_SCHEMA = 'qingyin-settings/v2';

export function localTemplate(value) {
  if (!(value?.schema === TEMPLATE_SCHEMA && value.kind === 'simple' || value?.schema === DESIGN_SCHEMA && value.kind === 'design')) {
    throw new Error('只支持轻印本地模板 JSON，请新建模板并填写自己的标签内容。');
  }
  return validateTemplate(value);
}

export function defaultTemplates() {
  return [
    { id: 'local-default', name: '通用标签 · 60 × 40 mm', width: 60, height: 40, productName: '商品标签 {{skc}}' },
    { id: 'local-7040', name: '自定义信息标签 · 70 × 40 mm', width: 70, height: 40, productName: '' },
  ].map(value => localTemplate({ schema: TEMPLATE_SCHEMA, kind: 'simple', manufacturer: '', address: '', responsiblePerson: '', contact: '', warning: '', origin: 'China', ...value }));
}
