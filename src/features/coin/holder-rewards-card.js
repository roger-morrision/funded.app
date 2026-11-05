// Coin page "Holder rewards" card: how much this coin has paid its holders,
// what is waiting in the pot for the next payout, and how often it pays.
// Reads /api/rewards/experience?mint=… once per coin; hidden for coins that
// do not share creator fees with holders.
import { receiptUrl } from '../experience/receipt-inspector.js';
import { signature, address, utc } from '../experience/view-utils.js';
import { formatReviewSol } from '../../../launch-review.js';
import { formatProofSol, formatProofUsd } from '../proof/proof-totals.js';

const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const lamports = value => { const number = Number(value); return value != null && value !== '' && Number.isFinite(number) && number >= 0 ? number : null; };
const CADENCE = { hourly: 'every hour', daily: 'every day' };

export function holderRewardsSummary(token) {
  const share = Number(token?.holderSharePercent);
  if (!token || !(share > 0)) return null;
  const allocated = lamports(token.totals?.holder);
  const paid = lamports(token.holderPaidLamports);
  const policy = token.holderRewardPolicy || {};
  return {
    symbol: token.symbol || '',
    share,
    paid,
    waiting: allocated != null && paid != null ? Math.max(0, allocated - paid) : null,
    wallets: lamports(token.holderPaidWallets),
    payouts: lamports(token.holderPayoutCount),
    lastPaidAt: token.lastHolderPayout ? Date.parse(token.lastHolderPayout) : null,
    cadence: CADENCE[policy.cadence] || (Number(policy.periodSeconds) > 0 ? `every ${Math.round(policy.periodSeconds / 60)} minutes` : 'after each fee cycle'),
    funding: token.availableHolderPoolLamports == null ? null : lamports(token.availableHolderPoolLamports),
    poolMinimum: Number(policy.minimumPoolUsd) || null,
    minimumHolderUsd: Number(policy.minimumHolderUsd) > 0 ? Number(policy.minimumHolderUsd) : null,
  };
}

export function relativeTime(at, now = Date.now()) {
  if (!Number.isFinite(at)) return 'No payout yet';
  const minutes = Math.max(0, Math.round((now - at) / 60_000));
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.round(hours / 24)} days ago`;
}

export function holderRewardsMarkup(summary, { solUsd = null, now = Date.now() } = {}) {
  if (!summary) return '';
  const usd = value => { const text = formatProofUsd(value, solUsd); return text ? `<em>≈ ${escape(text)}</em>` : ''; };
  const symbol = summary.symbol ? `$${escape(summary.symbol)}` : 'this coin';
  const rule = `Paid in SOL ${summary.cadence} to eligible holders of ${symbol}${summary.minimumHolderUsd ? ` (at least $${summary.minimumHolderUsd} worth)` : ''}, in proportion to how much they hold.`;
  const gap = summary.funding != null && summary.poolMinimum && Number(solUsd) > 0
    ? Math.max(0, summary.poolMinimum - summary.funding / 1e9 * solUsd) : null;
  const threshold = summary.poolMinimum ? ' Pool minimum $' + summary.poolMinimum + '.' : '';
  const gapText = gap == null ? 'Funding gap unavailable.' : 'Estimated gap to pool minimum: $' + gap.toFixed(2) + ' before distribution costs.';
  return `<header class="holder-rewards-head"><div><p class="eyebrow"><i class="holder-rewards-dot" aria-hidden="true"></i>Holder rewards · active</p><h2 id="holder-rewards-title">${symbol} holders earn ${escape(summary.share)}% of creator fees</h2></div><a class="text-button" href="#payments/history">Receipts →</a></header>
