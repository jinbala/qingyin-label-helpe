// Errors reach the UI from several worlds: our own Error instances, DOM
// exceptions, and libraries such as JsBarcode that throw bare strings. Always
// turn whatever was caught into readable Chinese text instead of `undefined`.
export function messageOf(error, fallback = '未知错误') {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error) return error;
  const message = error && typeof error.message === 'string' ? error.message : '';
  return message || fallback;
}
