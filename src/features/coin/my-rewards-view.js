import { escapeHtml } from '../shared/display.js';

// "My rewards" tab on the coin page: what the connected wallet received from
// this coin (SOL holder, X and creator payouts), plus shortcuts to this coin's
// $FUNDED airdrop allocation and the wallet's Daily bonus results.
const CACHE_MS = 60_000;
const cache = new Map();
const KIND_LABEL = { holder: 'Holder reward', x: 'X account reward', creator: 'Creator payout' };

const sol = lamports => {
  const n = Number(lamports) / 1e9;
  if (!Number.isFinite(n) || n <= 0) return '0 SOL';
  return `${n.toLocaleString('en-US', { maximumFractionDigits: n < 0.001 ? 9 : 6 })} SOL`;
};
const explorer = signature => `https://explorer.solana.com/tx/${encodeURIComponent(signature)}?cluster=devnet`;

function shortcuts(mint) {
  return `<div class="coin-my-rewards-links">
    <a class="coin-my-rewards-card" href="/?airdropMint=${encodeURIComponent(mint)}#airdrops"><strong>$FUNDED airdrop</strong><span>Check your allocation of this coin →</span></a>
    <a class="coin-my-rewards-card" href="#bonuses"><strong>Daily bonus</strong><span>See if your wallet won today →</span></a>
  </div>`;
}

export function coinMyRewardsMarkup(data, mint) {
  const row = (data?.wallet?.rows || []).find(item => item.mint === mint);
  const payouts = (row?.payouts || []).filter(p => /^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(String(p.signature || '')));
  const total = payouts.reduce((sum, p) => sum + (Number(p.amountLamports) || 0), 0);
  const list = payouts.length
    ? `<ul class="coin-my-rewards-list">${payouts.slice(0, 20).map(p => `<li><span>${escapeHtml(KIND_LABEL[p.kind] || 'Reward')}${p.paidAt ? ` · ${escapeHtml(new Date(p.paidAt).toISOString().slice(0, 16).replace('T', ' '))} UTC` : ''}</span><strong>${escapeHtml(sol(p.amountLamports))}</strong><a href="${explorer(p.signature)}" target="_blank" rel="noopener noreferrer">Receipt ↗</a></li>`).join('')}</ul>`
    : '<p class="coin-my-rewards-empty">No SOL rewards from this coin yet. Holder rewards are sent automatically after each funded cycle.</p>';
  return `<section class="coin-my-rewards" aria-label="Your rewards from this coin">
    <div class="coin-my-rewards-total"><span>SOL received from this coin</span><strong>${escapeHtml(sol(total))}</strong><small>${payouts.length} payment${payouts.length === 1 ? '' : 's'}</small></div>
    ${list}${shortcuts(mint)}</section>`;
}

export function renderCoinMyRewards(activity, { mint, wallet, apiRequest, isActive }) {
  if (!activity || !mint) return;
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
      if (!isActive()) return;
      if (!response?.available) throw new Error('unavailable');
      cache.set(key, { at: Date.now(), data: response.data });
      activity.innerHTML = coinMyRewardsMarkup(response.data, mint);
    })
    .catch(() => {
      if (!isActive()) return;
      activity.innerHTML = `<section class="coin-my-rewards"><div class="empty-state coin-activity-empty"><strong>Rewards are unavailable right now</strong><small>Try again in a moment.</small></div>${shortcuts(mint)}</section>`;
    });
}
