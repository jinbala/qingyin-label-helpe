import { normalizeLayout } from './layout.mjs';
import { validateDesign } from './design.mjs';

export const MAX_PAGES = 10000;
export const SELLER_HOSTS = new Set([
  'seller.kuajingmaihuo.com', 'agentseller.temu.com', 'seller.temu.com',
  'agentseller-us.temu.com', 'agentseller-eu.temu.com',
]);

export function splitIds(value) {
  const ids = [...new Set(String(value).split(/[\s,，;；]+/u).filter(Boolean))];
  if (ids.length > 1000) throw new Error('一次最多导入 1000 个编号，请分批处理。');
  if (ids.some(id => !/^[\w-]{1,80}$/u.test(id))) throw new Error('编号只能包含字母、数字、下划线和连字符。');
  return ids;
}

export function chunks(items, size) {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, (i + 1) * size));
}

export function compareIds(a, b) {
  const left = String(a ?? ''), right = String(b ?? '');
  if (/^\d+$/.test(left) && /^\d+$/.test(right)) {
    return BigInt(left) < BigInt(right) ? -1 : BigInt(left) > BigInt(right) ? 1 : 0;
  }
  return left.localeCompare(right, 'en', { numeric: true });
}

export function sortRecords(records, mode) {
  const comparators = {
    table: (a, b) => a.tableOrder - b.tableOrder,
    selected: (a, b) => a.selectionRank - b.selectionRank || compareIds(a.productSkuId, b.productSkuId),
    skc: (a, b) => compareIds(a.productSkcId, b.productSkcId) || compareIds(a.productSkuId, b.productSkuId),
    time: (a, b) => timestamp(b.purchaseTime) - timestamp(a.purchaseTime) || a.tableOrder - b.tableOrder,
  };
  return [...records].sort(comparators[mode] || comparators.table);
}

function timestamp(value) {
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) return numeric < 1e11 ? numeric * 1000 : numeric;
  return Date.parse(value) || 0;
}

export function quantity(value) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1 || number > 9999) throw new Error('每项打印数量必须是 1–9999 的整数。');
  return number;
}

export function makeJobs(records, separators, batchSeparators = false) {
  if (!records.length) throw new Error('请先获取商品数据。');
  const jobs = [];
  let pages = 0;
  for (const [index, record] of records.entries()) {
    if (!record.labelCode || !/^[\x20-\x7e]+$/.test(String(record.labelCode))) {
      throw new Error(`SKU ${record.productSkuId || index + 1} 缺少有效 CODE128 条码。`);
    }
    const count = quantity(record.quantity);
    if (pages + count > MAX_PAGES) throw new Error(`合计超过 ${MAX_PAGES} 张，请减少数量或分批打印。`);
    jobs.push({ record, quantity: count, separator: false });
    pages += count;
    const next = records[index + 1];
    const differentSku = next && (String(record.productSkuId) !== String(next.productSkuId) || record.labelCode !== next.labelCode);
    const differentBatch = next && (record.batchRank ?? 0) !== (next.batchRank ?? 0);
    // Both options share one separator page when SKU and 发货批次 change together.
    if (next && (separators && differentSku || batchSeparators && differentBatch)) {
      if (pages + 1 > MAX_PAGES) throw new Error(`合计超过 ${MAX_PAGES} 张，请减少数量或分批打印。`);
      jobs.push({ record: null, quantity: 1, separator: true });
      pages++;
    }
  }
  return { jobs, pages };
}

export function validateTemplate(template, options = {}) {
  if (!template || typeof template !== 'object') throw new Error('模板格式无效。');
  const width = Number(template.width), height = Number(template.height);
  if (![width, height].every(n => Number.isFinite(n) && n >= 15 && n <= 210)) {
    throw new Error('标签宽高必须在 15–210 mm 之间。');
  }
  if (width * height > 210 * 150) throw new Error('模板面积过大，请使用标签纸尺寸。');
  if (template.kind === 'design') return validateDesign(template, width, height, options);
  if (template.kind && template.kind !== 'simple' || template.content !== undefined || template.objects !== undefined) throw new Error('只支持轻印本地文字模板。');
  const result = { width, height, kind: 'simple' };
  // Explicit fields keep imported data inert and exclude remote image or script properties.
  for (const key of ['schema', 'id', 'name', 'productName', 'manufacturer', 'address', 'responsiblePerson', 'contact', 'warning', 'origin']) {
    if (template[key] !== undefined) result[key] = template[key];
  }
  if (template.layout !== undefined) result.layout = normalizeLayout(template.layout, width, height);
  for (const [field, limit] of Object.entries({ name: 80, productName: 200, manufacturer: 300, address: 500, responsiblePerson: 300, contact: 300, warning: 1500, origin: 80 })) {
    if (result[field] !== undefined && (typeof result[field] !== 'string' || result[field].length > limit)) throw new Error(`模板 ${field} 字段无效或过长。`);
  }
  return result;
}

