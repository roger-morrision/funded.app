import { MAX_IMAGE_BYTES } from './launch-image.js';

async function fingerprint(draft) {
  const bytes = new TextEncoder().encode(JSON.stringify(draft));
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), value => value.toString(16).padStart(2, '0')).join('');
}

async function access(mode, operation) {
  if (!globalThis.indexedDB) throw new Error('Image storage is unavailable on this device.');
  const database = await new Promise((resolve, reject) => {
    const request = indexedDB.open('funded-launch-drafts', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('images');
    let abandoned = false;
    request.onsuccess = () => { if (abandoned) request.result.close(); else resolve(request.result); };
    request.onerror = () => reject(new Error('Image storage could not be opened.'));
    request.onblocked = () => { abandoned = true; reject(new Error('Close other app tabs before updating the saved image.')); };
  });
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction('images', mode);
      const request = operation(transaction.objectStore('images'));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onabort = transaction.onerror = () => reject(new Error('Saved image could not be updated.'));
    });
  } finally { database.close(); }
}

export async function saveDraftImage(draft, file) {
  if (!file || !['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > MAX_IMAGE_BYTES) throw new Error('Prepare an image before saving it.');
  const record = { fingerprint: await fingerprint(draft), blob: file, type: file.type };
  await access('readwrite', store => store.put(record, 'current'));
}

export async function readDraftImage(draft) {
  const record = await access('readonly', store => store.get('current'));
  if (!record || record.fingerprint !== await fingerprint(draft)) return null;
  if (!(record.blob instanceof Blob) || record.blob.size > MAX_IMAGE_BYTES || !['image/png', 'image/jpeg', 'image/webp'].includes(record.type)) return null;
  return new File([record.blob], 'restored-token-image', { type: record.type });
}

export async function deleteDraftImage() {
  await access('readwrite', store => store.delete('current'));
}