<div class="holder-rewards-grid">
<div class="holder-rewards-main"><span>Paid to holders</span><strong>${escape(formatProofSol(summary.paid))}</strong>${usd(summary.paid)}<small>${escape(`${summary.payouts?.toLocaleString('en-US') ?? 'Unverified'} payment${summary.payouts === 1 ? '' : 's'} to ${summary.wallets?.toLocaleString('en-US') ?? 'unverified'} wallet${summary.wallets === 1 ? '' : 's'}`)}</small></div>
<div><span>Allocated, unpaid</span><strong>${escape(formatProofSol(summary.waiting))}</strong>${usd(summary.waiting)}<small>Funding and eligibility checks apply</small></div>
<div><span>Last payout</span><strong>${escape(relativeTime(summary.lastPaidAt, now))}</strong><small>Paid ${escape(summary.cadence)}</small></div>
</div>
<p class="holder-rewards-rule">${escape(rule + threshold + " " + gapText)}</p>`;
}

export function holderTransfersMarkup(history, mint, checkedAt) {
  const paid = (Array.isArray(history) ? history : []).filter(row => row.mint === mint && row.kind === 'holder-paid' && row.feeSourceVerified === true
    && signature(row.signature) && address(row.wallet) && /^[1-9]\d*$/.test(row.amountLamports));
  const tx = (sig, label) => `<a href="https://explorer.solana.com/tx/${sig}?cluster=devnet" target="_blank" rel="noopener noreferrer">${label} ↗</a>`;
  const rows = paid.slice(0, 10).map(row => {
    const sources = [...new Set(Array.isArray(row.sourceSignatures) ? row.sourceSignatures : [])].filter(signature);
    const collections = sources.length ? `<details class="holder-transfer-sources"><summary>${sources.length} collection${sources.length === 1 ? '' : 's'}</summary><ul>${sources.map((sig,index) => `<li>${tx(sig,`Collection ${index + 1}`)}</li>`).join('')}</ul></details>` : '<span class="muted-note">Unavailable</span>';
    const wallet = `${row.wallet.slice(0,6)}…${row.wallet.slice(-6)}`;
    return `<tr><td data-label="Round cutoff (UTC)">${escape(utc(row.cutoffAt))}</td><td data-label="Recipient"><a class="holder-transfer-wallet" href="/wallet/${encodeURIComponent(row.wallet)}" title="${escape(row.wallet)}" aria-label="View wallet ${escape(row.wallet)}">${escape(wallet)}</a></td><td data-label="Amount" class="holder-transfer-amount">${escape(formatReviewSol(row.amountLamports))}</td><td data-label="Fee collections">${collections}</td><td data-label="Receipt"><div class="holder-transfer-links">${tx(row.signature,'Transaction')}<a href="${escape(receiptUrl(row.signature,mint,row.wallet))}">Payment details →</a></div></td></tr>`;
  });
  return `<section class="holder-transfers" aria-labelledby="holder-transfers-title"><header><h3 id="holder-transfers-title">Recent recipient transfers</h3><p>Records checked ${escape(utc(checkedAt))}</p></header>${rows.length ? `<table class="holder-transfer-table"><caption class="sr-only">Latest confirmed recipient transfers for this coin</caption><thead><tr><th scope="col">Round cutoff (UTC)</th><th scope="col">Recipient</th><th scope="col" class="holder-transfer-amount">Amount</th><th scope="col">Fee collections</th><th scope="col">Receipt</th></tr></thead><tbody>${rows.join('')}</tbody></table>` : '<p class="holder-transfers-empty">No recipient transfers in the available history.</p>'}</section>`;
}

export function mountHolderRewardsCard(app, document = globalThis.document, window = globalThis.window) {
  let serial = 0;
  const panel = () => {
    let node = document.querySelector('#holder-rewards-card');
    if (node) return node;
    const anchor = document.querySelector('#coin-page');
    if (!anchor) return null;
    node = document.createElement('section');
    node.id = 'holder-rewards-card';
    node.className = 'holder-rewards-card panel';
    node.setAttribute('aria-labelledby', 'holder-rewards-title');
    node.hidden = true;
    anchor.append(node);
    return node;
  };
  window.addEventListener('funded:coin-facts-loading', () => { serial++; const node = panel(); if (node) { node.hidden = true; node.replaceChildren(); } });
  const load = async mint => {
    const node = panel();
    if (!mint || !node) return;
    const request = ++serial;
    const result = await app.apiRequest(`/api/rewards/experience?mint=${encodeURIComponent(mint)}`).catch(() => null);
    if (request !== serial) return;
    const token = result?.available === true && result.data?.cluster === 'devnet' ? result.data?.tokens?.find(item => item.mint === mint) : null;
    const summary = holderRewardsSummary(token);
    node.innerHTML = holderRewardsMarkup(summary, { solUsd: app.coinSolUsdPrice });
    if (summary && result.data.cluster === 'devnet') {
      node.insertAdjacentHTML('beforeend', holderTransfersMarkup(result.data.events, mint, result.data.generatedAt));
      if (result.data.evidence?.status === 'partial') {
        node.querySelector('.holder-rewards-main').textContent = 'Holder payment history unavailable.';
        node.querySelector('.holder-rewards-grid').lastElementChild.textContent = 'Last payout unavailable.';
        node.querySelector('.holder-rewards-grid').children[1].textContent = 'Unpaid amount unavailable.';
      }
    }
    node.hidden = !summary;
  };
  window.addEventListener('funded:coin-facts', event => { if (!event.detail?.error) void load(event.detail?.mint); });
  // A direct coin URL can finish loading before this card mounts.
  if (document.querySelector('#coin-page:not([hidden])')) void load(app.getCoinMintAddress?.());
}
