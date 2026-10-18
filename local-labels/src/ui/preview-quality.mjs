// Rasterize above the displayed screen resolution, while bounding memory use.
// Print DPI is deliberately independent of the on-screen preview.
export function previewDpi(template, viewport, pixelRatio = 1) {
  const ratio = Number.isFinite(pixelRatio) && pixelRatio > 0 ? pixelRatio : 1;
  const scale = Math.min(Math.max(1, viewport.width) / template.width, Math.max(1, viewport.height) / template.height);
  const requested = scale * 25.4 * ratio * 1.5;
  const limit = Math.min(3200 * 25.4 / Math.max(template.width, template.height), Math.sqrt(4000000 / (template.width * template.height)) * 25.4);
  return Math.min(limit, Math.max(96, Math.ceil(requested / 24) * 24));
}

export function previewViewport(container, fallbackWidth, maxHeight) {
  const style = container.ownerDocument.defaultView.getComputedStyle(container);
  const inset = ['paddingLeft', 'paddingRight', 'borderLeftWidth', 'borderRightWidth'].reduce((sum, key) => sum + (parseFloat(style[key]) || 0), 0);
  const measured = container.getBoundingClientRect().width;
  return { width: Math.max(1, measured > inset ? measured - inset : fallbackWidth), height: maxHeight };
}
