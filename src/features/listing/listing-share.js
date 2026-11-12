import { apiRequest } from '../../../client.js';

// Share a fresh listing: prefilled post text, a token banner (wide or square)
// and the usual channels (X, Telegram, WhatsApp, Facebook, LinkedIn, Reddit,
// the device share sheet, copy and download). Nothing is posted automatically.
const loadImage = src => new Promise(resolve => {
  if (!/^https:\/\//.test(src || '')) { resolve(null); return; }
  const image = new Image(); image.crossOrigin = 'anonymous'; image.referrerPolicy = 'no-referrer';
  const timer = setTimeout(() => resolve(null), 5000);
  image.onload = () => { clearTimeout(timer); resolve(image); };
  image.onerror = () => { clearTimeout(timer); resolve(null); };
  image.src = src;
});

export function listingShareText({ symbol, name, mint }) {
  const ticker = symbol ? `$${String(symbol).replace(/^\$/, '')}` : (name || 'This token');
  return `${ticker} is now listed on richpad.fun 🚀\nLive chart, trades and holders in one place.\nCA: ${mint}`;
}

export async function openListingShare(listing) {
  const mint = listing?.mint;
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint || '')) return;
  const overview = await apiRequest(`/api/tokens/${encodeURIComponent(mint)}/overview`, { signal: AbortSignal.timeout(8000) }).then(result => result.data).catch(() => null);
  const symbol = listing.symbol || overview?.symbol || '', name = listing.name || overview?.name || '';
  const logoImage = await loadImage(overview?.imageUri || overview?.logoUri);
  const { initShareComposer, openShareComposer } = await import('../../../share-tools.js');
  initShareComposer();
  openShareComposer({
    kind: 'listing',
    title: `${symbol ? `$${symbol}` : name || 'Token'} on richpad.fun`,
    text: listingShareText({ symbol, name, mint }),
    url: `${location.origin}/token/${encodeURIComponent(mint)}`,
    network: 'Solana',
    result: { kind: 'listing', verified: true, mint, symbol, name, logoImage,
      priceUsd: Number(overview?.priceUsd), marketCapUsd: Number(overview?.marketCapUsd), volume24hUsd: Number(overview?.volume24hUsd) },
  });
}
