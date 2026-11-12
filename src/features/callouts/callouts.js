import {icon} from '../../../ui-icons.js';
import { tokenArtworkUrl } from '../shared/token-artwork.js';
import { callFigures, usdShort, signedUsd, multipleBadge, openCallShare } from './call-share.js';
import { solUsdPrice } from '../shared/token-identity.js';
// Callouts: chat posts that call a coin. The server records the market cap at
// the moment of the call, and whether the caller held the coin. This page shows
// every call live in three columns (latest, top callers, conviction) with how
// each has done since, and ranks callers over the last 7 days.
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const shortWallet = address => `${String(address).slice(0, 4)}…${String(address).slice(-4)}`;
const LIVE_MS = 5_000;
const BACKGROUND_MS = 30_000;
const SEEN_KEY = 'funded.callouts.seen';

function compact(value) {
  const abs = Math.abs(value);
  if (abs >= 1e9) return `${(value / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(value / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${(value / 1e3).toFixed(1)}K`;
  return abs >= 10 ? value.toFixed(0) : abs >= 1 ? value.toFixed(2) : value.toPrecision(2);
}

export function formatCalloutCap(capSol, solUsd) {
  if (!Number.isFinite(capSol) || capSol <= 0) return '—';
  return Number.isFinite(solUsd) && solUsd > 0 ? `$${compact(capSol * solUsd)}` : `${compact(capSol)} SOL`;
}

export function formatMultiple(multiple) {
  if (!Number.isFinite(multiple) || multiple <= 0) return '—';
  if (multiple < 1) return `${Math.round((multiple - 1) * 100)}%`;
  return `${multiple.toFixed(multiple >= 2 ? 1 : 2)}x`;
}

export function multipleTrend(multiple) {
  if (!Number.isFinite(multiple)) return 'flat';
  return multiple >= 1.05 ? 'up' : multiple <= 0.95 ? 'down' : 'flat';
}

export function timeAgo(iso, nowMs = Date.now()) {
  const seconds = Math.max(0, Math.round((nowMs - Date.parse(iso)) / 1000));
  if (!Number.isFinite(seconds)) return '';
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

// Badge on a chat message that was posted as a call.
export function chatCalloutBadge(callout, currentCapSol, solUsd) {
  if (!Number.isFinite(callout?.marketCapSol)) return '';
  const multiple = Number.isFinite(currentCapSol) && currentCapSol > 0 ? currentCapSol / callout.marketCapSol : null;
  const result = multiple ? ` · now <b class="callout-multiple" data-trend="${multipleTrend(multiple)}">${formatMultiple(multiple)}</b>` : '';
  const holds = callout.holdingPercent > 0 ? ` · holds ${formatHolding(callout.holdingPercent)}` : '';
  return `<span class="chat-callout-badge"><span aria-hidden="true">📣</span> Called at ${escape(formatCalloutCap(callout.marketCapSol, solUsd))}${result}${holds}</span>`;
}

// Hot: calls that have reached 2x at their peak. Mine: the connected wallet.
export function filterCallouts(callouts, { filter = 'all', wallet = null, author = null } = {}) {
  return callouts.filter(row => (filter !== 'hot' || row.peakMultiple >= 2)
    && (filter !== 'mine' || (wallet && row.author === wallet))
    && (!author || row.author === author));
}

// The three live columns: every call; calls from this week's top callers;
// and conviction calls, where the caller held the coin when they called it.
export function splitCalloutColumns(rows, topCallers = []) {
  const leaders = new Set(topCallers.filter(row => row.ranked !== false).map(row => row.author));
  return {
    latest: rows,
    top: rows.filter(row => leaders.has(row.author)),
    conviction: rows.filter(row => row.holdingPercent > 0),
  };
}

const hue = address => [...String(address)].reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) % 360, 7);
function formatHolding(percent) { return percent >= 1 ? `${percent.toFixed(1)}%` : percent >= 0.01 ? `${percent.toFixed(2)}%` : '<0.01%'; }

