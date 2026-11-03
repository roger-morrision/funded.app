import { apiRequest } from '../../../client.js';

// Home proof strip: recent confirmed payouts, newest first, each linked to its
// Solana transaction. Hidden until there is at least one payout to show.
const SOURCES = {
  'automatic-holder': 'Holder reward',
  'daily-bonus': 'Daily bonus',
  'solana-keeper-referral-claim': 'Referral reward',
  'creator-fee-claim': 'Creator fees',
  'x-fee-claim': 'X partner reward',
};
const sourceLabel = source => SOURCES[source] || (/creator/i.test(source) ? 'Creator fees' : /referr/i.test(source) ? 'Referral reward' : /bonus/i.test(source) ? 'Daily bonus' : 'Reward');
const shortWallet = address => `${String(address).slice(0, 4)}…${String(address).slice(-4)}`;

export function formatPayoutSol(lamports) {
  const sol = Number(lamports) / 1_000_000_000;
  if (!Number.isFinite(sol) || sol <= 0) return '';
  // Small payouts keep two significant digits (0.000042 SOL) so the strip
  // shows what was actually paid instead of a row of identical "<0.0001".
  if (sol < 0.0001) return `${sol.toLocaleString('en-US', { maximumSignificantDigits: 2, maximumFractionDigits: 9 })} SOL`;
  return `${sol.toLocaleString('en-US', { maximumFractionDigits: sol < 1 ? 4 : 2 })} SOL`;
}

function age(blockTime, now = Date.now()) {
  const seconds = Math.max(0, Math.round(now / 1000 - Number(blockTime)));
  if (!Number.isFinite(seconds)) return '';
  if (seconds < 3600) return `${Math.max(1, Math.round(seconds / 60))}m ago`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h ago`;
  return `${Math.round(seconds / 86400)}d ago`;
}

export async function mountPayoutFeed({ document = globalThis.document, request = apiRequest } = {}) {
  const host = document?.querySelector('.hero-section .hero-copy-column');
  if (!host || host.querySelector('.home-payout-feed')) return null;
  // A cold server builds this list from on-chain receipts (about 15s); once
  // cached it answers immediately, so wait longer and retry once.
  let data;
  for (let attempt = 0; attempt < 2 && !data; attempt++) {
    try { data = (await request('/api/evidence/payment-history?limit=24', { signal: AbortSignal.timeout(25_000) })).data; }
    catch { if (attempt === 0) await new Promise(resolve => setTimeout(resolve, 5_000)); }
  }
  if (!data || host.querySelector('.home-payout-feed')) return null;
  const payouts = (Array.isArray(data?.verifiedPayouts) ? data.verifiedPayouts : [])
    .filter(row => /^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(String(row?.signature || '')) && formatPayoutSol(row.amountLamports))
    .sort((a, b) => Number(b.blockTime) - Number(a.blockTime)).slice(0, 12);
  if (!payouts.length) return null;
  const cluster = data.cluster === 'devnet' ? '?cluster=devnet' : '';
  const feed = document.createElement('div');
  feed.className = 'home-payout-feed';
  feed.setAttribute('aria-label', 'Recent payouts');
  const label = document.createElement('span');
  label.className = 'home-payout-label';
  const count = Number(data.payoutCoverage?.verified) || payouts.length;
  const total = formatPayoutSol(data.payoutCoverage?.verifiedTotalLamports);
  label.textContent = total ? `${count} payouts · ${total} paid` : `${count} payouts`;
  const windowEl = document.createElement('div');
  windowEl.className = 'home-payout-window';
  const track = document.createElement('div');
  track.className = 'home-payout-track';
  const item = (row, hidden) => {
    const link = document.createElement('a');
    link.href = `https://explorer.solana.com/tx/${encodeURIComponent(row.signature)}${cluster}`;
    link.target = '_blank'; link.rel = 'noopener noreferrer';
    if (hidden) { link.setAttribute('aria-hidden', 'true'); link.tabIndex = -1; }
    const amount = document.createElement('b'); amount.textContent = formatPayoutSol(row.amountLamports);
    link.append(amount, ` ${sourceLabel(row.source)} → ${shortWallet(row.to)} · ${age(row.blockTime)}`);
    return link;
  };
  payouts.forEach(row => track.append(item(row, false)));
  // A second, hidden copy keeps the scroll seamless.
  payouts.forEach(row => track.append(item(row, true)));
  windowEl.append(track);
  feed.append(label, windowEl);
  host.append(feed);
  return feed;
}

if (typeof document !== 'undefined' && !navigator.webdriver) {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => { void mountPayoutFeed(); }, { once: true });
  else void mountPayoutFeed();
}
