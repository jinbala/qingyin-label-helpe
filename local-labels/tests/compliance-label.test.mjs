import test from 'node:test';
import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';
import PDFLib from '../vendor/pdf-lib.min.js';
import { splitIds, compareIds, sortRecords, makeJobs, validateTemplate, fetchLabels } from '../src/core/core.mjs';
import { localTemplate, defaultTemplates, TEMPLATE_SCHEMA } from '../src/core/templates.mjs';
import { toMonochrome, embedMonochrome, appendImagePage, generatePdf, estimatePdfBytes, PDF_PREFLIGHT_BYTES } from '../src/printing/render.mjs';

globalThis.PDFLib = PDFLib;
const origin = 'https://seller.kuajingmaihuo.com';
const sku = (id, extra = {}) => ({ labelCodeVO: { productSkuId: id, productSkcId: '200', labelCode: `123${id}` }, ...extra });

test('编号保留大整数精度、去重，并限制格式和数量', () => {
  assert.deepEqual(splitIds('9007199254740993123，9007199254740993124\n9007199254740993123'), ['9007199254740993123', '9007199254740993124']);
  assert.equal(compareIds('9007199254740993123', '9007199254740993124'), -1);
  assert.throws(() => splitIds('123<script>'), /编号只能/);
  assert.throws(() => splitIds(Array.from({ length: 1001 }, (_, i) => i).join(',')), /最多/);
});

test('排序不修改原数组；同 SKC 用 SKU 保持稳定顺序；支持秒级时间戳', () => {
  const records = [
    { productSkcId: '10', productSkuId: '100', tableOrder: 0, selectionRank: 1, purchaseTime: 1700000000 },
    { productSkcId: '2', productSkuId: '20', tableOrder: 1, selectionRank: 0, purchaseTime: 1800000000000 },
  ];
  assert.equal(sortRecords(records, 'skc')[0].productSkuId, '20');
  assert.equal(sortRecords(records, 'selected')[0].productSkuId, '20');
  assert.equal(sortRecords(records, 'time')[0].productSkuId, '20');
  assert.equal(records[0].productSkuId, '100');
});

test('数量和条码严格校验；提示页只在不同 SKU 之间插入；防止超量生成', () => {
  const records = [{ productSkuId: '1', labelCode: '123', quantity: 2 }, { productSkuId: '1', labelCode: '123', quantity: 3 }, { productSkuId: '2', labelCode: '456', quantity: 1 }];
  const result = makeJobs(records, true);
  assert.equal(result.pages, 7);
  assert.equal(result.jobs.filter(job => job.separator).length, 1);
  for (const quantity of [0, -1, 1.5, '', 10000, NaN]) assert.throws(() => makeJobs([{ ...records[0], quantity }], false), /整数/);
  assert.throws(() => makeJobs([], false), /先获取/);
  assert.throws(() => makeJobs([{ ...records[0], labelCode: '' }], false), /条码/);
  assert.throws(() => makeJobs([{ ...records[0], quantity: 9999 }, records[1]], false), /超过/);
});

test('不同发货批次之间按需插入提示页，同批次内不重复插入', () => {
  const batch = (rank, quantity = 1) => ({ productSkuId: '1', labelCode: '123', quantity, batchRank: rank });
  const records = [batch(0), batch(0), batch(1), batch(1), batch(2)];
  const off = makeJobs(records, false, false);
  assert.equal(off.pages, 5); assert.equal(off.jobs.filter(job => job.separator).length, 0);
  const on = makeJobs(records, false, true);
  assert.equal(on.pages, 7); assert.equal(on.jobs.filter(job => job.separator).length, 2);
  // A boundary where both conditions hold only inserts one separator.
  const mixed = makeJobs([{ ...batch(0), productSkuId: '1', labelCode: '1' }, { ...batch(1), productSkuId: '2', labelCode: '2' }], true, true);
  assert.equal(mixed.jobs.filter(job => job.separator).length, 1);
});

