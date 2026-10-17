import { normalizeLayout } from './layout.mjs';

export const BARCODE_MARGIN_MM = 3;
export const BARCODE_FRAME_MM = .2;

export function defaultBarcodeBox(width, height) {
  const w = Math.min(width - 2 * BARCODE_MARGIN_MM, height * .46 * 700 / 185);
  const h = w * 185 / 700;
  return { x: (width - w) / 2, y: height - BARCODE_MARGIN_MM - h, w, h };
}

export function barcodeBounds(template, value) {
  const layout = normalizeLayout(value ?? template.layout, template.width, template.height);
  const elements = template.kind === 'design' ? template.elements.filter(element => element.type === 'barcode' && element.visible !== false) : [defaultBarcodeBox(template.width, template.height)];
  if (!elements.length) throw new Error('模板中没有商品条码区域，请先在设计器中添加。');
  const region = layout.parts.barcode, label = layout.parts.label;
  const points = elements.flatMap(element => {
    const angle = (element.rotation || 0) * Math.PI / 180, cos = Math.cos(angle), sin = Math.sin(angle);
    const corners = [[0,0],[element.w,0],[0,element.h],[element.w,element.h]];
    const frame = layout.parts.frame, sx = element.w / 700, sy = element.h / 185;
    const inset = Math.max(BARCODE_FRAME_MM / sx, BARCODE_FRAME_MM / sy) / 2;
    const frameCorners = corners.map(([x,y]) => [frame.x + inset * sx + (x - inset * sx) * frame.scale / 100, frame.y + inset * sy + (y - inset * sy) * frame.scale / 100]);
    return [...corners, ...frameCorners].map(([x,y]) => {
      const rotatedX = element.x + element.w / 2 + (x - element.w / 2) * cos - (y - element.h / 2) * sin;
      const rotatedY = element.y + element.h / 2 + (x - element.w / 2) * sin + (y - element.h / 2) * cos;
      return [(rotatedX * region.scale / 100 + region.x) * label.scale / 100 + label.x,
        (rotatedY * region.scale / 100 + region.y) * label.scale / 100 + label.y];
    });
  });
  const left = Math.min(...points.map(point => point[0])), top = Math.min(...points.map(point => point[1]));
  const right = Math.max(...points.map(point => point[0])), bottom = Math.max(...points.map(point => point[1]));
  return { left, top, right, bottom, width: right - left, height: bottom - top };
}

export function insetBarcodeLayout(template, value) {
  const layout = normalizeLayout(value ?? template.layout, template.width, template.height), bounds = barcodeBounds(template, layout);
  // A small allowance keeps rounding to the UI's 0.1 mm step inside the margin.
  const margin = BARCODE_MARGIN_MM + .1, region = layout.parts.barcode, label = layout.parts.label;
  const ratio = Math.min(1, (template.width - margin * 2) / bounds.width, (template.height - margin * 2) / bounds.height);
  const scale = Math.floor(region.scale * ratio + 1e-8);
  if (scale < 50) throw new Error('条码区域过大，请先在编辑模板中缩小尺寸，再内缩边框。');
  const actualRatio = scale / region.scale;
  const targetLeft = (template.width - bounds.width * actualRatio) / 2;
  const targetTop = Math.max(margin, Math.min(bounds.top, template.height - margin - bounds.height * actualRatio));
  const dx = targetLeft - bounds.left * actualRatio, dy = targetTop - bounds.top * actualRatio;
  const round = number => Math.round(number * 10) / 10;
  layout.parts.barcode = {
    x: round(region.x * actualRatio + ((actualRatio - 1) * label.x + dx) / (label.scale / 100)),
    y: round(region.y * actualRatio + ((actualRatio - 1) * label.y + dy) / (label.scale / 100)), scale,
  };
  return normalizeLayout(layout, template.width, template.height);
}
