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
      const history = Array.isArray(result.data.events) ? result.data.events : [];
      const paid = history.filter(row => row.mint === mint && row.kind === 'holder-paid' && row.feeSourceVerified === true
        && signature(row.signature) && address(row.wallet) && /^[1-9]\d*$/.test(row.amountLamports));
      const rows = paid.slice(0, 10).map(row => {
        const tx = (sig, label) => `<a href="https://explorer.solana.com/tx/${sig}?cluster=devnet" target="_blank" rel="noopener noreferrer">${label} ↗</a>`;
        const sources = [...new Set(row.sourceSignatures || [])].filter(signature).map(sig => tx(sig, 'Fee collection'));
        return `<li>Round cutoff: ${escape(utc(row.cutoffAt))} · ${escape(formatReviewSol(row.amountLamports))} to <code>${escape(row.wallet)}</code> · ${sources.join(' · ')} · ${tx(row.signature,'Recipient transfer')} · <a href="${escape(receiptUrl(row.signature,mint,row.wallet))}">Inspect payment record</a></li>`;
      });
      node.insertAdjacentHTML('beforeend', `<details><summary>Recent recipient transfers for this mint</summary><p>Records checked ${escape(utc(result.data.generatedAt))}</p>${rows.length ? '<ul>' + rows.join('') + '</ul>' : 'No recipient transfers in the available history.'}</details>`);
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
