// Reusable share kit: copy link, post on X, and a scannable QR code.
import { el } from './format.js';

// The QR encoder loads only when a share kit is shown.
export async function qrSvg(text, size = 160) {
  const { default: qrcode } = await import('qrcode-generator');
  const qr = qrcode(0, 'M'); qr.addData(text); qr.make();
  const count = qr.getModuleCount(), cell = size / (count + 8);
  let path = '';
  for (let r = 0; r < count; r++) for (let c = 0; c < count; c++) {
    if (qr.isDark(r, c)) path += `M${((c + 4) * cell).toFixed(2)} ${((r + 4) * cell).toFixed(2)}h${cell.toFixed(2)}v${cell.toFixed(2)}h-${cell.toFixed(2)}z`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-label="QR code"><rect width="100%" height="100%" fill="#fff"/><path d="${path}" fill="#0b0d1a"/></svg>`;
}

export function shareKit(document, { url, text, title = 'Share' }) {
  const kit = el(document, 'div', 'share-kit');
  const qr = el(document, 'div', 'share-kit-qr'); void qrSvg(url).then(svg => { qr.innerHTML = svg; }).catch(() => {});
  const body = el(document, 'div', 'share-kit-body');
  body.append(el(document, 'strong', null, title));
  const field = el(document, 'code', 'share-kit-url', url);
  const actions = el(document, 'div', 'share-kit-actions');
  const copy = el(document, 'button', 'secondary-button', 'Copy link'); copy.type = 'button';
  copy.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(url); copy.textContent = 'Copied ✓'; }
    catch { copy.textContent = 'Copy failed'; }
    setTimeout(() => { copy.textContent = 'Copy link'; }, 1800);
  });
  const post = el(document, 'a', 'secondary-button', 'Post on X');
  post.href = `https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`;
  post.target = '_blank'; post.rel = 'noopener noreferrer';
  actions.append(copy, post);
  if (navigator.share) {
    const native = el(document, 'button', 'secondary-button', 'Share…'); native.type = 'button';
    native.addEventListener('click', () => navigator.share({ title: 'richpad.fun', text, url }).catch(() => {}));
    actions.append(native);
  }
  body.append(field, actions);
  kit.append(qr, body);
  return kit;
}
