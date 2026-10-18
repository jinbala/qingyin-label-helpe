import { previewViewport } from './preview-quality.mjs';

export function mountPreviewDialog({ root, preview, trigger, controls, mainPanel, onOpen, onClose, onResize = () => {} }) {
  const home = controls.parentElement;
  const overlay = document.createElement('div'); overlay.className = 'layout-overlay'; overlay.hidden = true;
  overlay.innerHTML = `<section class="layout-dialog" role="dialog" aria-modal="true" aria-labelledby="layout-dialog-title" tabindex="-1">
    <header class="header"><h2 id="layout-dialog-title">标签位置调整</h2><span class="badge">大图预览</span><button class="close" id="close-layout-preview" aria-label="关闭大图">×</button></header>
    <div class="layout-dialog-body"><div><p class="hint">选择右侧调整部分，在标签上拖动定位，松开鼠标更新。</p><div id="layout-preview" class="layout-stage"></div></div><aside id="layout-controls"></aside></div>
    <footer class="layout-dialog-footer"><span class="hint">下次保留这些位置，请点击“保存位置”。</span><button id="finish-layout-preview" class="primary">返回打印</button></footer>
  </section>`;
  root.append(overlay);
  const stage = overlay.querySelector('#layout-preview'), slot = overlay.querySelector('#layout-controls'), closeButton = overlay.querySelector('#close-layout-preview');
  let returnFocus, resizeTimer, viewportKey;
  const getViewport = () => previewViewport(stage, Math.max(220, window.innerWidth - 440), Math.max(220, window.innerHeight - 240));
  const signature = () => { const viewport = getViewport(); return `${Math.round(viewport.width)}:${viewport.height}:${window.devicePixelRatio || 1}`; };
  const fit = canvas => {
    const viewport = getViewport();
    canvas.style.width = `${Math.min(viewport.width, viewport.height * canvas.width / canvas.height)}px`;
    canvas.style.maxHeight = 'none';
  };
  const empty = message => { stage.replaceChildren(); const note = document.createElement('p'); note.className = 'hint'; note.textContent = message; stage.append(note); };
  const paint = canvas => {
    if (overlay.hidden) return;
    let target = stage.querySelector('canvas');
    if (!target) { target = document.createElement('canvas'); target.setAttribute('aria-label', '可调整位置的标签大图'); stage.replaceChildren(target); }
    target.width = canvas.width; target.height = canvas.height; target.getContext('2d').drawImage(canvas, 0, 0);
    target.style.filter = 'grayscale(1)'; fit(target);
  };
  const open = () => {
    if (!overlay.hidden) return;
    returnFocus = root.activeElement || trigger;
    overlay.hidden = false; mainPanel.inert = true; slot.append(controls);
    viewportKey = signature();
    const canvas = preview.querySelector('canvas');
    if (canvas) paint(canvas); else empty('读取商品后，标签会显示在这里。也可以先调整并保存位置。');
    closeButton.focus(); onOpen();
  };
  const close = () => {
    if (overlay.hidden) return;
    overlay.hidden = true; mainPanel.inert = false; home.append(controls); stage.replaceChildren();
    clearTimeout(resizeTimer);
    onClose(); if (returnFocus?.isConnected) returnFocus.focus();
  };
  preview.setAttribute('role', 'button'); preview.setAttribute('tabindex', '0'); preview.setAttribute('aria-label', '点击打开标签大图并调整位置');
  preview.addEventListener('click', open); trigger.addEventListener('click', open);
  preview.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open(); } });
  closeButton.addEventListener('click', close);
  overlay.querySelector('#finish-layout-preview').addEventListener('click', close);
  overlay.addEventListener('click', event => { if (event.target === overlay) close(); });
  const resized = () => {
    if (overlay.hidden || signature() === viewportKey) return;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (overlay.hidden || signature() === viewportKey) return;
      viewportKey = signature();
      const canvas = stage.querySelector('canvas'); if (canvas) fit(canvas);
      onResize();
    }, 120);
  };
  window.addEventListener('resize', resized);
  const observer = window.ResizeObserver ? new window.ResizeObserver(resized) : undefined;
  observer?.observe(stage);
  window.addEventListener('pagehide', () => { clearTimeout(resizeTimer); observer?.disconnect(); window.removeEventListener('resize', resized); }, { once: true });
  return { stage, paint, empty, open, close, getViewport, isOpen: () => !overlay.hidden };
}
