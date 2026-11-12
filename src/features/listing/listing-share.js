import { apiRequest } from '../../../client.js';

// Token share banners (listing and token page): prefilled post text, a wide or
// square banner with logo and live market figures, and the usual channels (X,
// Telegram, WhatsApp, Facebook, LinkedIn, Reddit, share sheet, copy, download).
// Nothing is posted automatically.
const loadImage = src => new Promise(resolve => {
  if (!/^https?:\/\//.test(src || '')) { resolve(null); return; }
  const image = new Image(); image.crossOrigin = 'anonymous'; image.referrerPolicy = 'no-referrer';
  const timer = setTimeout(() => resolve(null), 5000);
  image.onload = () => { clearTimeout(timer); resolve(image); };
  image.onerror = () => { clearTimeout(timer); resolve(null); };
  image.src = src;
});
const ticker = ({ symbol, name }) => symbol ? `$${String(symbol).replace(/^\$/, '')}` : (name || 'This token');

export function listingShareText({ symbol, name, mint }) {
  return `${ticker({ symbol, name })} is now listed on richpad.fun 🚀\nLive chart, trades and holders in one place.\nCA: ${mint}`;
}
export function tokenShareText({ symbol, name, mint }) {
  return `${ticker({ symbol, name })} on richpad.fun 👀\nLive chart, trades, holders and calls in one place.\nCA: ${mint}`;
}

// Banner data for a token: live figures and a same-origin logo (the server
// fetches it from the token's indexed data) so the canvas stays downloadable.
export async function tokenBannerResult(mint, { symbol = '', name = '', tag = 'NEWLY LISTED' } = {}) {
  const overview = await apiRequest(`/api/tokens/${encodeURIComponent(mint)}/overview`, { signal: AbortSignal.timeout(8000) }).then(result => result.data).catch(() => null);
  const logoImage = await loadImage(`${location.origin}/api/tokens/${encodeURIComponent(mint)}/logo`);
  symbol = symbol || overview?.symbol || ''; name = name || overview?.name || '';
  return { symbol, name, result: { kind: 'listing', verified: true, mint, symbol, name, logoImage, tag,
    priceUsd: Number(overview?.priceUsd), marketCapUsd: Number(overview?.marketCapUsd), volume24hUsd: Number(overview?.volume24hUsd) } };
}

export async function openListingShare(listing) {
  const mint = listing?.mint;
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint || '')) return;
  const { symbol, name, result } = await tokenBannerResult(mint, { symbol: listing.symbol, name: listing.name });
  const { initShareComposer, openShareComposer } = await import('../../../share-tools.js');
  initShareComposer();
  openShareComposer({ kind: 'listing', title: `${symbol ? `$${symbol}` : name || 'Token'} on richpad.fun`,
    text: listingShareText({ symbol, name, mint }), url: `${location.origin}/token/${encodeURIComponent(mint)}`, network: 'Solana', result });
}