const shortAge = (iso, nowMs) => timeAgo(iso, nowMs).replace(/ ago$/, '');
// Call card: caller, change since the call, time; the call text; and a token row
// with market cap, the caller's holding value and its change since the call.
export function calloutRowMarkup(row, { solUsd, wallet, nowMs = Date.now(), fresh = false, callers = new Map() } = {}) {
  const symbol = row.token?.symbol || shortWallet(row.mint);
  const image = row.token?.image && /^https:\/\//.test(row.token.image)
    ? `<img src="${escape(tokenArtworkUrl(row.mint,row.token.image))}" alt="" width="20" height="20" loading="lazy" decoding="async" />`
    : `<img src="/api/tokens/${encodeURIComponent(row.mint)}/logo" alt="" width="20" height="20" loading="lazy" decoding="async" data-initial="${escape(symbol.replace(/^\$/, '').slice(0, 1).toUpperCase())}" />`;
  const you = wallet && row.author === wallet ? ' <em>you</em>' : '';
  const caller = callers.get(row.author);
  const record = caller ? `${caller.calls} call${caller.calls === 1 ? '' : 's'} · ${formatMultiple(caller.avgMultiple)} avg peak` : 'Wallet-verified caller';
  const f = callFigures({ calledCapSol: row.calledMarketCapSol, currentCapSol: row.currentMarketCapSol, holdingPercent: row.holdingPercent, solUsd });
  const trend = multipleTrend(f.multiple);
  const badge = multipleBadge(f.multiple);
  const holdChange = Number.isFinite(f.holdChangeUsd) ? `<span class="callout-pnl" data-trend="${f.holdChangeUsd >= 0 ? 'up' : 'down'}">${escape(signedUsd(f.holdChangeUsd))}</span>` : '';
  return `<li class="callout-card${row.holdingPercent > 0 ? ' is-conviction' : ''}${fresh ? ' is-new' : ''}" data-callout-id="${escape(row.id)}">
  <header class="callout-head-row"><span class="callout-avatar" style="--callout-hue:${hue(row.author)}" aria-hidden="true">${escape(String(row.author).slice(0, 2))}</span><span class="callout-who"><span class="callout-name"><a class="callout-author" href="/wallet/${encodeURIComponent(row.author)}">${escape(shortWallet(row.author))}</a>${you}${badge ? `<b class="callout-x" data-trend="${trend}" title="Market cap now vs. at the call">${escape(badge)}</b>` : ''}${row.holdingPercent > 0 ? '<span class="callout-holder" title="Held the coin when calling">Holder</span>' : ''}</span><small><button type="button" class="callout-filter-author" data-callout-author="${escape(row.author)}">${escape(record)}</button></small></span><time class="callout-age" datetime="${escape(row.createdAt)}">${escape(shortAge(row.createdAt, nowMs))}</time></header>
  <p class="callout-text">${escape(row.text)}</p>
  <div class="callout-foot"><a class="callout-token-row" href="/token/${encodeURIComponent(row.mint)}" title="${escape(row.token?.name || 'Open coin')}">${image}<strong>${escape(symbol.startsWith('$') ? symbol : `$${symbol}`)}</strong><span><i>MC</i> ${escape(usdShort(f.currentCapUsd ?? f.calledCapUsd))}</span>${Number.isFinite(f.holdUsd) ? `<span><i>Hold</i> ${escape(usdShort(f.holdUsd))}</span>` : ''}${holdChange}<span class="callout-chevron" aria-hidden="true">›</span></a>
  <div class="callout-actions"><button type="button" class="callout-like" data-like-call="${escape(row.id)}" data-mint="${escape(row.mint)}" data-liked="${wallet && Array.isArray(row.likedBy) && row.likedBy.includes(wallet) ? 'true' : 'false'}" aria-label="Like this call" title="Like">${icon('heart')}<span class="callout-like-count">${Number(row.likeCount) > 0 ? escape(String(row.likeCount)) : ''}</span></button><button type="button" class="callout-comment" data-comment-call="${escape(row.id)}" data-mint="${escape(row.mint)}" data-author="${escape(row.author)}" aria-label="Reply in this coin's chat" title="Reply in chat">${icon('chat')}</button><button type="button" class="callout-share" data-share-call="${escape(row.id)}" aria-label="Share this call">${icon('share')}</button></div></div>
  <p class="callout-figures">Called at ${escape(usdShort(f.calledCapUsd))} MC${Number.isFinite(f.changePercent) ? ` · ${f.changePercent >= 0 ? '+' : ''}${escape(f.changePercent.toFixed(1))}% since` : ''} · peak ${escape(formatMultiple(row.peakMultiple))}</p>
  </li>`;
}

