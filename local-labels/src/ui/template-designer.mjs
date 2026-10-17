import { bakeDesignLayout, createDesign, newElement, ELEMENT_TYPES, DESIGN_SAMPLE, roundMm } from '../core/design.mjs';
import { localTemplate } from '../core/templates.mjs';
import { barcodeSvg } from '../printing/render.mjs';
import { designSvg, elementMarkup } from '../printing/design-svg.mjs';

const NS = 'http://www.w3.org/2000/svg';
const clone = draft => ({ ...draft, elements: draft.elements.map(element => ({ ...element })), ...(draft.layout ? { layout: structuredClone(draft.layout) } : {}) });
const equal = (a, b) => ['name', 'width', 'height', 'origin'].every(key => a[key] === b[key]) && a.elements.length === b.elements.length && a.elements.every((element, i) => {
  const other = b.elements[i]; return Object.keys(element).length === Object.keys(other).length && Object.keys(element).every(key => element[key] === other[key]);
});

export function mountTemplateDesigner({ root, mainPanel, onSave, onClose = () => {} }) {
  const stylesheet = document.createElement('link'); stylesheet.rel = 'stylesheet'; stylesheet.href = new URL('./template-designer.css', import.meta.url).href; root.append(stylesheet);
  const form = document.createElement('form'); form.id = 'editor'; form.className = 'template-designer'; form.hidden = true;
  form.noValidate = true;
  form.innerHTML = `<section class="designer-window" role="dialog" aria-modal="true" aria-labelledby="designer-title" tabindex="-1">
    <header class="designer-header"><div><h2 id="designer-title">标签设计器</h2><span>轻印 · 本地模板</span></div><label class="designer-name">模板名称<input name="name" maxlength="80" required aria-label="模板名称"></label><button type="button" id="cancel-editor">返回打印</button><button type="submit" class="primary" id="design-save">保存模板</button></header>
    <div class="designer-toolbar"><button type="button" data-action="undo" title="Ctrl+Z">撤销</button><button type="button" data-action="redo" title="Ctrl+Shift+Z">重做</button><span class="designer-divider"></span><label>宽 <input name="width" type="number" min="15" max="210" step="0.1" required aria-label="纸张宽度"> mm</label><label>高 <input name="height" type="number" min="15" max="210" step="0.1" required aria-label="纸张高度"> mm</label><label>缩放 <select id="design-zoom"><option value="fit">适合窗口</option><option value=".5">50%</option><option value=".75">75%</option><option value="1">100%</option><option value="1.5">150%</option><option value="2">200%</option></select></label><label><input id="design-snap" type="checkbox" checked>0.5 mm 吸附</label><label><input id="design-grid" type="checkbox" checked>网格</label></div>
    <div id="design-alert" class="designer-alert" role="alert" hidden></div>
    <div class="designer-body"><aside class="designer-tools"><h3>添加元素</h3><div class="designer-tool-grid">${Object.entries(ELEMENT_TYPES).map(([type, label]) => `<button type="button" data-add="${type}"><span aria-hidden="true">${({ text: 'T', barcode: '▥', code: '▤', line: '╱', rect: '□', ellipse: '○', image: '▧', grid: '▦' })[type]}</span>${label}</button>`).join('')}</div><input id="design-image" type="file" accept="image/png,image/jpeg,image/webp" hidden><h3>常用文字</h3><button type="button" data-add-text="{{skc}}">SKC 编号</button><button type="button" data-add-text="{{sku}}">SKU 编号</button><button type="button" data-add-text="{{skcSpec}}">颜色 / 主规格</button><button type="button" data-add-text="{{skuSpec}}">尺码 / 次规格</button><h3>图层 <small>上方在前</small></h3><div id="design-layers" class="designer-layers"></div><div class="designer-layer-actions"><button type="button" data-action="up">上移一层</button><button type="button" data-action="down">下移一层</button></div></aside>
    <main class="designer-stage" id="design-stage"><div class="designer-paper-wrap" id="design-paper-wrap"><svg id="design-ruler-top" class="designer-ruler-top" aria-hidden="true"></svg><svg id="design-ruler-left" class="designer-ruler-left" aria-hidden="true"></svg><div id="design-paper" class="designer-paper"></div></div></main>
    <aside class="designer-properties"><h3>元素属性</h3><p id="design-no-selection" class="hint">点击画布元素或图层进行编辑。拖动移动，右下角方块调整大小。</p><div id="design-properties" hidden>
      <label class="field"><span>图层名称</span><input data-prop="name" maxlength="80"></label><div class="designer-property-grid">${[['x','左边距'],['y','上边距'],['w','宽度'],['h','高度']].map(([key, label]) => `<label class="field"><span>${label}（mm）</span><input data-prop="${key}" type="number" step="0.1" min="${['w','h'].includes(key) ? '.2' : '-210'}" max="420"></label>`).join('')}<label class="field"><span>旋转（°）</span><input data-prop="rotation" type="number" step="1" min="-360" max="360"></label></div>
      <div data-for="text code"><label class="field"><span>文字 / 数据</span><textarea id="design-text" data-prop="text" maxlength="6000" rows="5"></textarea></label><select id="design-variable" aria-label="插入商品变量"><option value="">插入商品变量…</option>${Object.entries({ skc:'SKC 编号',sku:'SKU 编号',skcSpec:'颜色 / 主规格',skuSpec:'尺码 / 次规格',labelCode:'条码值',sourceId:'订单编号',origin:'产地' }).map(([key,label]) => `<option value="{{${key}}}">${label}</option>`).join('')}</select></div>
      <div data-for="text"><div class="designer-property-grid"><label class="field"><span>字号（mm）</span><input data-prop="fontSize" type="number" min=".5" max="20" step=".1"></label><label class="field"><span>行距倍数</span><input data-prop="lineHeight" type="number" min="1" max="3" step=".1"></label></div><label class="field"><span>字体</span><select data-prop="fontFamily"><option value="Arial">Arial</option><option value="Microsoft YaHei">微软雅黑</option><option value="serif">衬线字体</option><option value="monospace">等宽字体</option></select></label><label><input data-prop="bold" type="checkbox">粗体</label><label class="field"><span>文字对齐</span><select data-prop="align"><option value="left">左对齐</option><option value="center">居中</option><option value="right">右对齐</option></select></label></div>
      <div data-for="rect ellipse line grid"><label class="field"><span>线宽（mm）</span><input data-prop="strokeWidth" type="number" min=".05" max="5" step=".05"></label><label class="field"><span>填充</span><select data-prop="fill"><option value="none">透明</option><option value="#ffffff">白色</option><option value="#000000">黑色</option></select></label></div>
      <div data-for="grid" class="designer-property-grid"><label class="field"><span>行数</span><input data-prop="rows" type="number" min="1" max="20" step="1"></label><label class="field"><span>列数</span><input data-prop="cols" type="number" min="1" max="20" step="1"></label></div>
      <div data-for="barcode"><p class="hint">商品条码会自动填入当前 SKU、颜色、尺码与产地。边框、条码和文字一起缩放。</p></div>
      <h3>对齐到纸张</h3><div class="designer-align">${[['left','靠左'],['center','水平居中'],['right','靠右'],['top','靠上'],['middle','垂直居中'],['bottom','靠下']].map(([action,label]) => `<button type="button" data-align="${action}">${label}</button>`).join('')}</div><div class="actions"><button type="button" data-action="duplicate">复制元素</button><button type="button" data-action="delete">删除元素</button></div>
    </div><h3>条码产地</h3><label class="field"><span>留空则不显示产地</span><input name="origin" maxlength="80"></label><p class="hint">双击文字可编辑。方向键微调；Shift 加大步长。图片仅嵌入本地文件。</p></aside></div>
    <footer class="designer-footer"><span id="design-status" role="status">就绪</span><span id="design-position"></span><span>最终打印为黑白标签</span></footer>
  </section>`;
  root.append(form);
  // Stored geometry can contain finer precision than a number input's step.
  for (const input of form.querySelectorAll('input[type=number]')) if (!['rows','cols'].includes(input.dataset.prop)) input.step = 'any';
  const $ = selector => form.querySelector(selector);
  let draft, selected, sample = DESIGN_SAMPLE, undo = [], redo = [], returnFocus, gesture, paintFrame, pendingPatch, saving = false, copied;
  const focusedEdits = new WeakMap();
  const selectedElement = () => draft?.elements.find(element => element.id === selected);
  const setStatus = (message, error = false) => { $('#design-status').textContent = message; $('#design-status').className = error ? 'designer-error' : ''; $('#design-alert').hidden = !error; $('#design-alert').textContent = error ? message : ''; };
  const snapshot = () => ({ draft: clone(draft), selected });
  function commit(before) {
    if (!before || equal(before.draft, draft)) return;
    undo.push(before); if (undo.length > 40) undo.shift(); redo = []; historyButtons();
  }
  function historyButtons() { $('[data-action=undo]').disabled = !undo.length; $('[data-action=redo]').disabled = !redo.length; }
  function mutate(action) {
    if (saving) return false; finishGesture(); const before = snapshot();
    try { action(); localTemplate(draft); commit(before); paintAll(); return true; }
    catch (error) { draft = clone(before.draft); selected = before.selected; paintAll(); setStatus(error.message, true); return false; }
  }
  function zoom() {
    if (!draft) return;
    const stage = $('#design-stage'), value = $('#design-zoom').value;
    const scale = value === 'fit' ? Math.max(1, Math.min(((stage.clientWidth || 800) - 80) / draft.width, ((stage.clientHeight || 560) - 80) / draft.height, 16)) : 12 * Number(value);
    const width = draft.width * scale, height = draft.height * scale;
    $('#design-paper').style.backgroundSize = `${5 * scale}px ${5 * scale}px`;
    $('#design-paper-wrap').style.width = `${width + 24}px`; $('#design-paper-wrap').style.height = `${height + 24}px`;
    const svg = $('#design-paper svg'); if (svg) { svg.style.width = `${width}px`; svg.style.height = `${height}px`; }
    const ruler = (node, length, vertical) => {
      node.setAttribute('viewBox', vertical ? `0 0 24 ${length * scale}` : `0 0 ${length * scale} 24`);
      node.style[vertical ? 'height' : 'width'] = `${length * scale}px`;
      const ticks = [];
      for (let mm = 0; mm <= length; mm += 5) { const pos = mm * scale; ticks.push(vertical ? `<path d="M24 ${pos}h-${mm % 10 ? 5 : 9}"/>` : `<path d="M${pos} 24v-${mm % 10 ? 5 : 9}"/>`); if (!(mm % 10)) ticks.push(`<text x="${vertical ? 2 : pos + 2}" y="${vertical ? pos + 10 : 11}">${mm}</text>`); }
      node.innerHTML = ticks.join('');
    };
    ruler($('#design-ruler-top'), draft.width, false); ruler($('#design-ruler-left'), draft.height, true);
    selectionOverlay();
  }
  function paintAll() {
    if (!draft) return;
    try {
      $('#design-paper').innerHTML = designSvg(draft, sample, barcodeSvg, { editing: true });
      $('#design-paper').classList.toggle('with-grid', $('#design-grid').checked);
      zoom(); paintLayers(); paintProperties(); historyButtons();
    } catch (error) { setStatus(error.message, true); }
  }
  function selectionOverlay() {
    const svg = $('#design-paper svg'); if (!svg) return;
    svg.querySelector('[data-selection]')?.remove();
    const element = selectedElement();
    if (!element?.visible) return;
    const outline = document.createElementNS(NS, 'g'); outline.setAttribute('data-selection', ''); outline.setAttribute('pointer-events', 'none');
    outline.setAttribute('transform', `translate(${element.x} ${element.y}) rotate(${element.rotation} ${element.w / 2} ${element.h / 2})`);
    const handle = Math.max(.6, draft.width / 100);
    outline.innerHTML = `<rect width="${element.w}" height="${element.h}" fill="none" stroke="${element.locked ? '#8794a7' : '#2563eb'}" stroke-width="1" vector-effect="non-scaling-stroke"/>${element.locked ? '' : `<rect data-handle="resize" x="${element.w - handle / 2}" y="${element.h - handle / 2}" width="${handle}" height="${handle}" fill="#2563eb" stroke="white" stroke-width=".1" pointer-events="all" style="cursor:nwse-resize"/>`}`;
    svg.append(outline);
    $('#design-position').textContent = `${roundMm(element.x)}, ${roundMm(element.y)} mm · ${roundMm(element.w)} × ${roundMm(element.h)} mm`;
  }
  function paintLayers() {
    const list = $('#design-layers'); list.replaceChildren();
    for (const element of [...draft.elements].reverse()) {
      const row = document.createElement('div'); row.className = 'designer-layer'; row.dataset.id = element.id; row.classList.toggle('selected', element.id === selected);
      const select = document.createElement('button'); select.type = 'button'; select.dataset.select = element.id; select.textContent = element.name || (element.type === 'text' ? element.text.slice(0, 18) : ELEMENT_TYPES[element.type]); select.title = select.textContent;
      const visible = document.createElement('button'); visible.type = 'button'; visible.dataset.visible = element.id; visible.textContent = element.visible ? '显' : '隐'; visible.setAttribute('aria-label', element.visible ? '隐藏图层' : '显示图层');
      const lock = document.createElement('button'); lock.type = 'button'; lock.dataset.lock = element.id; lock.textContent = element.locked ? '锁' : '动'; lock.setAttribute('aria-label', element.locked ? '解锁图层' : '锁定图层');
      row.append(select, visible, lock); list.append(row);
    }
  }
  function paintProperties() {
    const element = selectedElement(); $('#design-no-selection').hidden = Boolean(element); $('#design-properties').hidden = !element;
    if (!element) { $('#design-position').textContent = `${draft.elements.length} 个元素 · ${draft.width} × ${draft.height} mm`; return; }
    for (const group of form.querySelectorAll('[data-for]')) group.hidden = !group.dataset.for.split(' ').includes(element.type);
    for (const input of form.querySelectorAll('[data-prop]')) {
      const key = input.dataset.prop; input.disabled = element.locked;
      if (input.type === 'checkbox') input.checked = Boolean(element[key]); else input.value = typeof element[key] === 'number' ? roundMm(element[key]) : element[key] ?? '';
    }
    $('#design-variable').disabled = element.locked;
  }
  function select(id) { selected = id; paintLayers(); paintProperties(); selectionOverlay(); }
  function patchActive() {
    if (paintFrame) cancelAnimationFrame(paintFrame); paintFrame = undefined; pendingPatch = false;
    const element = selectedElement(), node = element && $(`[data-element-id="${element.id}"]`);
    if (!element || !node) { paintAll(); return; }
    try { node.innerHTML = elementMarkup(element, sample, draft.origin, { barcodeSvg, layout: draft.layout }); node.setAttribute('transform', `translate(${element.x} ${element.y}) rotate(${element.rotation} ${element.w / 2} ${element.h / 2})`); selectionOverlay(); }
    catch (error) { setStatus(error.message, true); }
  }
  function schedulePatch() { pendingPatch = true; if (!paintFrame) paintFrame = requestAnimationFrame(patchActive); }
  function add(type, text) {
    if (draft.elements.length >= 120) { setStatus('最多添加 120 个元素。', true); return; }
    if (type === 'image') { $('#design-image').click(); return; }
    mutate(() => { const element = newElement(type, draft.width, draft.height); if (text !== undefined) element.text = text; draft.elements.push(element); selected = element.id; });
    setStatus(`已添加${ELEMENT_TYPES[type]}，拖动到合适位置。`);
  }
  function action(name) {
    if (saving) return;
    finishGesture();
    if (name === 'undo' || name === 'redo') {
      const from = name === 'undo' ? undo : redo, to = name === 'undo' ? redo : undo;
      if (!from.length) return; to.push(snapshot()); const next = from.pop(); draft = clone(next.draft); selected = next.selected; syncPaperFields(); paintAll(); return;
    }
    const element = selectedElement(); if (!element || element.locked) return;
    mutate(() => {
      const index = draft.elements.indexOf(element);
      if (name === 'delete') { draft.elements.splice(index, 1); selected = draft.elements.at(-1)?.id; }
      if (name === 'duplicate' && draft.elements.length < 120) { const next = { ...element, id: `el-${crypto.randomUUID()}`, x: roundMm(element.x + 1), y: roundMm(element.y + 1) }; draft.elements.splice(index + 1, 0, next); selected = next.id; }
      if (name === 'up' && index < draft.elements.length - 1) [draft.elements[index], draft.elements[index + 1]] = [draft.elements[index + 1], draft.elements[index]];
      if (name === 'down' && index > 0) [draft.elements[index], draft.elements[index - 1]] = [draft.elements[index - 1], draft.elements[index]];
    });
  }
  function syncPaperFields() { for (const key of ['name', 'width', 'height', 'origin']) $(`[name=${key}]`).value = draft[key]; }
  function move(event) {
    if (!gesture || saving) return;
    const element = selectedElement(), original = gesture.element;
    const dx = (event.clientX - gesture.clientX) / gesture.scaleX, dy = (event.clientY - gesture.clientY) / gesture.scaleY;
    const snap = value => roundMm($('#design-snap').checked && !event.altKey ? Math.round(value * 2) / 2 : value);
    if (gesture.resize) {
      const angle = original.rotation * Math.PI / 180, cos = Math.cos(angle), sin = Math.sin(angle);
      element.w = Math.max(.5, Math.min(420, snap(original.w + dx * cos + dy * sin)));
      element.h = Math.max(.5, Math.min(420, snap(original.h - dx * sin + dy * cos)));
      if (event.shiftKey) element.h = roundMm(Math.max(.5, Math.min(420, element.w * original.h / original.w)));
      const dw = element.w - original.w, dh = element.h - original.h;
      element.x = roundMm(original.x + (cos * dw - sin * dh - dw) / 2); element.y = roundMm(original.y + (sin * dw + cos * dh - dh) / 2);
      // Resize only the enclosing SVG viewport while held; reflow on release.
      const child = $(`[data-element-id="${element.id}"] > svg`); if (child) { child.setAttribute('width', element.w); child.setAttribute('height', element.h); }
    } else { element.x = Math.max(-210, Math.min(420, snap(original.x + dx))); element.y = Math.max(-210, Math.min(420, snap(original.y + dy))); }
    $(`[data-element-id="${element.id}"]`)?.setAttribute('transform', `translate(${element.x} ${element.y}) rotate(${element.rotation} ${element.w / 2} ${element.h / 2})`);
    for (const key of ['x','y','w','h']) $(`[data-prop=${key}]`).value = element[key];
    selectionOverlay(); event.preventDefault();
  }
  function finishGesture(event, cancel = false) {
    if (!gesture) return;
    if (event && !cancel) move(event);
    const before = gesture.before; gesture = undefined;
    window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', finishGesture); window.removeEventListener('pointercancel', cancelGesture);
    if (cancel) { draft = clone(before.draft); selected = before.selected; paintAll(); }
    else { commit(before); patchActive(); }
  }
  const cancelGesture = () => finishGesture(undefined, true);
  $('#design-paper').addEventListener('pointerdown', event => {
    if (event.button !== 0 || saving) return;
    const handle = event.target.closest('[data-handle]'), id = handle ? selected : event.target.closest('[data-element-id]')?.getAttribute('data-element-id');
    select(id); const element = selectedElement(); if (!element || element.locked) return;
    const bounds = $('#design-paper svg').getBoundingClientRect(); if (!bounds.width || !bounds.height) return;
    gesture = { before: snapshot(), element: { ...element }, resize: Boolean(handle), clientX: event.clientX, clientY: event.clientY, scaleX: bounds.width / draft.width, scaleY: bounds.height / draft.height };
    window.addEventListener('pointermove', move, { passive: false }); window.addEventListener('pointerup', finishGesture); window.addEventListener('pointercancel', cancelGesture); event.preventDefault();
  });
  $('#design-paper').addEventListener('dblclick', event => {
    select(event.target.closest('[data-element-id]')?.getAttribute('data-element-id'));
    if (['text', 'code'].includes(selectedElement()?.type) && !selectedElement().locked) { $('#design-text').focus(); $('#design-text').select(); }
  });
  form.addEventListener('click', event => {
    if (saving) return;
    const button = event.target.closest('button'); if (!button) return;
    if (button.dataset.add) add(button.dataset.add);
    if (button.dataset.addText) add('text', button.dataset.addText);
    if (button.dataset.action) action(button.dataset.action);
    if (button.dataset.select) select(button.dataset.select);
    if (button.dataset.visible || button.dataset.lock) mutate(() => { const element = draft.elements.find(item => item.id === (button.dataset.visible || button.dataset.lock)); const key = button.dataset.visible ? 'visible' : 'locked'; element[key] = !element[key]; selected = element.id; });
    if (button.dataset.align) {
      const element = selectedElement(); if (!element || element.locked) return;
      mutate(() => {
        const value = button.dataset.align, angle = element.rotation * Math.PI / 180;
        const width = Math.abs(Math.cos(angle)) * element.w + Math.abs(Math.sin(angle)) * element.h;
        const height = Math.abs(Math.sin(angle)) * element.w + Math.abs(Math.cos(angle)) * element.h;
        if (value === 'left') element.x = roundMm((width - element.w) / 2);
        if (value === 'center') element.x = roundMm((draft.width - element.w) / 2);
        if (value === 'right') element.x = roundMm(draft.width - (width + element.w) / 2);
        if (value === 'top') element.y = roundMm((height - element.h) / 2);
        if (value === 'middle') element.y = roundMm((draft.height - element.h) / 2);
        if (value === 'bottom') element.y = roundMm(draft.height - (height + element.h) / 2);
      });
    }
  });
  form.addEventListener('focusin', event => { if (draft && event.target.matches('[data-prop],[name]')) focusedEdits.set(event.target, snapshot()); });
  form.addEventListener('input', event => {
    const input = event.target; if (saving || !input.matches('[data-prop],[name]')) return;
    if (!focusedEdits.has(input)) focusedEdits.set(input, snapshot());
    if (!input.checkValidity() || input.type === 'number' && input.value === '') { setStatus('请填写范围内的数值。', true); return; }
    const value = input.type === 'checkbox' ? input.checked : input.type === 'number' ? Number(input.value) : input.value;
    if (input.dataset.prop) { const element = selectedElement(); if (!element || element.locked) return; element[input.dataset.prop] = value; schedulePatch(); }
    else { draft[input.name] = value; if (['width','height','origin'].includes(input.name)) paintAll(); }
    setStatus('尚未保存 · 修改仅在本窗口生效');
  });
  form.addEventListener('change', event => {
    const input = event.target; if (!input.matches('[data-prop],[name]') || saving) return;
    // Some controls emit change without input; apply the value before committing.
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
    commit(focusedEdits.get(input)); focusedEdits.delete(input); paintLayers();
  });
  $('#design-variable').addEventListener('change', () => {
    const element = selectedElement(), input = $('#design-text'); if (!element || element.locked || !$('#design-variable').value) return;
    mutate(() => { element.text = element.text.slice(0, input.selectionStart) + $('#design-variable').value + element.text.slice(input.selectionEnd); }); $('#design-variable').value = '';
  });
  $('#design-zoom').addEventListener('change', zoom);
  $('#design-grid').addEventListener('change', () => $('#design-paper').classList.toggle('with-grid', $('#design-grid').checked));
  $('#design-image').addEventListener('change', async () => {
    const file = $('#design-image').files?.[0]; $('#design-image').value = ''; if (!file || saving) return;
    const owner = draft;
    try {
      if (!['image/png','image/jpeg','image/webp'].includes(file.type) || file.size > 2 * 1024 * 1024) throw new Error('请选择 2 MB 以内的 PNG/JPEG/WebP 图片。');
      const data = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(new Error('本地图片读取失败。')); reader.readAsDataURL(file); });
      const image = await new Promise((resolve, reject) => { const image = new Image(); image.onload = () => resolve(image); image.onerror = () => reject(new Error('图片内容无法识别。')); image.src = data; });
      if (image.naturalWidth > 4096 || image.naturalHeight > 4096) throw new Error('图片宽高不能超过 4096 像素。');
      const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight; canvas.getContext('2d').drawImage(image, 0, 0);
      const src = canvas.toDataURL('image/png'); if (src.length > 2800000) throw new Error('转换后的图片过大，请缩小后重新导入。');
      if (form.hidden || draft !== owner) return;
      if (mutate(() => { const element = newElement('image', draft.width, draft.height); element.src = src; element.h = roundMm(element.w * image.naturalHeight / image.naturalWidth); draft.elements.push(element); selected = element.id; })) setStatus('本地图片已嵌入，打印时自动转换为黑白。');
    } catch (error) { setStatus(error.message, true); }
  });
  function close() {
    if (saving) return; finishGesture(); if (paintFrame) cancelAnimationFrame(paintFrame); paintFrame = undefined; pendingPatch = false;
    form.hidden = true; mainPanel.inert = false; undo = []; redo = []; draft = undefined; $('#design-paper').replaceChildren(); onClose(); returnFocus?.focus();
  }
  $('#cancel-editor').addEventListener('click', close);
  form.addEventListener('submit', async event => {
    event.preventDefault(); if (saving) return;
    finishGesture(); if (pendingPatch) patchActive();
    try {
      if (!form.checkValidity()) {
        const input = form.querySelector('input:invalid,textarea:invalid,select:invalid');
        const label = input?.closest('label')?.querySelector('span')?.textContent || input?.getAttribute('aria-label') || ({ name: '模板名称', width: '纸张宽度', height: '纸张高度' })[input?.name] || '输入字段';
        setStatus(`保存失败：请检查${label}。${input?.validationMessage || ''}`, true); input?.focus(); return;
      }
      for (const key of ['name','width','height','origin']) draft[key] = ['width','height'].includes(key) ? Number($(`[name=${key}]`).value) : $(`[name=${key}]`).value;
      const template = localTemplate(draft); designSvg(template, sample, barcodeSvg); saving = true; $('#design-save').disabled = true; setStatus('正在保存模板…');
      await onSave(template); saving = false; close();
    } catch (error) { saving = false; setStatus(`保存失败：${error.message}`, true); }
    finally { $('#design-save').disabled = false; }
  });
  form.addEventListener('keydown', event => {
    if (saving) { event.preventDefault(); return; }
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); return; }
    const typing = event.target.matches('input,textarea,select'), mod = event.ctrlKey || event.metaKey;
    if (mod && event.key.toLowerCase() === 's') { event.preventDefault(); form.requestSubmit(); return; }
    if (typing) return;
    if (mod && ['z','y'].includes(event.key.toLowerCase())) { event.preventDefault(); action(event.shiftKey || event.key.toLowerCase() === 'y' ? 'redo' : 'undo'); return; }
    if (mod && event.key.toLowerCase() === 'd') { event.preventDefault(); action('duplicate'); return; }
    if (mod && event.key.toLowerCase() === 'c' && selectedElement()) { copied = { ...selectedElement() }; event.preventDefault(); return; }
    if (mod && event.key.toLowerCase() === 'v' && copied && draft.elements.length < 120) { event.preventDefault(); mutate(() => { const element = { ...copied, id: `el-${crypto.randomUUID()}`, x: copied.x + 1, y: copied.y + 1 }; draft.elements.push(element); selected = element.id; }); return; }
    if (['Delete','Backspace'].includes(event.key)) { event.preventDefault(); action('delete'); return; }
    if (['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key) && selectedElement() && !selectedElement().locked) { event.preventDefault(); const step = event.shiftKey ? 1 : .1; mutate(() => { const element = selectedElement(); if (event.key === 'ArrowLeft') element.x -= step; if (event.key === 'ArrowRight') element.x += step; if (event.key === 'ArrowUp') element.y -= step; if (event.key === 'ArrowDown') element.y += step; element.x = roundMm(element.x); element.y = roundMm(element.y); }); }
  });
  window.addEventListener('resize', () => { if (!form.hidden) zoom(); });
  window.addEventListener('pagehide', () => { saving = false; if (!form.hidden) close(); copied = undefined; }, { once: true });
  return {
    open(source, record = DESIGN_SAMPLE) {
      if (saving) return;
      draft = source ? bakeDesignLayout(source) : createDesign(); selected = draft.elements.at(-1)?.id; sample = record || DESIGN_SAMPLE;
      undo = []; redo = []; returnFocus = root.activeElement; form.hidden = false; mainPanel.inert = true;
      syncPaperFields(); paintAll(); setStatus('拖动排版，双击文字编辑；保存后回到批量打印。'); $('[name=name]').focus();
    },
    close, isOpen: () => !form.hidden,
  };
}
