import { createHash } from 'node:crypto';

const escapeXml = value => String(value).replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;',
})[character]);

export function tokenPlaceholderSvg(mint, symbol) {
  const digest = createHash('sha256').update(mint).digest();
  const hue = ((digest[0] << 8) | digest[1]) % 360;
  const label = escapeXml((String(symbol || '').trim() || mint.slice(0, 3)).slice(0, 5).toUpperCase());
  const size = label.length > 4 ? 59 : label.length > 3 ? 68 : 84;
  const marks = Array.from({ length: 4 }, (_, index) => {
    const x = 25 + (digest[index + 2] % 160);
    const y = 20 + (digest[index + 6] % 160);
    const radius = 12 + (digest[index + 10] % 32);
    return `<circle cx="${x}" cy="${y}" r="${radius}" fill="#fff" opacity=".09"/>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" role="img" aria-label="Generated ${label} token avatar"><defs><linearGradient id="bg" x2="1" y2="1"><stop stop-color="hsl(${hue} 70% 42%)"/><stop offset="1" stop-color="hsl(${(hue + 46) % 360} 70% 25%)"/></linearGradient></defs><rect width="256" height="256" rx="46" fill="url(#bg)"/>${marks}<text x="128" y="143" text-anchor="middle" fill="#fff" font-family="Arial,sans-serif" font-size="${size}" font-weight="700" letter-spacing="-3">${label}</text><path d="M96 173h64" stroke="#fff" stroke-width="5" stroke-linecap="round" opacity=".65"/></svg>`;
}
