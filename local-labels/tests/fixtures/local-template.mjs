import { TEMPLATE_SCHEMA } from '../../src/core/templates.mjs';

export const local7040Template = {
  schema: TEMPLATE_SCHEMA, kind: 'simple', id: 'fixture-7040', name: '本地排版验证', width: 70, height: 40,
  productName: 'Product information', manufacturer: 'Example Studio', address: '123 Sample Street',
  responsiblePerson: 'Example Contact', contact: 'labels@example.com', warning: 'Keep dry', origin: 'China',
};
export const localRecords = [
  { productSkuId: '9000000000001', productSkcId: '800000000001', labelCode: '53711398047', skuSpec: '2XL', skcSpec: 'Black' },
  { productSkuId: '9000000000002', productSkcId: '800000000001', labelCode: '53711398048', skuSpec: '3XL', skcSpec: 'Black' },
].map((record, index) => ({ ...record, key: `fixture-${index}`, quantity: 3, tableOrder: index, selectionRank: index }));