test('轻印模板格式独立，拒绝旧对象模板并丢弃外部资源属性', () => {
  const own = defaultTemplates()[1], saved = JSON.stringify(own);
  assert.deepEqual(localTemplate(JSON.parse(saved)), own);
  assert.equal(localTemplate({ ...own, src: 'https://example.com/image.png', script: 'alert(1)' }).src, undefined);
  assert.throws(() => localTemplate({ width: 70, height: 40, objects: [] }), /轻印本地模板/);
  assert.throws(() => localTemplate({ schema: TEMPLATE_SCHEMA, kind: 'fabric', width: 70, height: 40 }), /轻印本地模板/);
  assert.throws(() => localTemplate({ ...own, content: { objects: [] } }), /本地文字模板/);
  assert.throws(() => localTemplate({ ...own, width: 500 }), /宽高/);
  assert.equal(JSON.stringify(own), saved);
});

test('SKU 接口每批 20 个，并保持页面顺序和独立勾选顺序', async () => {
  const ids = Array.from({ length: 21 }, (_, i) => String(1000 + i)), calls = [];
  const result = await fetchLabels({ type: 'sku', ids, selectionOrder: [...ids].reverse(), mallId: '123', origin,
    request: async config => { calls.push(config); return { success: true, result: { pageItems: config.data.productSkuIdList.map(id => sku(id)).reverse() } }; },
  });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].data.productSkuIdList.length, 20);
  assert.equal(calls[0].headers.MallId, '123');
  // API order within the page must be restored even if the response arrives reversed.
  assert.deepEqual(result.records.map(row => row.productSkuId), ids);
  assert.equal(sortRecords(result.records, 'selected')[0].productSkuId, ids.at(-1));
});

test('缺失英文时翻译中文；已有英文优先；未返回翻译时保留原文并提示', async () => {
  const calls = [];
  const result = await fetchLabels({ type: 'sku', ids: ['1001', '1002'], mallId: '123', origin,
    request: async config => {
      calls.push(config);
      if (config.url.endsWith('/pageQuery')) return { success: true, result: { pageItems: [
        sku('1001', { productSkuSpecI18nMap: { zh: [{ specName: '黑色' }] } }),
        sku('1002', { productSkuSpecI18nMap: { en: [{ specName: 'White' }], zh: [{ specName: '白色' }] } }),
      ] } };
      assert.equal(config.data.translateReqs.length, 1);
      return { success: true, result: { translateRespMap: {} } };
    },
  });
  assert.equal(calls.length, 2);
  assert.equal(result.records[0].skuSpec, '黑色');
  assert.equal(result.records[1].skuSpec, 'White');
  assert.match(result.warnings.join(''), /英文规格/);
});

test('备货数量来自子单明细；agentseller 使用对应的两个接口', async () => {
  const calls = [];
  const result = await fetchLabels({ type: 'purchase', ids: ['WB123'], mallId: '123', origin: 'https://agentseller.temu.com',
    request: async config => {
      calls.push(config);
      if (config.url.endsWith('/querySubOrderList')) return { success: true, result: { subOrderForSupplierList: [{ subPurchaseOrderSn: 'WB123', skuQuantityDetailList: [{ productSkuId: '1001', purchaseQuantity: 7, fulfilmentProductSkuId: 'FUL1001' }] }] } };
      return { success: true, result: { list: [{ ...sku('1001'), subPurchaseOrderSn: 'WB123', purchaseTime: 1234 }] } };
    },
  });
  assert.equal(result.records[0].quantity, 7);
  assert.equal(result.records[0].fulfilmentProductSkuId, 'FUL1001');
  assert(calls.every(config => config.url.startsWith('https://agentseller.temu.com/mms/venom/')));
});

test('发货每组 100 个、定制品 SKU 前缀和零数量提示', async () => {
  const calls = [];
  const result = await fetchLabels({ type: 'delivery', ids: Array.from({ length: 101 }, (_, i) => `FH${i}`), mallId: '123', origin,
    request: async config => { calls.push(config); return { success: true, result: [{ productSkuId: '1001', productSkcId: '200', labelCode: '12345', deliveryNum: 0, isCustomProduct: true }] }; },
  });
  assert.equal(calls.length, 2);
  assert.equal(result.records[0].fulfilmentProductSkuId, 'DZ1001');
  assert.equal(result.records[0].quantity, 1);
  assert.match(result.warnings.join(''), /数量/);
});

