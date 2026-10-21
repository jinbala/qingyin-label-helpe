import { messageOf } from '../core/errors.mjs';

// JsBarcode throws bare strings for unencodable CODE128 input, so callers that
// only read `error.message` used to show "undefined". Normalise every failure
// into one actionable Chinese error, and reject empty content before encoding.
export function encodeCode128(target, value, options, JsBarcode = globalThis.JsBarcode) {
  const text = String(value ?? '');
  if (!text) throw new Error('CODE128 内容不能为空，请填写数字、字母或条码变量。');
  try {
    JsBarcode(target, text, options);
  } catch (error) {
    const short = text.length > 40 ? `${text.slice(0, 40)}…` : text;
    throw new Error(`CODE128 只能编码英文字母、数字和常见符号，请检查内容「${short}」：${messageOf(error, '编码失败')}`);
  }
}
