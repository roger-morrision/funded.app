import { MAX_IMAGE_BYTES, validateImageFile } from './launch-image.js';

let prepared = null;
let pending = false;
let error = null;
let generation = 0;
let previewUrl = null;

export function getPreparedBanner() { return prepared; }
export function getBannerPreviewUrl() { return previewUrl; }
export function assertBannerReady() {
  if (pending) throw new Error('Wait for banner preparation to finish.');
  if (error) throw new Error(error);
}

export async function prepareLaunchBanner(file) {
  const request = ++generation;
  prepared = null;
  pending = Boolean(file);
  error = null;
  if (!file) {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = null;
    return null;
  }
  let bitmap;
  try {
    validateImageFile(file);
    bitmap = await createImageBitmap(file);
    if (bitmap.width * bitmap.height > 25_000_000 || bitmap.width < 3 || bitmap.height < 1) throw new Error('Banner must be at most 25 megapixels.');
    const canvas = document.createElement('canvas');
    canvas.width = 1200;
    canvas.height = 400;
    const sourceWidth = Math.min(bitmap.width, bitmap.height * 3);
    const sourceHeight = sourceWidth / 3;
    canvas.getContext('2d').drawImage(bitmap, (bitmap.width - sourceWidth) / 2, (bitmap.height - sourceHeight) / 2, sourceWidth, sourceHeight, 0, 0, 1200, 400);
    let blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/webp', .88));
    for (const quality of [.78, .65, .5, .35]) {
      if (blob && blob.size <= MAX_IMAGE_BYTES) break;
      blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/webp', quality));
    }
    if (!blob || blob.size > MAX_IMAGE_BYTES) throw new Error('This banner is too complex. Try a smaller or simpler image.');
    if (request !== generation) return null;
    prepared = new File([blob], 'token-banner.webp', { type: 'image/webp' });
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = URL.createObjectURL(blob);
    return { file: prepared, url: previewUrl, width: 1200, height: 400 };
  } catch (cause) {
    if (request === generation) error = cause.message;
    throw cause;
  } finally {
    bitmap?.close();
    if (request === generation) pending = false;
  }
}