test('按勾选的分发货批次请求，记录带批次序号，跨批次重复编号只取一次', async () => {
  const calls = [];
  const result = await fetchLabels({ type: 'delivery', ids: ['FH1', 'FH2', 'FH3'], groups: [['FH1'], ['FH2', 'FH3', 'FH2']], mallId: '123', origin,
    request: async config => { calls.push(config); return { success: true, result: config.data.deliveryOrderSnList.map(id => ({ productSkuId: id, productSkcId: '200', labelCode: `L${id}`, deliveryNum: 1 })) }; },
  });
  assert.deepEqual(calls.map(call => call.data.deliveryOrderSnList), [['FH1'], ['FH2', 'FH3']]);
  assert.deepEqual(result.records.map(row => row.batchRank), [0, 1, 1]);
  assert.deepEqual(result.records.map(row => row.productSkuId), ['FH1', 'FH2', 'FH3']);
});

test('接口失败、空数据、缺失编号、取消均有明确处理', async () => {
  const options = { type: 'sku', ids: ['1001', '1002'], mallId: '123', origin };
  await assert.rejects(fetchLabels({ ...options, request: async () => ({ success: false, errorMsg: '登录已失效' }) }), /登录已失效/);
  await assert.rejects(fetchLabels({ ...options, request: async () => ({ success: true, result: { pageItems: [] } }) }), /没有返回/);
  const partial = await fetchLabels({ ...options, request: async () => ({ success: true, result: { pageItems: [sku('1001')] } }) });
  assert.match(partial.warnings.join(''), /1002/);
  const controller = new AbortController(); let calls = 0;
  await assert.rejects(fetchLabels({ ...options, signal: controller.signal, request: async () => { calls++; controller.abort(); return { success: true }; } }), { name: 'AbortError' });
  assert.equal(calls, 1);
  await assert.rejects(fetchLabels({ ...options, origin: 'https://example.com', request: async () => {} }), /商家后台/);
});

test('黑白打包使用逐行补齐；透明像素铺白；PDF 为正确毫米尺寸并复用图像', async () => {
  const rgba = new Uint8ClampedArray(9 * 2 * 4).fill(255);
  rgba.set([0, 0, 0, 255], 0); rgba.set([0, 0, 0, 0], 4); rgba.set([0, 0, 0, 255], 9 * 4);
  const image = toMonochrome({ width: 9, height: 2, getContext: () => ({ getImageData: () => ({ data: rgba }) }) });
  assert.deepEqual([...image.packed], [127, 255, 127, 255]);
  const pdf = await PDFLib.PDFDocument.create();
  const { ref } = await embedMonochrome(pdf, image);
  appendImagePage(pdf, ref, 60, 40); appendImagePage(pdf, ref, 60, 40);
  const bytes = await pdf.save(), loaded = await PDFLib.PDFDocument.load(bytes);
  assert.equal(loaded.getPageCount(), 2);
  assert(Math.abs(loaded.getPage(0).getWidth() - 60 * 72 / 25.4) < 1e-8);
  const stream = pdf.context.lookup(ref);
  assert.equal(stream.dict.get(PDFLib.PDFName.of('BitsPerComponent')).asNumber(), 1);
  assert.deepEqual([...inflateSync(stream.getContents())], [...image.packed]);
});

test('翻译接口失败时保留中文规格并给出提示', async () => {
  const result = await fetchLabels({ type: 'sku', ids: ['1001'], mallId: '123', origin, request: async config => {
    if (config.url.endsWith('/pageQuery')) return { success: true, result: { pageItems: [{ labelCodeVO: { productSkuId: '1001', productSkcId: '200', labelCode: '1231001' }, productSkuSpecI18nMap: { zh: [{ specName: '黑色' }] } }] } };
    throw new Error('翻译服务不可用');
  } });
  assert.equal(result.records[0].skuSpec, '黑色');
  assert.match(result.warnings.join(''), /翻译失败/);
});

test('PDF 体积在渲染前按唯一标签数预检', async () => {
  const records = Array.from({ length: 5000 }, (_, index) => ({
    productSkuId: String(9000000000000 + index), productSkcId: '1', labelCode: String(50000000000 + index),
    skuSpec: 'Black-L', skcSpec: 'Cotton', sourceId: `S${index}`, quantity: 1,
  }));
  const template = { schema: 'qingyin-template/v1', kind: 'simple', id: 'estimate', name: '预检', width: 70, height: 40, origin: 'China', productName: 'label' };
  const { jobs, pages } = makeJobs(records, false);
  assert(estimatePdfBytes(template, jobs, pages, 300) > PDF_PREFLIGHT_BYTES);
  await assert.rejects(generatePdf({ records, template, dpi: 300 }), /12 MB/);
});
