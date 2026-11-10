import { escapeHtml } from '../shared/display.js';

// "My rewards" tab on the coin page: what the connected wallet received from
// this coin (SOL holder, X and creator payouts), plus shortcuts to this coin's
// $RICH airdrop allocation and the wallet's Daily bonus results.
const CACHE_MS = 60_000;
const cache = new Map();
const requests = new WeakMap();
const KIND_LABEL = { holder: 'Coin holder', x: 'X account reward', creator: 'Creator payout' };

const sol = lamports => {
  const n = Number(lamports) / 1e9;
  if (!Number.isFinite(n) || n <= 0) return '0 SOL';
  return `${n.toLocaleString('en-US', { maximumFractionDigits: n < 0.001 ? 9 : 6 })} SOL`;
};
const explorer = signature => `https://explorer.solana.com/tx/${encodeURIComponent(signature)}?cluster=devnet`;

function shortcuts(mint) {
  return `<div class="coin-my-rewards-links">
    <a class="coin-my-rewards-card" href="/?airdropMint=${encodeURIComponent(mint)}#airdrops"><strong>$RICH airdrop</strong><span>Check your allocation of this coin →</span></a>
    <a class="coin-my-rewards-card" href="#bonuses"><strong>Daily bonus</strong><span>See if your wallet won today →</span></a>
  </div>`;
}

export function coinMyRewardsMarkup(data, mint) {
  const row = (data?.wallet?.rows || []).find(item => item.mint === mint);
  const payouts = (row?.payouts || []).filter(p => /^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(String(p.signature || '')));
  const total = payouts.reduce((sum, p) => sum + (Number(p.amountLamports) || 0), 0);
  const list = payouts.length
    ? `<div class="coin-rewards-table-wrap" role="region" aria-label="Payment history" tabindex="0"><table class="coin-rewards-table"><caption>Recent payments · showing ${Math.min(20,payouts.length)} of ${payouts.length}</caption><thead><tr><th scope="col">Reward</th><th scope="col">Date (UTC)</th><th scope="col">Received</th><th scope="col">Receipt</th></tr></thead><tbody>${payouts.slice(0, 20).map(p => `<tr><td>${escapeHtml(KIND_LABEL[p.kind] || 'Reward')}</td><td>${Number.isFinite(Date.parse(p.paidAt)) ? escapeHtml(new Date(p.paidAt).toISOString().slice(0, 16).replace('T', ' ')) : '—'}</td><td>${escapeHtml(sol(p.amountLamports))}</td><td><a href="${explorer(p.signature)}" target="_blank" rel="noopener noreferrer" aria-label="View ${escapeHtml(KIND_LABEL[p.kind] || 'reward')} transaction">View ↗</a></td></tr>`).join('')}</tbody></table></div>`
    : '<div class="coin-my-rewards-empty"><strong>No payments yet</strong><p>No SOL rewards from this coin have been recorded for your wallet. Eligible holder payments arrive automatically after funding and cycle checks.</p></div>';
  return `<section class="coin-my-rewards" aria-label="Your rewards from this coin">
    <header><h3>Your rewards</h3><p>Payments from this coin to your connected wallet.</p></header>
    <dl class="coin-my-rewards-stats"><div><dt>SOL received</dt><dd>${escapeHtml(sol(total))}</dd></div><div><dt>Payments</dt><dd>${payouts.length}</dd></div><div><dt>Holder payments</dt><dd class="coin-rewards-method">Automatic</dd></div></dl>
    ${list}${shortcuts(mint)}</section>`;
}

export function renderCoinMyRewards(activity, { mint, wallet, apiRequest, isActive }) {
  if (!activity || !mint) return;
  const request = {};
  requests.set(activity, request);
  const current = () => requests.get(activity) === request && isActive();
  if (!wallet) {
    activity.innerHTML = `<section class="coin-my-rewards"><div class="empty-state coin-activity-empty"><strong>Connect a wallet to see your rewards</strong><small>SOL rewards from this coin, your airdrop allocation and Daily bonus results.</small><button type="button" class="primary-button" data-my-rewards-connect>Connect wallet</button></div>${shortcuts(mint)}</section>`;
    activity.querySelector('[data-my-rewards-connect]')?.addEventListener('click', () => document.querySelector('#connect-button')?.click());
    return;
  }
  const key = `${wallet}:${mint}`, hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) { activity.innerHTML = coinMyRewardsMarkup(hit.data, mint); return; }
  activity.innerHTML = '<div class="empty-state coin-activity-empty"><strong>Loading your rewards…</strong><small>Reading confirmed payouts for this wallet.</small></div>';
  apiRequest(`/api/rewards/experience?wallet=${encodeURIComponent(wallet)}&mint=${encodeURIComponent(mint)}`, { signal: AbortSignal.timeout(15_000) })
    .then(response => {
      if (!current()) return;
      if (!response?.available) throw new Error('unavailable');
      cache.set(key, { at: Date.now(), data: response.data });
      activity.innerHTML = coinMyRewardsMarkup(response.data, mint);
    })
    .catch(() => {
      if (!current()) return;
      activity.innerHTML = `<section class="coin-my-rewards"><div class="empty-state coin-activity-empty"><strong>Rewards are unavailable right now</strong><small>Try again in a moment.</small></div>${shortcuts(mint)}</section>`;
    });
}
