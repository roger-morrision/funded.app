// Coin page "Holder rewards" card: how much this coin has paid its holders,
// what is waiting in the pot for the next payout, and how often it pays.
// Reads /api/rewards/experience?mint=… once per coin; hidden for coins that
// do not share creator fees with holders.
import { formatProofSol, formatProofUsd } from '../proof/proof-totals.js';

const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const lamports = value => { const number = Number(value); return Number.isFinite(number) && number >= 0 ? number : 0; };
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
    waiting: Math.max(0, allocated - paid),
    wallets: lamports(token.holderPaidWallets),
    payouts: lamports(token.holderPayoutCount),
    lastPaidAt: token.lastHolderPayout ? Date.parse(token.lastHolderPayout) : null,
    cadence: CADENCE[policy.cadence] || (Number(policy.periodSeconds) > 0 ? `every ${Math.round(policy.periodSeconds / 60)} minutes` : 'after each fee cycle'),
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
  const rule = `Paid in SOL ${summary.cadence} to everyone holding ${symbol}${summary.minimumHolderUsd ? ` (at least $${summary.minimumHolderUsd} worth)` : ''}, in proportion to how much they hold.`;
  return `<header class="holder-rewards-head"><div><p class="eyebrow"><i class="holder-rewards-dot" aria-hidden="true"></i>Holder rewards · active</p><h2 id="holder-rewards-title">${symbol} holders earn ${escape(summary.share)}% of creator fees</h2></div><a class="text-button" href="#payments/history">Receipts →</a></header>
<div class="holder-rewards-grid">
<div class="holder-rewards-main"><span>Paid to holders</span><strong>${escape(formatProofSol(summary.paid))}</strong>${usd(summary.paid)}<small>${escape(`${summary.payouts.toLocaleString('en-US')} payments to ${summary.wallets.toLocaleString('en-US')} wallets`)}</small></div>
<div><span>Waiting in pot</span><strong>${escape(formatProofSol(summary.waiting))}</strong>${usd(summary.waiting)}<small>Goes out in the next payout</small></div>
<div><span>Last payout</span><strong>${escape(relativeTime(summary.lastPaidAt, now))}</strong><small>Paid ${escape(summary.cadence)}</small></div>
</div>
<p class="holder-rewards-rule">${escape(rule)}</p>`;
}

export function mountHolderRewardsCard(app, document = globalThis.document, window = globalThis.window) {
  let serial = 0;
  const panel = () => {
    let node = document.querySelector('#holder-rewards-card');
    if (node) return node;
    const anchor = document.querySelector('#coin-page .coin-stat-strip');
    if (!anchor) return null;
    node = document.createElement('section');
    node.id = 'holder-rewards-card';
    node.className = 'holder-rewards-card panel';
    node.setAttribute('aria-labelledby', 'holder-rewards-title');
    node.hidden = true;
    anchor.after(node);
    return node;
  };
  window.addEventListener('funded:coin-facts-loading', () => { serial++; const node = panel(); if (node) { node.hidden = true; node.replaceChildren(); } });
  const load = async mint => {
    const node = panel();
    if (!mint || !node) return;
    const request = ++serial;
    const result = await app.apiRequest(`/api/rewards/experience?mint=${encodeURIComponent(mint)}`).catch(() => null);
    if (request !== serial) return;
    const token = result?.available === true ? result.data?.tokens?.find(item => item.mint === mint) : null;
    const summary = holderRewardsSummary(token);
    node.innerHTML = holderRewardsMarkup(summary, { solUsd: app.coinSolUsdPrice });
    node.hidden = !summary;
  };
  window.addEventListener('funded:coin-facts', event => { if (!event.detail?.error) void load(event.detail?.mint); });
  // A direct coin URL can finish loading before this card mounts.
  if (document.querySelector('#coin-page:not([hidden])')) void load(app.getCoinMintAddress?.());
}
