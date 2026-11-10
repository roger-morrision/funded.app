import { escapeHtml } from '../shared/display.js';
import { icon } from '../../../ui-icons.js';
import {accountFavorites} from '../account/preferences.js';

function listingParts(listing) {
  const mint = String(listing.mint);
  const signature = String(listing.signature);
  return {
    mint,
    symbol: escapeHtml(String(listing.symbol)),
    name: escapeHtml(String(listing.name)),
    shortMint: escapeHtml(`${mint.slice(0, 5)}…${mint.slice(-4)}`),
    proofUrl: `https://explorer.solana.com/tx/${encodeURIComponent(signature)}?cluster=devnet`,
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
    <div class="home-card-overview"><div class="home-launch-card-media"><span class="home-token-avatar" aria-hidden="true">${escapeHtml(String(listing.symbol).slice(0, 1))}</span></div>
    <div class="home-card-info"><div class="home-launch-card-top"><span class="home-token-identity"><strong>${symbol}</strong><small>${name}</small></span>
      <div class="home-launch-card-addresses"><span title="Token mint: ${mint}"><small>Mint</small><code>${shortMint}</code><button type="button" class="home-launch-copy-address" data-copy-address="${mint}" data-copy-kind="token" aria-label="Copy full token address" title="Copy full token address">${icon('copy')}</button></span></div>
      <span class="home-launch-media-stage">Paid listing</span>
    </div></div></div>
    <div class="home-launch-protocol" aria-label="Listing details">
      <span class="home-launch-chip is-listed">${icon('listingBag')}Listed ${listedDate}</span>
      ${burned ? `<span class="home-launch-chip is-burn">${icon('burn')}${escapeHtml(burned)} $RICH burned</span>` : ''}
      ${price ? `<span class="home-launch-chip">${escapeHtml(price)} listing</span>` : ''}
    </div>
    <div class="home-launch-card-actions"><button type="button" class="watch-button token-card-action-watch${saved?' active':''}" data-mint="${mint}" aria-pressed="${saved}" aria-label="${saved?'Remove token from favorites':`Add ${symbol} to favorites`}">${icon(saved?'starFilled':'star')}</button><a class="card-review-buy" href="/token/${encodeURIComponent(mint)}" aria-label="View token">View</a><a class="paid-listing-proof" href="${proofUrl}" target="_blank" rel="noopener noreferrer">View burn proof ↗</a></div>
  </article>`;
}

export function paidListingTableMarkup(listing) {
  const { mint, symbol, name, shortMint, proofUrl, listedDate } = listingParts(listing);
  return `<tr><td><a class="home-table-coin" href="/token/${encodeURIComponent(mint)}" data-logo-mint="${mint}"><span class="home-token-avatar" aria-hidden="true">${escapeHtml(String(listing.symbol).slice(0, 1))}</span><span><strong>${symbol}</strong><small>${name}</small></span></a></td><td title="${mint}"><code>${shortMint}</code></td><td>${listedDate}</td><td><a class="paid-listing-proof" href="${proofUrl}" target="_blank" rel="noopener noreferrer">Verified burn ↗</a></td></tr>`;
}
