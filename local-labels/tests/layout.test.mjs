import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeLayout, dragParentScale } from '../src/core/layout.mjs';
import { validateTemplate } from '../src/core/core.mjs';

test('位置设置拒绝非法值，导出再导入保持毫米偏移和缩放', () => {
  const layout = normalizeLayout({ parts: { barcode: { x: 1.2, y: -2.5, scale: 90 }, size: { x: -0.5, y: 0.1, scale: 120 } } }, 70, 40);
  const template = validateTemplate({ kind: 'simple', width: 70, height: 40, layout });
  assert.deepEqual(validateTemplate(JSON.parse(JSON.stringify(template))).layout, layout);
  for (const value of [null, { version: 2 }, { parts: [] }, { parts: { unknown: {} } }, { parts: { label: { x: Infinity } } }, { parts: { label: { x: 71 } } }, { parts: { size: { y: -41 } } }, { parts: { bars: { scale: 0 } } }]) assert.throws(() => normalizeLayout(value, 70, 40));
});

test('拖动换算考虑标签整体与条码区域两级缩放', () => {
  const layout = normalizeLayout({ parts: { label: { scale: 150 }, barcode: { scale: 125 } } });
  assert.equal(dragParentScale(layout, 'label'), 1);
  assert.equal(dragParentScale(layout, 'content'), 1.5);
  assert.equal(dragParentScale(layout, 'barcode'), 1.5);
  assert.equal(dragParentScale(layout, 'sku'), 1.875);
});
