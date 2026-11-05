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
  const leaders = new Set(topCallers.map(row => row.author));
  return {
    latest: rows,
    top: rows.filter(row => leaders.has(row.author)),
    conviction: rows.filter(row => row.holdingPercent > 0),
  };
}

const hue = address => [...String(address)].reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) % 360, 7);
function formatHolding(percent) { return percent >= 1 ? `${percent.toFixed(1)}%` : percent >= 0.01 ? `${percent.toFixed(2)}%` : '<0.01%'; }

export function calloutRowMarkup(row, { solUsd, wallet, nowMs = Date.now(), fresh = false, callers = new Map() } = {}) {
  const symbol = row.token?.symbol || shortWallet(row.mint);
  const image = row.token?.image && /^https:\/\//.test(row.token.image)
    ? `<img src="${escape(row.token.image)}" alt="" width="20" height="20" loading="lazy" />`
    : `<span class="callout-token-initial" aria-hidden="true">${escape(symbol.slice(0, 1).toUpperCase())}</span>`;
  const you = wallet && row.author === wallet ? ' <em>you</em>' : '';
  const caller = callers.get(row.author);
  const record = caller ? `${caller.calls} call${caller.calls === 1 ? '' : 's'} · ${formatMultiple(caller.avgMultiple)} mean observed peak` : 'Wallet-verified caller';
  const conviction = row.holdingPercent > 0 ? `<span class="callout-conviction" title="Share of supply this wallet held when it made the call">Holds ${escape(formatHolding(row.holdingPercent))}</span>` : '';
  return `<li class="callout-card${row.holdingPercent > 0 ? ' is-conviction' : ''}${fresh ? ' is-new' : ''}" data-callout-id="${escape(row.id)}">
<header><span class="callout-avatar" style="--callout-hue:${hue(row.author)}" aria-hidden="true">${escape(String(row.author).slice(0, 2))}</span><span class="callout-who"><span><button type="button" class="callout-author" data-callout-author="${escape(row.author)}" title="Show only this wallet's calls">${escape(shortWallet(row.author))}</button>${you}</span><small>${escape(record)}</small></span>${conviction}<time datetime="${escape(row.createdAt)}">${escape(timeAgo(row.createdAt, nowMs))}</time></header>
<p class="callout-text">${escape(row.text)}</p>
<a class="callout-chip" href="#coin/${escape(row.mint)}" title="${escape(row.token?.name || 'Open coin')}">${image}<strong>$${escape(symbol)}</strong><b class="callout-multiple" data-trend="${multipleTrend(row.multiple)}" aria-label="Change since the call">${escape(formatMultiple(row.multiple))}</b><span aria-hidden="true">›</span></a>
<p class="callout-figures">Called at ${escape(formatCalloutCap(row.calledMarketCapSol, solUsd))} · now ${escape(formatCalloutCap(row.currentMarketCapSol, solUsd))} · observed peak ${escape(formatMultiple(row.peakMultiple))}</p><small class="callout-coverage">${row.currentMarketCapSol == null ? 'Current quote unavailable · ' : row.marketObservedAt ? `Market checked ${escape(timeAgo(row.marketObservedAt, nowMs))} · ` : 'Market check time unavailable · '}Called ${escape(new Date(row.createdAt).toLocaleString())} · <a href="/wallet/${escape(row.author)}">Caller profile</a></small>
</li>`;
}

export function topCallersMarkup(rows, wallet) {
  if (!rows?.length) return '<li class="callouts-leaders-empty">No ranked callers yet this week. Make the first call.</li>';
  // Servers mark callers below the minimum call count as unranked (ranked:false).
  let rank = 0;
  return rows.map(row => `<li${wallet && row.author === wallet ? ' class="is-you" aria-current="true"' : ''}><span class="callouts-rank"${row.ranked === false ? ' title="Needs 3 calls in 7 days to rank"' : ''}>${row.ranked === false ? '—' : `#${++rank}`}</span><span class="callout-avatar" style="--callout-hue:${hue(row.author)}" aria-hidden="true">${escape(String(row.author).slice(0, 2))}</span><button type="button" class="callout-author" data-callout-author="${escape(row.author)}">${escape(shortWallet(row.author))}</button><b data-trend="${multipleTrend(row.avgMultiple)}">${escape(formatMultiple(row.avgMultiple))} mean peak</b><small>${Number.isInteger(row.hits) ? row.hits : Math.round(row.hitRate * row.calls)} of ${row.calls} calls reached 2x${row.ranked === false ? ' · unranked until 3 calls' : row.calls < 5 ? ' · small sample' : ''}</small></li>`).join('');
}

const readSeen = () => { try { return localStorage.getItem(SEEN_KEY) || ''; } catch { return ''; } };
const writeSeen = value => { try { localStorage.setItem(SEEN_KEY, value); } catch {} };
const EMPTY = {
  latest: 'No calls yet. Open any coin, write in its chat and tick “Call it”.',
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
  const state = { filter: 'all', author: null, feed: null, known: new Set(), timer: null, loading: false };
  const active = () => document.body.classList.contains('page-route-callouts') && !document.hidden;

  function render() {
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
        ? items.map(row => calloutRowMarkup(row, { solUsd: app.coinSolUsdPrice, wallet, nowMs, callers, fresh: !firstPaint && !state.known.has(row.id) })).join('')
        : `<li class="callouts-empty-note">${state.filter === 'mine' && !wallet ? 'Connect a wallet to see your calls.' : state.author || state.filter !== 'all' ? 'No calls match this filter.' : EMPTY[name]}</li>`;
      for (const count of page.querySelectorAll(`[data-callouts-count="${name}"]`)) count.textContent = String(items.length);
    }
    for (const row of state.feed.callouts) state.known.add(row.id);
    leaders.innerHTML = topCallersMarkup(state.feed.topCallers, wallet);
    const authorChip = page.querySelector('#callouts-author-filter');
    authorChip.hidden = !state.author;
    authorChip.querySelector('span').textContent = state.author ? shortWallet(state.author) : '';
    status.textContent = `Live · updated ${new Date(nowMs).toLocaleTimeString()}`;
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
      if (response?.available && Array.isArray(response.data?.callouts)) { state.feed = response.data; if (active()) render(); }
      else if (active() && !state.feed) status.textContent = 'Callouts are unavailable right now.';
    } catch { if (active() && !state.feed) status.textContent = 'Callouts are unavailable right now.'; }
    finally { state.loading = false; updateUnseen(); }
  }

  function schedule() {
    clearTimeout(state.timer);
    state.timer = setTimeout(async () => { if (!document.hidden) await refresh(); schedule(); }, active() ? LIVE_MS : BACKGROUND_MS);
  }

  page.addEventListener('click', event => {
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
  void refresh();
  schedule();
}
