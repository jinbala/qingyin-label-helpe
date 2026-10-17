const DB_NAME = 'qingyin-label-pdfs-v1';

function database() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('pdfs', { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function pdfStore(mode, operation) {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction('pdfs', mode);
      let result;
      const request = operation(transaction.objectStore('pdfs'));
      if (request) request.onsuccess = () => { result = request.result; };
      transaction.oncomplete = () => resolve(result);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error || new Error('PDF 存储已取消。'));
    });
  } finally { db.close(); }
}

export async function cleanupPdfs() {
  return pdfStore('readwrite', store => {
    const request = store.openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      if (cursor.value.createdAt < Date.now() - 24 * 60 * 60 * 1000) cursor.delete();
      cursor.continue();
    };
  });
}
