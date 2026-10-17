import { mountLabelApp } from '../src/ui/app.mjs';
import { createExtensionServices } from '../src/integration/bridge.mjs';
import { createSettingsStore } from '../src/printing/settings-store.mjs';
import { createSettingsClient } from '../src/core/settings.mjs';

let pdfUrl;
const persistence = globalThis.chrome?.runtime?.id ? await createExtensionServices() : createSettingsClient(createSettingsStore({
  async get(keys) { return Object.fromEntries(keys.map(key => [key, JSON.parse(localStorage.getItem(`qingyinPreview:${key}`) || 'null')])); },
  async set(values) { for (const [key, value] of Object.entries(values)) localStorage.setItem(`qingyinPreview:${key}`, JSON.stringify(value)); },
}));
const choose = id => document.getElementById(id).value;
const idsToItems = ids => ids.map((id, index) => ({
  labelCodeVO: { productSkuId: id, productSkcId: String(BigInt(id) - 1000000000000n), labelCode: String(53711398047n + BigInt(index)), skuExtCode: `SKU-${index + 1}` },
  productSkuSpecI18nMap: { en: [{ specName: index % 2 ? 'White-M' : 'Black-L' }] },
  productSkcSpecI18nMap: { en: [{ specName: 'Cotton' }] },
}));

const services = {
  demo: true, dataOrigin: 'https://seller.kuajingmaihuo.com',
  getMallId: async () => '1001', loadSettings: persistence.loadSettings, saveSettings: persistence.saveSettings,
  async request(config) {
    const mode = choose('fixture-mode');
    await new Promise(resolve => setTimeout(resolve, mode === 'slow' ? 2000 : 30));
    if (mode === 'error') throw new Error('模拟网络错误：请稍后重试。');
    if (config.url.endsWith('/labelcode/pageQuery')) {
      const ids = config.data.productSkuIdList;
      return { success: true, result: { pageItems: mode === 'empty' ? [] : idsToItems(mode === 'missing' ? ids.slice(0, -1) : ids) } };
    }
    throw new Error('验证页面仅模拟商品 SKU 接口，请选择“商品 SKU”或点击“载入示例数据”。');
  },
  async openPdf(bytes) {
    if (pdfUrl) URL.revokeObjectURL(pdfUrl);
    const pdf = await globalThis.PDFLib.PDFDocument.load(bytes);
    pdfUrl = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
    const pages = pdf.getPages();
    document.getElementById('fixture-output').textContent = `PDF 验证通过：${pages.length} 页；首张 ${pages[0].getWidth().toFixed(2)} × ${pages[0].getHeight().toFixed(2)} pt；${bytes.length} 字节`;
    const link = document.getElementById('fixture-download'); link.href = pdfUrl; link.download = 'labels-test.pdf'; link.hidden = false;
    const frame = document.getElementById('fixture-pdf'); frame.src = pdfUrl; frame.hidden = false;
  },
};
await mountLabelApp(services, '../src/ui/style.css');
