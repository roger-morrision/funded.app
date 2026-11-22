import { escapeHtml } from '../shared/display.js';

export function referrerMarkup(referrer, state = 'ready') {
  const messages = {
    disconnected: 'Connect your wallet to see who referred you.',
    checking: 'Checking your referral…',
    verification: 'Sign in with your wallet to see who referred you.',
    unavailable: 'Referral information is unavailable. Try refreshing shortly.',
  };
  if (messages[state]) return escapeHtml(messages[state]);
  if (referrer === null) return 'No referrer is recorded for this wallet.';
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(referrer?.wallet || '')) return escapeHtml(messages.unavailable);
  const wallet = referrer.wallet, short = `${wallet.slice(0, 4)}…${wallet.slice(-4)}`;
  const since = Date.parse(referrer.since);
  return `<a href="/wallet/${encodeURIComponent(wallet)}" title="${escapeHtml(wallet)}">${escapeHtml(short)}</a>${referrer.code ? ` · code <strong>${escapeHtml(referrer.code)}</strong>` : ''}${Number.isFinite(since) ? ` · since ${escapeHtml(new Date(since).toLocaleDateString())}` : ''}`;
}

export function renderReferrer(referrer, state, document = globalThis.document) {
  const node = document.querySelector('#referral-referrer');
  const value = document.querySelector('#referral-referrer-value');
  if (!node || !value) return;
  node.hidden = false;
  value.innerHTML = referrerMarkup(referrer, state);
}
