import { pdfStore } from './pdf-store.mjs';

const status = document.querySelector('#status'), frame = document.querySelector('#pdf');
const print = document.querySelector('#print'), download = document.querySelector('#download');
let url;
document.querySelector('#close').addEventListener('click', () => window.close());
print.addEventListener('click', () => {
  try { frame.contentWindow.focus(); frame.contentWindow.print(); }
  catch { status.textContent = '请使用 PDF 预览工具栏的打印按钮，或下载后打印。'; }
});
window.addEventListener('pagehide', () => { if (url) URL.revokeObjectURL(url); });
try {
  const id = new URL(location.href).searchParams.get('id');
  const record = id && await pdfStore('readonly', store => store.get(id));
  if (!record || record.createdAt < Date.now() - 24 * 60 * 60 * 1000) throw new Error('预览已过期，请重新生成标签。');
  url = URL.createObjectURL(record.blob);
  frame.addEventListener('load', () => { print.disabled = false; status.textContent = 'PDF 已生成，请预览后打印。'; }, { once: true });
  frame.src = url;
  download.href = url; download.download = record.filename; download.hidden = false;
  document.title = record.filename;
} catch (error) { status.textContent = error.message; }