export function topCallersMarkup(rows, wallet) {
  if (!rows?.length) return '<li class="callouts-leaders-empty">No ranked callers yet this week. Make the first call.</li>';
  // Servers mark callers below the minimum call count as unranked (ranked:false).
  let rank = 0;
  return rows.map(row => `<li${wallet && row.author === wallet ? ' class="is-you" aria-current="true"' : ''}><span class="callouts-rank"${row.ranked === false ? ' title="Needs 3 calls in 7 days to rank"' : ''}>${row.ranked === false ? '—' : `#${++rank}`}</span><span class="callout-avatar" style="--callout-hue:${hue(row.author)}" aria-hidden="true">${escape(String(row.author).slice(0, 2))}</span><a class="callout-author" href="/wallet/${encodeURIComponent(row.author)}" title="View wallet ${escape(row.author)}">${escape(shortWallet(row.author))}</a><button type="button" class="callout-copy" data-callout-author="${escape(row.author)}" aria-label="Filter calls by this wallet" title="Show only this wallet's calls">⌕</button><b data-trend="${multipleTrend(row.avgMultiple)}">${escape(formatMultiple(row.avgMultiple))} mean peak</b><small>${Number.isInteger(row.hits) ? row.hits : Math.round(row.hitRate * row.calls)} of ${row.calls} calls reached 2x${row.ranked === false ? ' · unranked until 3 calls' : row.calls < 5 ? ' · small sample' : ''}</small></li>`).join('');
}

const readSeen = () => { try { return localStorage.getItem(SEEN_KEY) || ''; } catch { return ''; } };
const writeSeen = value => { try { localStorage.setItem(SEEN_KEY, value); } catch {} };
const EMPTY = {
  latest: 'No calls yet. Post in a coin’s chat while holding its tokens to make a call.',
  top: 'No calls from this week’s top callers yet.',
  conviction: 'No conviction calls yet. These come from wallets that held the coin when they called it.',
};

export function mountCallouts(app, document = globalThis.document) {
  const page = document?.querySelector('#callouts');
  if (!page || page.dataset.mounted) return;
  page.dataset.mounted = 'true';
  const columns = Object.fromEntries(['latest', 'top', 'conviction'].map(name => [name, page.querySelector(`[data-callouts-list="${name}"]`)]));
  const leaders = page.querySelector('#callouts-top');
  const status = page.querySelector('#callouts-status');
  const navBadge = document.querySelector('[data-callouts-unseen]');
  const state = { filter: 'all', author: null, feed: null, known: new Set(), timer: null, loading: false, unavailable: false };
  const active = () => document.body.classList.contains('page-route-callouts') && !document.hidden;

  function updateFeedStatus() {
    page.classList.toggle('callouts-unavailable', state.unavailable && !state.feed);
    if (state.unavailable) {
      status.textContent = state.feed ? 'Refresh unavailable. Showing the last loaded calls.' : 'Calls are unavailable. Retrying automatically.';
    } else if (state.feed) {
      const checked = Date.parse(state.feed.serverTime);
      status.textContent = Number.isFinite(checked) ? `Updated ${new Date(checked).toLocaleTimeString()}` : 'Calls loaded';
    }
  }

  function render() {
    updateFeedStatus();
    if (!state.feed) return;
    const wallet = app.connectedWalletAddress || null;
    const assets = Array.isArray(app.assets) ? app.assets : [];
    const rows = filterCallouts(state.feed.callouts, { filter: state.filter, wallet, author: state.author }).map(row => {
      if (row.token?.symbol) return row;
      const asset = assets.find(item => item.address === row.mint);
      return asset ? { ...row, token: { symbol: asset.symbol, name: asset.name, image: asset.icon } } : row;
    });
    const nowMs = Date.parse(state.feed.serverTime) || Date.now();
    const firstPaint = !state.known.size;
    const callers = new Map(state.feed.topCallers.map(row => [row.author, row]));
    const split = splitCalloutColumns(rows, state.feed.topCallers);
    for (const [name, list] of Object.entries(columns)) {
      const items = split[name];
      list.innerHTML = items.length
        ? items.map(row => calloutRowMarkup(row, { solUsd: app.coinSolUsdPrice || solUsdPrice(), wallet, nowMs, callers, fresh: !firstPaint && !state.known.has(row.id) })).join('')
        : `<li class="callouts-empty-note">${state.filter === 'mine' && !wallet ? 'Connect a wallet to see your calls.' : state.author || state.filter !== 'all' ? 'No calls match this filter.' : EMPTY[name]}</li>`;
      for (const count of page.querySelectorAll(`[data-callouts-count="${name}"]`)) count.textContent = String(items.length);
    }
    for (const row of state.feed.callouts) state.known.add(row.id);
    leaders.innerHTML = topCallersMarkup(state.feed.topCallers, wallet);
    const authorChip = page.querySelector('#callouts-author-filter');
    authorChip.hidden = !state.author;
    authorChip.querySelector('span').textContent = state.author ? shortWallet(state.author) : '';
  }

  function updateUnseen() {
    const newest = state.feed?.callouts?.[0]?.createdAt || '';
    if (active()) { if (newest) writeSeen(newest); if (navBadge) navBadge.hidden = true; return; }
    const seen = readSeen();
    const unseen = state.feed?.callouts?.filter(row => row.createdAt > seen).length || 0;
    if (navBadge) { navBadge.hidden = !seen || !unseen; navBadge.textContent = unseen > 9 ? '9+' : String(unseen); }
    if (!seen && newest) writeSeen(newest);
  }

  async function refresh() {
    if (state.loading) return;
    state.loading = true;
    try {
      const response = await app.apiRequest('/api/callouts');
      if (!response?.available || !Array.isArray(response.data?.callouts) || !Array.isArray(response.data.topCallers)) {
        throw new Error('Incomplete call feed');
      }
      state.feed = response.data;
      state.unavailable = false;
      if (active()) render();
    } catch {
      state.unavailable = true;
      if (active()) updateFeedStatus();
    }
    finally { state.loading = false; updateUnseen(); }
  }

  function schedule() {
    clearTimeout(state.timer);
    state.timer = setTimeout(async () => { if (!document.hidden) await refresh(); schedule(); }, active() ? LIVE_MS : BACKGROUND_MS);
  }

  page.addEventListener('click', async event => {
    // Like toggles with the signed-in wallet; comment replies in the coin's chat.
    const like = event.target.closest('[data-like-call]');
    if (like) {
      like.disabled = true;
      try {
        const result = await app.tokenChatRequest('like', { messageId: like.dataset.likeCall }, like.dataset.mint);
        if (result?.available) {
          like.dataset.liked = String(result.data.liked === true);
          like.querySelector('.callout-like-count').textContent = result.data.likeCount > 0 ? String(result.data.likeCount) : '';
          const row = state.feed?.callouts?.find(item => item.id === like.dataset.likeCall);
          if (row) { row.likeCount = result.data.likeCount; const by = new Set(row.likedBy || []); const me = app.connectedWalletAddress; if (me) { if (result.data.liked) by.add(me); else by.delete(me); } row.likedBy = [...by]; }
        }
      } catch (error) { app.showToast?.(error?.message || 'Could not like this call.'); }
      finally { like.disabled = false; }
      return;
    }
    const comment = event.target.closest('[data-comment-call]');
    if (comment) {
      const author = String(comment.dataset.author || '');
      try { sessionStorage.setItem('funded.postBuyCall.text', `@${author.slice(0, 4)}…${author.slice(-4)} `); } catch {}
      location.assign(`/token/${encodeURIComponent(comment.dataset.mint)}?compose=callout`);
      return;
    }
    const shareCall = event.target.closest('[data-share-call]');
    if (shareCall) {
      const call = state.feed?.callouts?.find(row => row.id === shareCall.dataset.shareCall);
      if (call) void openCallShare({ call, solUsd: app.coinSolUsdPrice || solUsdPrice(), wallet: app.connectedWalletAddress || null, referralCode: app.registeredShareCode?.() || '' });
      return;
    }
    const copy = event.target.closest('[data-copy-caller]');
    if (copy) {
      const address = copy.dataset.copyCaller;
      if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address || '')) return;
      try { await navigator.clipboard.writeText(address); app.showToast('Caller wallet address copied.'); }
      catch { app.showToast('Could not copy the wallet address. Please try again.'); }
      return;
    }
    const filter = event.target.closest('[data-callouts-filter]');
    if (filter) {
      state.filter = filter.dataset.calloutsFilter;
      for (const button of page.querySelectorAll('[data-callouts-filter]')) button.setAttribute('aria-pressed', String(button === filter));
      render();
    }
    // On narrow screens one column shows at a time; these tabs pick it.
    const tab = event.target.closest('[data-callouts-tab]');
    if (tab) {
      page.dataset.column = tab.dataset.calloutsTab;
      for (const button of page.querySelectorAll('[data-callouts-tab]')) button.setAttribute('aria-pressed', String(button === tab));
    }
    const author = event.target.closest('[data-callout-author]');
    if (author) { state.author = author.dataset.calloutAuthor; render(); }
    if (event.target.closest('#callouts-author-filter')) { state.author = null; render(); }
  });
  const onRoute = () => { if (active()) { render(); void refresh(); } schedule(); };
  window.addEventListener('hashchange', () => setTimeout(onRoute, 0));
  document.addEventListener('visibilitychange', onRoute);
  window.addEventListener('funded:reward-identity-change', render);
  window.addEventListener('funded:token-identities', () => { if (active()) render(); });
  // Token logos that fail to load fall back to the symbol's first letter.
  page.addEventListener('error', event => {
    const image = event.target;
    if (image?.tagName !== 'IMG' || !image.dataset.initial) return;
    image.replaceWith(Object.assign(document.createElement('span'), { className: 'callout-token-initial', textContent: image.dataset.initial }));
  }, true);
  void refresh();
  schedule();
}
