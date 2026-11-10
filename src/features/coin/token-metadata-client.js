// Logo, description and links from a token's on-chain metadata URI, read by the
// server (/api/tokens/:mint/metadata) so the browser never fetches untrusted JSON.
const cache = new Map();

export function loadTokenMetadata(apiRequest, mint, { timeoutMs = 15000 } = {}) {
  if (!cache.has(mint)) {
    const pending = apiRequest(`/api/tokens/${encodeURIComponent(mint)}/metadata`, { signal: AbortSignal.timeout(timeoutMs) })
      .then(result => (result?.available && result.data?.mint === mint ? result.data : null))
      .catch(() => null);
    cache.set(mint, pending);
    pending.then(data => { if (!data) cache.delete(mint); });
  }
  return cache.get(mint);
}

export function safeImageUrl(value) {
  try { const url = new URL(String(value || '')); return url.protocol === 'https:' ? url.href : null; }
  catch { return null; }
}

// <img> for an untrusted logo URL: HTTPS only, no referrer, removed if it fails.
export function tokenLogo(document, url, alt, className = 'token-meta-logo') {
  const src = safeImageUrl(url);
  if (!src) return null;
  const img = document.createElement('img');
  img.className = className; img.src = src; img.alt = alt || '';
  img.loading = 'lazy'; img.decoding = 'async'; img.referrerPolicy = 'no-referrer';
  img.width = 48; img.height = 48;
  img.addEventListener('error', () => img.remove(), { once: true });
  return img;
}

export function metadataLinks(data) {
  const links = data?.links || {};
  return [['Website', links.website], ['X', links.twitter], ['Telegram', links.telegram], ['Discord', links.discord]]
    .map(([label, href]) => [label, safeImageUrl(href)]).filter(([, href]) => href);
}
