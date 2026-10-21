import { fetchLabels, makeJobs, sortRecords, splitIds } from '../core/core.mjs';
import { defaultTemplates, localTemplate, SETTINGS_SCHEMA } from '../core/templates.mjs';
import { createLabelRenderer, generatePdf } from '../printing/render.mjs';
import { pageType, readSelected, trackSelections } from '../integration/dom.mjs';
import { mountLayoutEditor } from './layout-editor.mjs';
import { normalizeLayout } from '../core/layout.mjs';
import { createPreviewScheduler } from './preview-scheduler.mjs';
import { mountPreviewDialog } from './preview-dialog.mjs';
import { mountTemplateDesigner } from './template-designer.mjs';
import { previewDpi, previewViewport } from './preview-quality.mjs';
import { createTemplateBackup, mergeTemplateBackup } from '../core/template-backup.mjs';

const SAMPLE = [
  { productSkuId: '9000000000001', productSkcId: '800000000001', labelCode: '53711398047', skuSpec: 'Black-L', skcSpec: 'Cotton', quantity: 2, sourceId: 'DEMO001', purchaseTime: 1729000000000 },
  { productSkuId: '9000000000002', productSkcId: '800000000002', labelCode: '53711398048', skuSpec: 'White-M', skcSpec: 'Cotton', quantity: 3, sourceId: 'DEMO002', purchaseTime: 1729100000000 },
].map((record, index) => ({ ...record, tableOrder: index, selectionRank: 1 - index, key: `sample-${index}` }));

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export async function mountLabelApp(services, stylesheet) {
  if (document.querySelector('#qingyin-label-helper-root')) return;
  const host = element('div'); host.id = 'qingyin-label-helper-root';
  const root = host.attachShadow({ mode: 'open' });
  const style = element('link'); style.rel = 'stylesheet'; style.href = stylesheet; root.append(style);
  const frame = element('div');
  frame.innerHTML = `
    <button class="launcher" id="launcher">轻印标签助手</button>
    <div class="overlay" id="overlay" hidden>
      <section class="panel" role="dialog" aria-modal="true" aria-labelledby="title" tabindex="-1">
        <header class="header"><h1 id="title">轻印标签助手</h1><span class="badge">批量标签打印</span><button id="close" class="close" aria-label="关闭">×</button></header>
        <div class="body">
          <div class="source">
            <label class="field"><span>编号类型</span><select id="type"><option value="purchase">备货单</option><option value="delivery">发货单</option><option value="sku">商品 SKU</option></select></label>
            <label class="field"><span>当前店铺 Mall ID</span><input id="mall" inputmode="numeric" autocomplete="off" placeholder="当前店铺的数字 ID"></label>
            <div class="actions"><button class="primary" id="read-selected">读取页面勾选</button><button id="demo" hidden>载入示例数据</button></div>
          </div>
          <details class="manual"><summary>手动输入备货单号、发货单号或 SKU ID</summary><textarea id="manual-ids" aria-label="手动编号" placeholder="每行一个编号，也可用逗号或空格分隔；一次最多 1000 个"></textarea><div class="actions"><button id="read-manual">获取这些编号的标签</button></div></details>
          <div class="notice" id="notice" role="status">先勾选当前页中的订单或商品，再读取标签数据。</div>
          <label id="ack-row" class="actions" hidden><input type="checkbox" id="ack" style="width:16px"><span>我已核对以上提示和返回的商品数据</span></label>
          <div class="content"><div>
            <h2 class="section-title">打印明细<small id="count">尚未读取商品</small></h2>
            <div class="sort-row"><select id="sort" aria-label="打印顺序"><option value="table">页面 / 输入顺序</option><option value="selected">勾选顺序</option><option value="skc">SKC ID 升序</option><option value="time">备货单创建时间：新到旧</option></select><label><input id="separators" type="checkbox">不同 SKU 之间添加提示页</label><label id="batch-separator-row" hidden><input id="batch-separators" type="checkbox">不同发货批次之间添加提示页</label><button id="clear">清空</button></div>
            <div class="table-scroll"><table><thead><tr><th>SKC / SKU</th><th>规格</th><th>条码</th><th>打印数量</th><th></th></tr></thead><tbody id="rows"></tbody></table><div class="empty" id="empty">读取数据后，在这里核对规格与数量。</div></div>
            <div class="template-toolbar"><strong>标签模板</strong><button id="new-template">新建模板</button><button id="import-template">导入 JSON</button><input id="template-file" type="file" accept=".json,application/json" hidden><button id="backup-templates">备份全部模板</button><button id="restore-templates">导入备份</button><input id="backup-file" type="file" accept=".json,application/json" hidden></div>
            <p class="hint">更新请覆盖原目录后重新加载。换目录或移除扩展前，请先“备份全部模板”。</p>
            <div class="template-grid" id="templates"></div>
            <div class="actions" style="margin-top:10px"><button id="edit-template">编辑模板</button><button id="export-template">导出模板</button><button id="delete-template">删除本地模板</button></div>
          </div><aside class="preview"><h2 class="section-title">首张标签预览</h2><div class="preview-box" id="preview"><span class="hint">读取商品并选择模板后显示</span></div><p class="hint" id="preview-caption"></p><label class="field"><span>条码区域产地（留空不显示）</span><input id="origin" value="China" maxlength="80"></label><button id="open-layout-preview" class="open-layout-preview" type="button">打开大图调整</button><div class="layout-home" hidden><div id="layout-editor"></div></div><p class="hint">最终输出为黑白标签。打印时使用标签纸尺寸和 100% 缩放。</p></aside></div>
        </div>
        <footer class="footer"><select id="dpi" aria-label="打印分辨率"><option value="300">300 DPI</option><option value="600">600 DPI</option></select><div class="progress-wrap"><progress id="progress" max="100" value="0"></progress><span id="progress-text">就绪</span></div><button id="cancel" hidden>取消任务</button><button class="primary" id="generate" disabled>生成 PDF 并预览</button></footer>
      </section>
    </div>`;
  root.append(frame); document.documentElement.append(host);
  const $ = selector => root.querySelector(selector);
  const state = { records: [], warnings: [], local: defaultTemplates(),
    selected: 'local-default', layouts: {}, busy: false, version: 0, previewVersion: 0, controller: null };
  const clicks = new Map(); trackSelections(clicks);
  let lastPath = location.pathname, returnFocus;
  const allTemplates = () => state.local;
  const chosen = () => allTemplates().find(template => template.id === state.selected);
  const sorted = () => sortRecords(state.records, $('#sort').value);
  const skuSeparators = () => $('#separators').checked;
  // The batch option is only offered once the loaded data spans several
  // 发货批次 (see updateCounts); the hidden checkbox never adds pages.
  const batchSeparators = () => !$('#batch-separator-row').hidden && $('#batch-separators').checked;
  const notice = (text, level = '') => { $('#notice').textContent = text; $('#notice').className = `notice ${level}`; };
  const save = (overrides = {}) => services.saveSettings({ schema: SETTINGS_SCHEMA, templates: state.local, selected: state.selected, layouts: state.layouts, ...overrides });
  const savedSettings = async () => {
    const settings = services.readSettings ? await services.readSettings() : undefined;
    return settings?.templates?.length ? settings : { schema: SETTINGS_SCHEMA, templates: state.local, selected: state.selected, layouts: state.layouts };
  };
  const downloadJson = (value, filename) => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
    const anchor = element('a'); anchor.href = url; anchor.download = filename; host.append(anchor); anchor.click(); anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 30000);
  };
  let previewRendererCache;
  const previewDialog = mountPreviewDialog({
    root, preview: $('#preview'), trigger: $('#open-layout-preview'), controls: $('#layout-editor'), mainPanel: $('.panel'),
    onOpen: () => { void refreshPreview(); },
    onClose: () => { layoutEditor.finishDrag(); void refreshPreview(); },
    onResize: () => { layoutEditor.finishDrag(); void refreshPreview(); },
  });
  const previewScheduler = createPreviewScheduler(renderPreview);
  const layoutEditor = mountLayoutEditor({
    container: $('#layout-editor'), preview: previewDialog.stage, getKey: () => state.selected,
    getSavedLayout: key => Object.hasOwn(state.layouts, key) ? state.layouts[key] : undefined,
    onChange: () => { updateButtons(); return refreshPreview(); },
    onBusyChange: updateButtons,
    onSave: async (key, layout) => {
      const layouts = { ...state.layouts, [key]: layout }; await save({ layouts }); state.layouts = layouts;
    },
  });
  const designer = mountTemplateDesigner({
    root, mainPanel: $('.panel'),
    onSave: async data => {
      const next = state.local.filter(template => template.id !== data.id); next.push(data);
      const layouts = { ...state.layouts }; delete layouts[data.id];
      await save({ templates: next, selected: data.id, layouts });
      state.local = next; state.selected = data.id; state.layouts = layouts;
      layoutEditor.forget(data.id); previewRendererCache = undefined;
      $('#origin').value = data.origin; renderTemplates(); await refreshPreview(); notice('可视化模板已保存在本机。');
    },
  });
  const on = (id, action, event = 'click') => $(id).addEventListener(event, async e => {
    try { await action(e); } catch (error) { if (error.name !== 'AbortError') notice(error.message, 'error'); }
  });

  function updateButtons() {
    let valid = false;
    try { makeJobs(state.records, skuSeparators(), batchSeparators()); valid = true; } catch { /* Inline quantity controls display validity. */ }
    $('#generate').disabled = state.busy || !valid || !chosen() || !layoutEditor.isValid() || layoutEditor.isPending() || state.warnings.length > 0 && !$('#ack').checked;
    $('#edit-template').disabled = state.busy || !chosen();
    $('#delete-template').disabled = state.busy || !state.local.some(t => t.id === state.selected) || state.local.length <= 1;
  }

  function busy(value, text = '') {
    state.busy = value;
    for (const control of root.querySelectorAll('.body input,.body textarea,.body select,.body button,#layout-editor input,#layout-editor select,#layout-editor button,#dpi')) control.disabled = value;
    $('#cancel').hidden = !value || !state.controller;
    if (text) $('#progress-text').textContent = text;
    updateButtons();
  }

  function renderRows() {
    const body = $('#rows'); body.replaceChildren();
    for (const record of sorted()) {
      const row = element('tr'), ids = element('td');
      ids.append(element('div', '', record.productSkcId || '—'), element('strong', '', record.productSkuId));
      const specs = element('td'); specs.append(element('div', '', record.skcSpec || '—'), element('div', '', record.skuSpec || '—'));
      const count = element('td'), input = element('input'); input.type = 'number'; input.min = '1'; input.max = '9999'; input.step = '1';
      input.value = record.quantity; input.setAttribute('aria-label', `SKU ${record.productSkuId} 打印数量`);
      input.addEventListener('input', () => { record.quantity = input.value; input.setCustomValidity(input.validity.valid ? '' : '请输入 1–9999 的整数'); updateCounts(); });
      count.append(input);
      const removeCell = element('td'), remove = element('button', '', '移除');
      remove.setAttribute('aria-label', `移除 SKU ${record.productSkuId}`);
      remove.addEventListener('click', () => { state.records = state.records.filter(item => item.key !== record.key); renderRows(); refreshPreview(); });
      removeCell.append(remove); row.append(ids, specs, element('td', '', record.labelCode), count, removeCell); body.append(row);
    }
    $('#empty').hidden = state.records.length > 0; updateCounts();
  }

  function updateCounts() {
    // The batch separator only makes sense when the loaded data spans several
    // 发货批次; hide and reset the choice otherwise.
    const multipleBatches = new Set(state.records.map(record => record.batchRank ?? 0)).size > 1;
    $('#batch-separator-row').hidden = !multipleBatches;
    if (!multipleBatches) $('#batch-separators').checked = false;
    let text = `${state.records.length} 项 SKU`;
    if (state.records.length) {
      try { text += ` · ${makeJobs(state.records, skuSeparators(), batchSeparators()).pages} 张（含提示页）`; }
      catch (error) { text += ` · ${error.message}`; }
    }
    $('#count').textContent = text; updateButtons();
  }

  function renderTemplates() {
    layoutEditor.sync(chosen());
    const grid = $('#templates'); grid.replaceChildren();
    for (const template of allTemplates()) {
      const card = element('button', 'template-card'); card.type = 'button'; card.setAttribute('aria-pressed', String(state.selected === template.id));
      card.append(element('strong', '', template.name), element('span', '', `${template.width} × ${template.height} mm · 本地`));
      card.addEventListener('click', () => {
        state.selected = template.id; $('#origin').value = template.origin ?? 'China'; renderTemplates(); refreshPreview();
        save().catch(error => notice(`模板选择未保存：${error.message}`, 'warn'));
      });
      grid.append(card);
    }
    updateButtons();
  }

  async function resolvedTemplate() {
    const selected = chosen();
    if (!selected) throw new Error('请先选择模板。');
    return layoutEditor.apply({ ...selected, origin: $('#origin').value.trim() });
  }

  function refreshPreview() { return previewScheduler.request(); }

  async function renderPreview({ signal, isCurrent }) {
    const empty = message => { $('#preview').setAttribute('aria-busy', 'false'); $('#preview').replaceChildren(element('span', 'hint', message)); previewDialog.empty(message); $('#preview-caption').textContent = ''; };
    if (!layoutEditor.isValid()) { empty('请先填写有效的位置与缩放设置。'); return; }
    if (!state.records.length || !chosen()) { empty('读取商品并选择模板后显示；点击可先打开位置调整。'); return; }
    $('#preview').setAttribute('aria-busy', 'true');
    try {
      const template = await resolvedTemplate();
      signal.throwIfAborted(); if (!isCurrent()) return;
      const model = chosen(), key = JSON.stringify([state.selected, template.kind, template.width, template.height, template.origin]);
      if (previewRendererCache?.key !== key || previewRendererCache?.model !== model) {
        previewRendererCache = { key, model, renderer: createLabelRenderer({ ...template, layout: undefined }, { cacheLabelBase: true }) };
      }
      const renderer = await previewRendererCache.renderer;
      signal.throwIfAborted(); if (!isCurrent()) return;
      const viewport = previewDialog.isOpen() ? previewDialog.getViewport() : previewViewport($('#preview'), 260, 300);
      const record = sorted()[0], dpi = previewDpi(template, viewport, window.devicePixelRatio || 1);
      const canvas = await renderer(record, { dpi, layout: template.layout, signal });
      if (!isCurrent()) { canvas.width = 1; return; }
      // Keep antialiased edges for the screen; thresholding is only for print.
      canvas.style.filter = 'grayscale(1)'; canvas.setAttribute('aria-label', '首张标签灰度预览'); $('#preview').replaceChildren(canvas);
      previewDialog.paint(canvas);
      $('#preview-caption').textContent = `${template.width} × ${template.height} mm · SKU ${record.productSkuId} · 点击放大调整`;
    } catch (error) {
      if (isCurrent() && error.name !== 'AbortError') { previewRendererCache = undefined; empty(`预览失败：${error.message}`); }
    } finally { if (isCurrent()) $('#preview').setAttribute('aria-busy', 'false'); }
  }

  function clearRecords() {
    state.records = []; state.warnings = []; state.version++; state.previewVersion++;
    $('#ack-row').hidden = true; $('#ack').checked = false; renderRows(); refreshPreview();
  }

  async function load(selection) {
    if (state.busy) return;
    clearRecords();
    const version = state.version, controller = new AbortController(); state.controller = controller;
    busy(true, '正在获取商品数据…'); $('#progress').value = 0;
    try {
      const result = await fetchLabels({
        type: $('#type').value, ids: selection.ids, groups: selection.groups, selectionOrder: selection.selectionOrder, mallId: $('#mall').value.trim(),
        origin: services.dataOrigin || location.origin, request: services.request, signal: controller.signal,
        onProgress: value => { $('#progress').value = value; },
      });
      if (version !== state.version) return;
      state.records = result.records; state.warnings = result.warnings;
      $('#ack-row').hidden = !result.warnings.length;
      notice(result.warnings.length ? result.warnings.join('\n') : `已读取 ${result.records.length} 项 SKU，请核对数量、规格和模板内容。`, result.warnings.length ? 'warn' : '');
      renderRows(); await refreshPreview();
    } catch (error) {
      if (version === state.version) notice(error.name === 'AbortError' ? '已取消读取，未保留未完成的数据。' : error.message, error.name === 'AbortError' ? '' : 'error');
    } finally { if (state.controller === controller) { state.controller = null; busy(false, '就绪'); } }
  }

  function openEditor(template) {
    previewDialog.close();
    designer.open(template ? layoutEditor.apply({ ...template, origin: $('#origin').value.trim() }) : undefined, sorted()[0]);
  }

  async function open() {
    returnFocus = document.activeElement; $('#overlay').hidden = false;
    const type = pageType();
    if (type && $('#type').value !== type) { $('#type').value = type; clearRecords(); }
    if (!$('#mall').value) $('#mall').value = await services.getMallId();
    $('.panel').focus();
  }
  function close() {
    if (state.busy) { notice('任务正在进行，请先取消任务再关闭。', 'warn'); return; }
    designer.close(); previewDialog.close();
    $('#overlay').hidden = true; (returnFocus || $('#launcher')).focus();
  }

  on('#launcher', open); on('#close', close);
  on('#read-selected', () => load(readSelected($('#type').value, clicks)));
  on('#read-manual', () => { const ids = splitIds($('#manual-ids').value); return load({ ids, selectionOrder: ids }); });
  on('#clear', () => { clearRecords(); notice('已清空打印明细。'); });
  on('#cancel', () => state.controller?.abort());
  on('#type', () => { clearRecords(); notice('编号类型已改变，请重新读取商品数据。'); }, 'change');
  on('#mall', () => { clearRecords(); notice('店铺已改变，请重新读取商品数据。'); }, 'input');
  on('#sort', () => { renderRows(); refreshPreview(); }, 'change');
  on('#separators', updateCounts, 'change'); on('#batch-separators', updateCounts, 'change'); on('#ack', updateButtons, 'change');
  let previewTimer;
  on('#origin', () => { clearTimeout(previewTimer); previewTimer = setTimeout(refreshPreview, 250); }, 'input');
  on('#new-template', () => openEditor());
  on('#edit-template', () => { if (chosen()) openEditor(chosen()); });
  on('#delete-template', async () => {
    if (!state.local.some(template => template.id === state.selected) || state.local.length <= 1) return;
    const next = state.local.filter(template => template.id !== state.selected);
    await save({ templates: next, selected: next[0].id });
    state.local = next; state.selected = next[0].id;
    $('#origin').value = chosen()?.origin ?? 'China'; renderTemplates(); await refreshPreview();
  });
  on('#import-template', () => $('#template-file').click());
  on('#backup-templates', async () => {
    const backup = createTemplateBackup(await savedSettings());
    downloadJson(backup, `轻印模板备份-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    notice(`已发起备份下载：${backup.settings.templates.length} 个模板及已保存的位置。请保留下载的 JSON 文件，换目录或重装后可用“导入备份”恢复。`);
  });
  on('#restore-templates', () => $('#backup-file').click());
  on('#backup-file', async () => {
    const input = $('#backup-file'), file = input.files[0]; input.value = '';
    if (!file) return;
    if (file.size > 16 * 1024 * 1024) throw new Error('模板备份 JSON 不能超过 16 MB。');
    const result = mergeTemplateBackup(await savedSettings(), JSON.parse(await file.text()));
    await save(result.settings);
    state.local = result.settings.templates; state.selected = result.settings.selected; state.layouts = result.settings.layouts;
    previewRendererCache = undefined; $('#origin').value = chosen()?.origin ?? 'China'; renderTemplates(); await refreshPreview();
    notice(`备份导入完成：新增 ${result.added} 个模板，跳过 ${result.skipped} 个相同模板。已有模板未被覆盖。`);
  }, 'change');
  on('#template-file', async () => {
    const input = $('#template-file'), file = input.files[0]; input.value = '';
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) throw new Error('模板 JSON 不能超过 8 MB。');
    const value = JSON.parse(await file.text());
    const template = localTemplate({ ...value, id: `local-${crypto.randomUUID()}` });
    const next = [...state.local, template];
    await save({ templates: next, selected: template.id });
    state.local = next; state.selected = template.id;
    $('#origin').value = template.origin ?? 'China'; renderTemplates(); await refreshPreview(); notice('模板已导入。');
  }, 'change');
  on('#export-template', async () => {
    const template = await resolvedTemplate();
    downloadJson(template, `${template.name.replace(/[\\/:*?"<>|]/g, '_')}.json`);
  });
  on('#generate', async () => {
    if (state.busy || $('#generate').disabled) return;
    const controller = new AbortController(); state.controller = controller;
    busy(true, '正在生成 PDF…'); $('#progress').value = 0;
    try {
      const template = await resolvedTemplate();
      const result = await generatePdf({
        records: structuredClone(sorted()), template, separators: skuSeparators(), batchSeparators: batchSeparators(), dpi: Number($('#dpi').value), signal: controller.signal,
        onProgress: ({ percent, completed, pages }) => { $('#progress').value = percent; $('#progress-text').textContent = `生成 PDF ${percent}% · ${completed}/${pages} 张`; },
      });
      controller.signal.throwIfAborted();
      await services.openPdf(result.bytes, `合规标签-${new Date().toISOString().replace(/[:.]/g, '-')}.pdf`);
      notice(`已生成 ${result.pages} 张标签，并打开 PDF 预览。请核对后点击打印。`);
      $('#progress-text').textContent = `PDF 已生成 · ${result.pages} 张`;
    } catch (error) {
      notice(error.name === 'AbortError' ? '已取消生成 PDF。' : `生成或打开预览失败：${error.message}`, error.name === 'AbortError' ? '' : 'error');
      $('#progress-text').textContent = '未完成';
    } finally { state.controller = null; busy(false); }
  });
  if (services.demo) {
    $('#demo').hidden = false;
    on('#demo', () => {
      clearRecords(); state.records = structuredClone(SAMPLE); renderRows(); refreshPreview();
      notice('示例数据：用于验证标签排版，不能用于真实商品。');
    });
  }
  root.addEventListener('keydown', event => {
    if (designer.isOpen()) {
      if (event.key === 'Tab') {
        const nodes = [...$('#editor').querySelectorAll('button,input,select,textarea')].filter(node => !node.disabled && !node.hidden && node.getClientRects().length);
        if (event.shiftKey && root.activeElement === nodes[0]) { event.preventDefault(); nodes.at(-1)?.focus(); }
        else if (!event.shiftKey && root.activeElement === nodes.at(-1)) { event.preventDefault(); nodes[0]?.focus(); }
      }
      return;
    }
    if (event.key === 'Escape') { event.preventDefault(); if (previewDialog.isOpen()) previewDialog.close(); else close(); }
    if (event.key !== 'Tab' || $('#overlay').hidden) return;
    const activePanel = previewDialog.isOpen() ? $('.layout-dialog') : $('.panel');
    const focusables = [...activePanel.querySelectorAll('button,input,select,textarea,summary,a')].filter(node => !node.disabled && !node.hidden && node.getClientRects().length);
    const first = focusables[0], last = focusables.at(-1);
    if (event.shiftKey && (root.activeElement === first || root.activeElement === activePanel)) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && root.activeElement === last) { event.preventDefault(); first?.focus(); }
  });

  try {
    const settings = await services.loadSettings();
    if (settings.migrationNotice) notice(settings.migrationNotice, 'warn');
    if (settings.layouts && typeof settings.layouts === 'object' && !Array.isArray(settings.layouts)) {
      state.layouts = Object.fromEntries(Object.entries(settings.layouts).map(([key, layout]) => [key, normalizeLayout(layout)]));
    }
    if (Array.isArray(settings.templates) && settings.templates.length) {
      const restored = settings.templates.map(localTemplate);
      state.local = restored; state.selected = restored.some(template => template.id === settings.selected) ? settings.selected : restored[0].id;
    }
  } catch (error) { notice(`本地模板读取失败，已使用默认模板：${error.message}`, 'warn'); }
  $('#origin').value = chosen()?.origin ?? 'China';
  renderRows(); renderTemplates();
  const refreshRoute = () => {
    $('#launcher').hidden = !services.demo && !pageType();
    if (lastPath === location.pathname) return;
    lastPath = location.pathname; clicks.clear(); state.controller?.abort();
    clearRecords(); $('#mall').value = ''; $('#manual-ids').value = '';
    if (pageType()) $('#type').value = pageType();
    if (!$('#overlay').hidden) { notice('页面已切换，请重新读取当前店铺数据。'); services.getMallId().then(id => { $('#mall').value = id; }).catch(() => {}); }
  };
  refreshRoute(); const routeTimer = setInterval(refreshRoute, 1000);
  window.addEventListener('pagehide', () => { clearInterval(routeTimer); state.controller?.abort(); previewScheduler.dispose(); previewRendererCache = undefined; }, { once: true });
  return { open };
}
