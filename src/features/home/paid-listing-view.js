import { escapeHtml } from '../shared/display.js';

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
  const { mint, symbol, name, shortMint, proofUrl, listedDate } = listingParts(listing);
  return `<article class="token-card-shell home-launch-card paid-listing-card" data-mint="${mint}" data-logo-mint="${mint}">
    <a class="home-launch-card-link" href="/token/${encodeURIComponent(mint)}" aria-label="Open ${name} token details"></a>
    <div class="home-launch-card-media"><span class="home-token-avatar" aria-hidden="true">${escapeHtml(String(listing.symbol).slice(0, 1))}</span><span class="home-launch-media-stage">Paid listing</span></div>
    <div class="home-launch-card-top"><span class="home-token-identity"><strong>${symbol}</strong><small>${name}</small></span>
      <div class="home-launch-card-addresses"><span title="Token mint: ${mint}"><small>Mint</small><code>${shortMint}</code></span></div>
    </div>
    <div class="paid-listing-verification"><strong>Payment verified on Devnet</strong><span>$FUNDED BurnChecked · listed ${listedDate}</span></div>
    <div class="home-launch-card-actions"><a class="paid-listing-proof" href="${proofUrl}" target="_blank" rel="noopener noreferrer">View burn proof ↗</a></div>
  </article>`;
}

export function paidListingTableMarkup(listing) {
  const { mint, symbol, name, shortMint, proofUrl, listedDate } = listingParts(listing);
  return `<tr><td><a class="home-table-coin" href="/token/${encodeURIComponent(mint)}" data-logo-mint="${mint}"><span class="home-token-avatar" aria-hidden="true">${escapeHtml(String(listing.symbol).slice(0, 1))}</span><span><strong>${symbol}</strong><small>${name}</small></span></a></td><td title="${mint}"><code>${shortMint}</code></td><td>${listedDate}</td><td><a class="paid-listing-proof" href="${proofUrl}" target="_blank" rel="noopener noreferrer">Verified burn ↗</a></td></tr>`;
}
