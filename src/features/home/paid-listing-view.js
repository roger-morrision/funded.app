import { escapeHtml } from '../shared/display.js';
import { icon } from '../../../ui-icons.js';
import {accountFavorites} from '../account/preferences.js';

// Token logo through the same-origin logo route, letter mark until it loads.
const logoMarkup = listing => `<img class="paid-listing-logo" src="/api/tokens/${encodeURIComponent(String(listing.mint))}/logo" alt="" loading="lazy" decoding="async" data-initial="${escapeHtml(String(listing.symbol || '?').slice(0, 1))}">`;
function listingParts(listing) {
  const mint = String(listing.mint);
  const signature = String(listing.signature || '');
  return {
    mint,
    symbol: escapeHtml(String(listing.symbol)),
    name: escapeHtml(String(listing.name)),
    shortMint: escapeHtml(`${mint.slice(0, 5)}…${mint.slice(-4)}`),
    proofUrl: !signature ? '' : `https://explorer.solana.com/tx/${encodeURIComponent(signature)}${import.meta.env?.VITE_SOLANA_CLUSTER==='mainnet-beta'?'':'?cluster=devnet'}`,
    listedDate: escapeHtml(new Date(listing.listedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' })),
  };
}

export function paidListingCardMarkup(listing) {
  const saved=accountFavorites().includes(listing.mint);
  const { mint, symbol, name, shortMint, proofUrl, listedDate } = listingParts(listing);
  const amount = Number(listing.amountTokens);
  const burned = Number.isFinite(amount) && amount > 0 ? amount.toLocaleString('en-US', { maximumFractionDigits: 2 }) : '';
  const price = Number(listing.usd) > 0 ? `$${Number(listing.usd).toLocaleString('en-US')}` : '';
  return `<article class="token-card-shell home-launch-card paid-listing-card" data-mint="${mint}" data-logo-mint="${mint}">
    <a class="home-launch-card-link" href="/token/${encodeURIComponent(mint)}" aria-label="Open ${name} token details"></a>
    <div class="home-card-overview"><div class="home-launch-card-media"><span class="home-token-avatar" aria-hidden="true">${logoMarkup(listing)}</span></div>
    <div class="home-card-info"><div class="home-launch-card-top"><span class="home-token-identity"><strong>${symbol}</strong><small>${name}</small></span>
      <div class="home-launch-card-addresses"><span title="Token mint: ${mint}"><small>Mint</small><code>${shortMint}</code><button type="button" class="home-launch-copy-address" data-copy-address="${mint}" data-copy-kind="token" aria-label="Copy full token address" title="Copy full token address">${icon('copy')}</button></span></div>
    </div></div></div>
    <button type="button" class="watch-button token-card-action-watch paid-listing-star${saved?' active':''}" data-mint="${mint}" aria-pressed="${saved}" aria-label="${saved?'Remove token from favorites':`Add ${symbol} to favorites`}">${icon(saved?'starFilled':'star')}</button>
    <dl class="paid-listing-metrics" data-listing-metrics="${mint}">
      <div data-metric="cap"><dt>Market cap</dt><dd>…</dd></div>
      <div data-metric="volume"><dt>24h volume</dt><dd>…</dd></div>
      <div data-metric="holders"><dt>Holders</dt><dd>…</dd></div>
    </dl>
    <div class="home-launch-protocol" aria-label="Listing details">
      <span class="home-launch-chip is-listed">${icon('listingBag')}Listed ${listedDate}</span>
      ${burned ? `<span class="home-launch-chip is-burn">${icon('burn')}${escapeHtml(burned)} $RICH burned</span>` : ''}
      ${price ? `<span class="home-launch-chip">${escapeHtml(price)} listing</span>` : ''}
    </div>
    ${proofUrl ? `<div class="home-launch-card-actions"><a class="paid-listing-proof" href="${proofUrl}" target="_blank" rel="noopener noreferrer">View burn proof ↗</a></div>` : ''}
  </article>`;
}

export function paidListingTableMarkup(listing) {
  const { mint, symbol, name, shortMint, proofUrl, listedDate } = listingParts(listing);
  return `<tr><td><a class="home-table-coin" href="/token/${encodeURIComponent(mint)}" data-logo-mint="${mint}"><span class="home-token-avatar" aria-hidden="true">${logoMarkup(listing)}</span><span><strong>${symbol}</strong><small>${name}</small></span></a></td><td title="${mint}"><code>${shortMint}</code></td><td>${listedDate}</td><td>${proofUrl ? `<a class="paid-listing-proof" href="${proofUrl}" target="_blank" rel="noopener noreferrer">Verified burn ↗</a>` : 'Listed by admin'}</td></tr>`;
}

// Fill each listing card's Market cap / 24h volume / Holders from the token overview.
const overviewCache = new Map();
const compactUsd = value => !Number.isFinite(value) ? '—' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: Math.abs(value) >= 10000 ? 'compact' : 'standard', maximumFractionDigits: 2 }).format(value);
const changeMarkup = value => Number.isFinite(value) ? `<small class="${value >= 0 ? 'is-positive' : 'is-negative'}">${value >= 0 ? '+' : ''}${value.toFixed(2)}%</small>` : '';
function fillMetrics(root, mint, data) {
  const box = root.querySelector(`[data-listing-metrics="${CSS.escape(mint)}"]`); if (!box) return;
  const set = (name, html) => { const cell = box.querySelector(`[data-metric="${name}"] dd`); if (cell) cell.innerHTML = html; };
  const cap = Number(data?.marketCapUsd ?? data?.fdvUsd), volume = Number(data?.windows?.['24h']?.volumeUsd ?? data?.volume24hUsd), holders = Number(data?.holders);
  set('cap', `${escapeHtml(compactUsd(cap))}${changeMarkup(Number(data?.priceChangePercent))}`);
  set('volume', escapeHtml(compactUsd(volume)));
  set('holders', Number.isFinite(holders) && holders > 0 ? escapeHtml(holders.toLocaleString('en-US')) : '—');
}
export async function loadPaidListingMetrics(root, request) {
  const mints = [...root.querySelectorAll('[data-listing-metrics]')].map(node => node.dataset.listingMetrics);
  for (const mint of mints) if (overviewCache.has(mint)) fillMetrics(root, mint, overviewCache.get(mint));
  const queue = mints.filter(mint => !overviewCache.has(mint));
  const worker = async () => {
    for (let mint = queue.shift(); mint; mint = queue.shift()) {
      const result = await request(`/api/tokens/${encodeURIComponent(mint)}/overview`, { signal: AbortSignal.timeout(12000) }).catch(() => null);
      const data = result?.available && result.data?.mint === mint ? result.data : null;
      overviewCache.set(mint, data); fillMetrics(root, mint, data);
    }
  };
  await Promise.all([worker(), worker()]);
}
