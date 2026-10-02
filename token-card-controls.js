import { icon } from './ui-icons.js';

const WATCHLIST_KEY = 'funded.app.community.watchlist';

export function createTokenCardActions({ mint, symbol = 'TOKEN', name = '', className = '' }) {
  const actions = document.createElement('div');
  actions.className = `token-card-actions ${className}`.trim();
  let saved = false;
  try { saved = JSON.parse(localStorage.getItem(WATCHLIST_KEY) || '[]').includes(mint); } catch {}

  const watch = document.createElement('button');
  watch.type = 'button';
  watch.className = `watch-button token-card-action-watch${saved ? ' active' : ''}`;
  watch.dataset.mint = mint;
  watch.setAttribute('aria-pressed', String(saved));
  watch.setAttribute('aria-label', saved ? 'Remove token from watchlist' : `Save ${symbol} to watchlist`);
  watch.title = saved ? 'Remove from watchlist' : 'Save to watchlist';
  watch.innerHTML = icon(saved ? 'starFilled' : 'star');

  const share = document.createElement('button');
  share.type = 'button';
  share.className = 'share-asset token-card-action-share';
  share.dataset.shareMint = mint;
  share.dataset.shareSymbol = symbol;
  share.dataset.shareName = name;
  share.textContent = 'Share';
  actions.append(watch, share);
  return actions;
}
