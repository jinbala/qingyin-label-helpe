// PDF bytes cross the extension message channel as base64. Both directions work
// in fixed-size chunks so a large document never materialises as one huge
// latin1 string on either side; only the base64 text itself is unavoidable.
const CHUNK = 3 * 8192; // a whole number of 3-byte groups, so chunks encode independently
const STRING_CHUNK = 8192;

export function encodeBase64(bytes) {
  const parts = [];
  for (let offset = 0; offset < bytes.length; offset += CHUNK) {
    const slice = bytes.subarray(offset, Math.min(offset + CHUNK, bytes.length));
    let binary = '';
    for (let index = 0; index < slice.length; index += STRING_CHUNK) binary += String.fromCharCode(...slice.subarray(index, index + STRING_CHUNK));
    parts.push(btoa(binary));
  }
  return parts.join('');
}

export function decodeBase64(text) {
  const bytes = new Uint8Array(Math.floor(text.length / 4) * 3);
  let length = 0;
  for (let offset = 0; offset < text.length; offset += 4 * STRING_CHUNK) {
    const binary = atob(text.slice(offset, offset + 4 * STRING_CHUNK));
    for (let index = 0; index < binary.length; index++) bytes[length++] = binary.charCodeAt(index);
  }
  return bytes.subarray(0, length);
}
