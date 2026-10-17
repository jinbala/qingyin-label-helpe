import { LAYOUT_PARTS, normalizeLayout, dragParentScale } from '../core/layout.mjs';
import { insetBarcodeLayout } from '../core/label-geometry.mjs';

export function mountLayoutEditor({ container, preview, getKey, getSavedLayout, onSave, onChange, onBusyChange = () => {} }) {
  container.innerHTML = `<details class="position-editor" open><summary>调整位置与大小</summary>
    <p class="hint">选择要调整的部分。正数向右、向下移动，负数向左、向上移动。</p>
    <label class="field"><span>调整部分</span><select id="layout-part">${Object.entries(LAYOUT_PARTS).map(([key, label]) => `<option value="${key}">${label}</option>`).join('')}</select></label>
    <div class="position-fields">
      <label class="field"><span>左右偏移（mm）</span><input id="layout-x" type="number" step="0.1" value="0"></label>
      <label class="field"><span>上下偏移（mm）</span><input id="layout-y" type="number" step="0.1" value="0"></label>
      <label class="field"><span>缩放（%）</span><input id="layout-scale" type="number" min="50" max="150" step="1" value="100"></label>
    </div>
    <label class="position-drag"><input id="layout-drag" type="checkbox" checked>在预览上拖动所选部分</label>
    <p class="hint">拖动定位，松开鼠标更新标签。</p>
    <p class="hint">上方文字随“标签内容”一起移动。预览与打印使用相同位置，移出标签纸的内容会被裁切。</p>
    <button id="layout-inset-barcode" type="button">条码框内缩 · 留白 3 mm</button>
    <div class="actions"><button id="layout-save" type="button">保存位置</button><button id="layout-reset" type="button">恢复默认</button></div>
    <p id="layout-status" class="hint" role="status">位置按模板保存在本机。</p>
  </details>`;
  const $ = selector => container.querySelector(selector), drafts = new Map();
  let metadata, key, drag, revision = 0, changeTimer, disposed = false, renderTicket = 0, pending = false;
  const current = () => normalizeLayout(drafts.get(key) ?? getSavedLayout(key) ?? metadata?.layout, metadata?.width, metadata?.height);
  const status = message => { $('#layout-status').textContent = message; };
  const refresh = (immediate = false) => {
    clearTimeout(changeTimer); const ticket = ++renderTicket;
    pending = true; onBusyChange();
    const run = async () => {
      if (disposed || ticket !== renderTicket) return;
      try { await onChange(); }
      finally { if (ticket === renderTicket) { pending = false; onBusyChange(); } }
    };
    if (immediate) void run(); else changeTimer = setTimeout(run, 280);
  };
  const guide = document.createElement('div'); guide.className = 'drag-guide';
  let guideFrame;
  const cancelDrag = (commit = true) => {
    const wasDragging = Boolean(drag); drag = null; guide.remove();
    if (guideFrame) cancelAnimationFrame(guideFrame); guideFrame = undefined;
    window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', end); window.removeEventListener('pointercancel', cancelDrag);
    if (wasDragging && commit !== false && !disposed) refresh(true);
  };
  const renderFields = () => {
    if (!metadata) return;
    const part = current().parts[$('#layout-part').value];
    for (const name of ['x', 'y', 'scale']) $(`#layout-${name}`).value = part[name];
    $('#layout-x').min = -metadata.width; $('#layout-x').max = metadata.width;
    $('#layout-y').min = -metadata.height; $('#layout-y').max = metadata.height;
  };
  const changed = (layout, deferRender = false) => {
    drafts.set(key, layout); revision++; status('位置尚未保存；预览和本次打印已使用当前设置。');
    if (deferRender) { clearTimeout(changeTimer); renderTicket++; pending = true; onBusyChange(); }
    else refresh();
  };
  const readInputs = () => {
    if (!metadata) return;
    if (['x', 'y', 'scale'].some(name => $(`#layout-${name}`).value === '')) { status('请填写偏移和缩放。'); refresh(true); return; }
    try {
      const next = current();
      next.parts[$('#layout-part').value] = Object.fromEntries(['x', 'y', 'scale'].map(name => [name, Number($(`#layout-${name}`).value)]));
      changed(normalizeLayout(next, metadata.width, metadata.height));
    } catch (error) { status(error.message); refresh(true); }
  };
  for (const name of ['x', 'y', 'scale']) $(`#layout-${name}`).addEventListener('input', readInputs);
  $('#layout-part').addEventListener('change', () => {
    const wasInvalid = !['x', 'y', 'scale'].every(name => $(`#layout-${name}`).value !== '' && $(`#layout-${name}`).checkValidity());
    cancelDrag(); renderFields(); if (wasInvalid) refresh(true); else onBusyChange();
  });
  $('#layout-drag').addEventListener('change', () => { preview.classList.toggle('can-drag', $('#layout-drag').checked); cancelDrag(); });
  $('#layout-save').addEventListener('click', async () => {
    if (!metadata) return;
    // Invalid numeric input must never silently save the previous valid value.
    if (['x', 'y', 'scale'].some(name => !$(`#layout-${name}`).checkValidity() || $(`#layout-${name}`).value === '')) { status('请先填写范围内的偏移和缩放。'); return; }
    const savingKey = key, savingRevision = revision, layout = structuredClone(current());
    $('#layout-save').disabled = true;
    try { await onSave(savingKey, layout); if (key === savingKey && revision === savingRevision) status('位置已保存，下次选择这个模板会自动恢复。'); }
    catch (error) { if (key === savingKey) status(`位置保存失败：${error.message}`); }
    finally { $('#layout-save').disabled = false; }
  });
  $('#layout-reset').addEventListener('click', () => { if (!metadata) return; cancelDrag(); changed(normalizeLayout()); renderFields(); });
  $('#layout-inset-barcode').addEventListener('click', () => {
    if (!metadata) return;
    try {
      cancelDrag(false); changed(insetBarcodeLayout(metadata, current())); $('#layout-part').value = 'barcode'; renderFields();
      status('条码区域已缩小并居中，纸边保留至少 3 mm；上方文字未移动。请保存位置并重新生成 PDF。');
    } catch (error) { status(error.message); }
  });
  function move(event) {
    if (!drag || getKey() !== drag.key || $('#layout-x').disabled) { cancelDrag(); return; }
    const next = structuredClone(drag.layout), part = next.parts[drag.part];
    part.x = Math.round(Math.max(-metadata.width, Math.min(metadata.width, drag.x + (event.clientX - drag.clientX) * metadata.width / drag.width / drag.parentScale)) * 10) / 10;
    part.y = Math.round(Math.max(-metadata.height, Math.min(metadata.height, drag.y + (event.clientY - drag.clientY) * metadata.height / drag.height / drag.parentScale)) * 10) / 10;
    changed(next, true); renderFields();
    drag.client = { x: event.clientX, y: event.clientY };
    if (!guideFrame) guideFrame = requestAnimationFrame(() => {
      guideFrame = undefined; if (!drag) return;
      guide.style.transform = `translate(${drag.client.x - drag.stageLeft + 12}px, ${drag.client.y - drag.stageTop + 12}px)`;
      const latest = current().parts[drag.part];
      guide.textContent = `${LAYOUT_PARTS[drag.part]}：${latest.x} / ${latest.y} mm`;
    });
    event.preventDefault();
  }
  function end(event) { if (!drag) return; move(event); cancelDrag(false); refresh(true); }
  preview.addEventListener('pointerdown', event => {
    if (!metadata || !$('#layout-drag').checked || event.button !== 0 || event.target.tagName !== 'CANVAS' || $('#layout-x').disabled) return;
    const bounds = event.target.getBoundingClientRect(); if (!bounds.width || !bounds.height) return;
    const layout = current(), part = $('#layout-part').value, stageBounds = preview.getBoundingClientRect();
    drag = { key, part, layout, x: layout.parts[part].x, y: layout.parts[part].y,
      clientX: event.clientX, clientY: event.clientY, width: bounds.width, height: bounds.height, parentScale: dragParentScale(layout, part),
      stageLeft: stageBounds.left, stageTop: stageBounds.top, client: { x: event.clientX, y: event.clientY } };
    preview.append(guide); guide.textContent = `${LAYOUT_PARTS[part]}：拖动定位`;
    window.addEventListener('pointermove', move, { passive: false }); window.addEventListener('pointerup', end); window.addEventListener('pointercancel', cancelDrag);
    event.preventDefault();
  });
  preview.classList.add('can-drag');
  window.addEventListener('pagehide', () => { disposed = true; clearTimeout(changeTimer); cancelDrag(false); }, { once: true });
  return {
    sync(template) {
      const nextKey = getKey();
      if (nextKey !== key) { cancelDrag(false); clearTimeout(changeTimer); renderTicket++; pending = false; key = nextKey; metadata = template; status('位置按模板保存在本机。'); renderFields(); }
      else {
        const resized = metadata?.width !== template?.width || metadata?.height !== template?.height;
        metadata = template; if (resized) renderFields();
      }
    },
    apply(template) { return { ...template, layout: normalizeLayout(drafts.get(getKey()) ?? getSavedLayout(getKey()) ?? template.layout, template.width, template.height) }; },
    isValid() { return Boolean(metadata) && ['x', 'y', 'scale'].every(name => $(`#layout-${name}`).value !== '' && $(`#layout-${name}`).checkValidity()); },
    isPending() { return pending; },
    finishDrag() { cancelDrag(); },
    forget(id) { drafts.delete(id); if (id === key) { cancelDrag(false); clearTimeout(changeTimer); renderTicket++; pending = false; metadata = undefined; key = undefined; } },
  };
}