export function getFailure(response, fallback) {
  return String(response?.errorMsg || response?.error_msg || response?.message || response?.error || fallback);
}

function assertSuccess(response, fallback) {
  if (!response || response.success !== true) throw new Error(getFailure(response, fallback));
  return response.result;
}

function spec(parts) {
  return Array.isArray(parts) ? parts.map(item => item.specName || '').filter(Boolean).join('-') : '';
}

// request is supplied by the extension bridge, or by the local preview's fixture service.
export async function fetchLabels({ type, ids, groups, mallId, origin, request, onProgress = () => {}, signal, selectionOrder = ids }) {
  if (!['purchase', 'delivery', 'sku'].includes(type)) throw new Error('不支持的编号类型。');
  if (!ids.length) throw new Error('请先勾选商品或输入编号。');
  if (!/^\d+$/.test(String(mallId))) throw new Error('请填写当前店铺的 Mall ID。');
  if (!SELLER_HOSTS.has(new URL(origin).hostname)) throw new Error('请在 TEMU 商家后台获取真实商品数据。');
  const all = [], warnings = [], missingIds = [];
  const limit = type === 'sku' ? 20 : 100, batches = [];
  if (type === 'delivery' && Array.isArray(groups) && groups.length) {
    // Ask per 发货批次 so every record can be traced back to the batch it
    // belongs to; the delivery response itself does not return that ID.
    const seen = new Set();
    for (const [batchRank, group] of groups.entries()) {
      const unique = [];
      for (const id of group) { const key = String(id); if (!seen.has(key)) { seen.add(key); unique.push(key); } }
      for (const batch of chunks(unique, limit)) batches.push({ batch, batchRank });
    }
    for (const batch of chunks(ids.filter(id => !seen.has(String(id))), limit)) batches.push({ batch, batchRank: 0 });
  } else {
    for (const batch of chunks(ids, limit)) batches.push({ batch, batchRank: 0 });
  }
  const selectedRanks = new Map(selectionOrder.map((id, index) => [String(id), index]));
  const post = async (url, data) => {
    signal?.throwIfAborted();
    const response = await request({ url: new URL(url, origin).href, method: 'POST', data, headers: { MallId: String(mallId) }, signal });
    signal?.throwIfAborted();
    return assertSuccess(response, 'TEMU 数据获取失败，请确认店铺和登录状态。');
  };
  for (const [batchIndex, { batch, batchRank }] of batches.entries()) {
    let raw, quantities = new Map();
    if (type === 'sku') {
      raw = (await post('https://seller.kuajingmaihuo.com/bg-visage-mms/labelcode/pageQuery', {
        page: 1, pageSize: 20, productSkuIdList: batch,
      }))?.pageItems || [];
    } else if (type === 'delivery') {
      raw = await post('https://seller.kuajingmaihuo.com/bgSongbird-api/supplier/deliverGoods/management/printProductSkuLabel', {
        deliveryOrderSnList: batch,
      }) || [];
    } else {
      const agent = new URL(origin).hostname === 'agentseller.temu.com';
      raw = (await post(agent
        ? '/mms/venom/api/supplier/purchase/manager/printProductSkuLabelForPurchaseOrder'
        : '/marvel-mms/cn/api/kiana/venom/purchase/order/printProductSkuLabelForPurchaseOrder',
      { subPurchaseOrderSnList: batch }))?.list || [];
      const details = await post(agent
        ? '/mms/venom/api/supplier/purchase/manager/querySubOrderList'
        : '/oms/bg/venom/api/supplier/purchase/manager/querySubOrderList', {
        pageNo: 1, pageSize: 100, urgencyType: 0, isCustomGoods: false,
        oneDimensionSort: { firstOrderByParam: 'createdAt', firstOrderByDesc: 1 }, subPurchaseOrderSnList: batch,
      });
      for (const order of details?.subOrderForSupplierList || []) {
        for (const sku of order.skuQuantityDetailList || []) quantities.set(`${order.subPurchaseOrderSn}-${sku.productSkuId}`, sku);
      }
    }
    if (!Array.isArray(raw)) throw new Error('TEMU 返回的数据结构已变化，请重新确认接口。');
    const translations = [], pending = [];
    const seen = new Set();
    for (const [index, item] of raw.entries()) {
      const source = type === 'delivery' ? item : item.labelCodeVO || {};
      const sourceId = String(type === 'sku' ? source.productSkuId : type === 'purchase' ? item.subPurchaseOrderSn : item.deliveryOrderSn || item.deliveryOrderSnStr || '');
      if (sourceId) seen.add(sourceId);
      if (!source.labelCode || !source.productSkuId) {
        warnings.push(`一项商品缺少 SKU 或条码，已跳过（${sourceId || batch.join(', ')}）。`);
        continue;
      }
      const detail = quantities.get(`${item.subPurchaseOrderSn}-${source.productSkuId}`);
      const initialQuantity = type === 'sku' ? 1 : type === 'purchase' ? detail?.purchaseQuantity : item.deliveryNum;
      const record = {
        ...source, productSkuId: String(source.productSkuId), productSkcId: String(source.productSkcId || ''),
        fulfilmentProductSkuId: type === 'delivery' && item.isCustomProduct ? `DZ${source.productSkuId}` : detail?.fulfilmentProductSkuId || source.fulfilmentProductSkuId || '',
        labelCode: String(source.labelCode), sourceId, purchaseTime: item.purchaseTime,
        quantity: Number.isInteger(Number(initialQuantity)) && Number(initialQuantity) > 0 ? Number(initialQuantity) : 1,
        selectionRank: selectedRanks.get(sourceId) ?? (batchIndex * 100 + index), batchRank,
      };
      if (type !== 'sku' && !(Number(initialQuantity) > 0)) warnings.push(`SKU ${record.productSkuId} 未取得有效数量，暂设为 1，请核对。`);
      for (const [field, english, chinese] of [
        ['skuSpec', type === 'delivery' ? item.englishSecondarySpecVOList : item.productSkuSpecI18nMap?.en, type === 'delivery' ? item.secondarySpecVOList : item.productSkuSpecI18nMap?.zh],
        ['skcSpec', type === 'delivery' ? item.englishMainSpecVOList : item.productSkcSpecI18nMap?.en, type === 'delivery' ? item.mainSpecVOList : item.productSkcSpecI18nMap?.zh],
      ]) {
        const en = spec(english), zh = spec(chinese);
        record[field] = en || zh;
        if (!en && zh && !/^[\x20-\x7e]+$/.test(zh)) {
          const key = `row${batchIndex}_${index}_${field}`;
          translations.push({ key, baseLang: 'zh', baseText: zh });
          pending.push({ record, field, key });
        }
      }
      all.push(record);
    }
    if (translations.length) {
      const result = await post('https://seller.kuajingmaihuo.com/bg-anniston-mms/translation/batchQuery', {
        translateScene: 6, textDesc: '商品规格', targetLangList: ['en'], translateReqs: translations,
      });
      for (const { record, field, key } of pending) {
        const text = result?.translateRespMap?.[key]?.find(item => item.lang === 'en')?.translation;
        if (text) record[field] = text;
        else warnings.push(`SKU ${record.productSkuId} 的英文规格未返回，保留原文，请核对。`);
      }
    }
    // The delivery endpoint does not consistently return its parent delivery ID.
    if (type !== 'delivery') missingIds.push(...batch.filter(id => !seen.has(String(id))));
    onProgress(Math.round((batchIndex + 1) / batches.length * 100));
  }
  const orderRanks = new Map(ids.map((id, index) => [String(id), index]));
  all.sort((a, b) => (orderRanks.get(a.sourceId) ?? 1e9) - (orderRanks.get(b.sourceId) ?? 1e9));
  all.forEach((record, index) => { record.tableOrder = index; record.key = `${record.sourceId}-${record.productSkuId}-${index}`; });
  if (type === 'delivery' && all.some(record => !record.sourceId)) warnings.push('发货接口未返回部分商品所属的发货单号；这些商品的“勾选顺序”将按接口返回顺序排列，请核对。');
  if (!all.length) throw new Error('没有返回可打印的商品，请检查编号、店铺和登录状态。');
  if (missingIds.length) warnings.push(`以下编号没有返回商品：${missingIds.join('、')}`);
  return { records: all, warnings: [...new Set(warnings)] };
}
