import { followingTokenSources } from '../../../following-token-model.js';
import { isWatchlistRetryPending } from '../../features/portfolio/watchlist-retry-state.js';

// Dependencies and mutable application state are read live through appState.
export function createFollowingController(appState) {
  const holdingsByWallet = new Map();
  let holdingsScan = null;
  let scanAgain = false;
  let scanRevision = 0;
  const CACHE_MS = 60_000;
  const withTimeout = (promise, milliseconds) => {
    let timer;
    return Promise.race([promise, new Promise(resolve => { timer = setTimeout(() => resolve([]), milliseconds); })])
      .finally(() => clearTimeout(timer));
  };

  function getFollowingTokenSources(){
    return followingTokenSources(appState.assets, appState.getFollowedWallets(), holdingsByWallet);
  }
  function getFollowingCoverage(){
    const rows = appState.getFollowedWallets();
    const checked = rows.filter(row => holdingsByWallet.get(row.address)?.status === 'ready').length;
    const partial = rows.filter(row => holdingsByWallet.get(row.address)?.status === 'partial').length;
    const unavailable = rows.filter(row => holdingsByWallet.get(row.address)?.status === 'unavailable').length;
    return { total:rows.length, checked, partial, unavailable, refreshing:Boolean(holdingsScan) };
  }
  function refreshFollowedWalletHoldings(){
    const rows = appState.getFollowedWallets();
    if (holdingsScan) { scanAgain = true; return holdingsScan; }
    const now = Date.now();
    const targets = rows.filter(row => now - (holdingsByWallet.get(row.address)?.checkedAt || 0) >= CACHE_MS);
    if (!targets.length) return Promise.resolve();
    const revision = ++scanRevision;
    holdingsScan = (async () => {
      try {
        const [{ PublicKey, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID }, rpc] = await Promise.all([
          appState.getSolana(), appState.getExploreConnection(),
        ]);
        for (let offset = 0; offset < targets.length; offset += 3) {
          const batch = await Promise.all(targets.slice(offset, offset + 3).map(async row => {
            const wallet = row.address;
            const owner = new PublicKey(wallet);
            const reads = Promise.allSettled([
              rpc.getParsedTokenAccountsByOwner(owner, { programId:TOKEN_PROGRAM_ID }, 'confirmed'),
              rpc.getParsedTokenAccountsByOwner(owner, { programId:TOKEN_2022_PROGRAM_ID }, 'confirmed'),
            ]);
            const results = await withTimeout(reads, 15_000);
            if (revision !== scanRevision) return;
            const success = results.filter(result => result.status === 'fulfilled');
            const mints = new Set(success.flatMap(result => result.value?.value || []).flatMap(account => {
              const info = account?.account?.data?.parsed?.info;
              return info?.owner === wallet && /^[1-9]\d*$/.test(String(info.tokenAmount?.amount || ''))
                && appState.validateSolanaMint(info.mint).valid ? [info.mint] : [];
            }));
            const status = success.length === 2 ? 'ready' : success.length ? 'partial' : 'unavailable';
            holdingsByWallet.set(wallet, { mints, status, checkedAt:Date.now() });
            return status;
          }));
          if (revision !== scanRevision) return;
          if (appState.exploreTab === 'following' && (offset % 9 === 0 || offset + 3 >= targets.length)) appState.updateExploreViews(true);
          if (batch.every(status => status === 'unavailable')) break;
        }
      } catch {
        for (const row of targets) if ((holdingsByWallet.get(row.address)?.checkedAt || 0) < now)
          holdingsByWallet.set(row.address, { mints:new Set(), status:'unavailable', checkedAt:Date.now() });
      } finally {
        if (revision === scanRevision) {
          holdingsScan = null;
          if (appState.exploreTab === 'following') appState.updateExploreViews(true);
          if (scanAgain) { scanAgain = false; void refreshFollowedWalletHoldings(); }
        }
      }
    })();
    return holdingsScan;
  }
  // app-source: 393
  function showWatchlistStatus(message){
    appState.watchlistNotice = message;
    for (const host of [document.querySelector('#watchlist-items')?.parentElement, document.querySelector('#coin-watch')?.closest('.coin-identity')]) {
      if (!host) continue;
      let status = host.querySelector('[data-watchlist-status]');
      if (!status) { status = document.createElement('p'); status.className = 'field-help'; status.dataset.watchlistStatus = ''; status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite'); host.append(status); }
      const quietTokenStatus = host.closest('.coin-identity') && (
        message === 'Favorites synced to your account.'
        || (appState.watchlistSync.identity() === null && !appState.watchlistUnavailable));
      const visibleMessage = quietTokenStatus ? '' : message;
      if (status.textContent !== visibleMessage) status.textContent = visibleMessage;
      status.hidden = !visibleMessage;
    }
  }
  // app-source-end

  // app-source: 394
  function getWatchlist(){
    appState.lastKnownWatchlist = appState.watchlistSync.get();
    return [...appState.lastKnownWatchlist];
  }
  async function restoreWalletFavorites({ force = false } = {}){
    const session = appState.captureWalletSession();
    if (!session) return false;
    try {
      const response = await appState.apiRequest('/api/referrals/session');
      if (!appState.isWalletSessionCurrent(session) || response.data?.wallet !== session.address || !response.data.authenticated) return false;
      const current = appState.watchlistSync.identity();
      if (!force && current && !current.startsWith('wallet:')) return false;
      return appState.watchlistSync.setIdentity(`wallet:${session.address}`);
    } catch { return false; }
  }
  async function verifyWalletFavorites(){
    if (!appState.captureWalletSession()) await appState.connectWallet();
    const session = appState.captureWalletSession();
    if (!session) return false;
    try {
      await appState.ensureReferralSession(session, { interactive: true });
      appState.assertWalletSessionCurrent(session);
      return appState.watchlistSync.setIdentity(`wallet:${session.address}`);
    } catch (error) {
      appState.showWatchlistStatus(error.message || 'Wallet verification failed. Try again.');
      return false;
    }
  }
  // app-source-end

  // app-source: 395
  async function saveWatchlist(mint, { remove = false } = {}){
    const saved = await appState.watchlistSync.save(mint, remove);
    if (saved && !remove) window.dispatchEvent(new Event('funded:watchlist-added'));
    if (!saved) {
      const message = appState.watchlistUnavailable && appState.watchlistNotice
        ? appState.watchlistNotice : 'Favorites could not be saved. Check sign-in and retry.';
      appState.showWatchlistStatus(message);
      appState.showToast('Favorites could not be saved. Check sign-in and retry.');
    } else appState.showWatchlistStatus('');
    return saved;
  }
  // app-source-end

  // app-source: 396
  function setWatchButtonState(button, active){
    if (!button) return;
    button.classList.toggle('active', active);
    button.innerHTML = appState.icon(active ? 'starFilled' : 'star');
    button.setAttribute('aria-pressed', String(active));
    button.setAttribute('aria-label', active ? 'Remove token from favorites' : 'Add token to favorites');
    button.setAttribute('title', active ? 'Remove from favorites' : 'Add to favorites');
  }
  // app-source-end

  let watchlistRowsState;
  const watchlistRowProvenance = new WeakMap();
  const watchlistLocation = () => `${location.pathname}${location.search}${location.hash}`;
  function watchlistScene(items) {
    const sync = appState.watchlistSync, owner = sync.identity(), root = document.querySelector('#community');
    return { items, root, sync, owner, location:watchlistLocation() };
  }
  function currentWatchlistScene(scene) {
    return scene && (scene.owner === null || typeof scene.owner === 'string'
      && /^(?:\d{1,24}|wallet:[1-9A-HJ-NP-Za-km-z]{32,44})$/.test(scene.owner)) && scene.sync === appState.watchlistSync
      && scene.owner === scene.sync.identity() && scene.location === watchlistLocation() && location.hash === '#community'
      && scene.root === document.querySelector('#community') && scene.items === document.querySelector('#watchlist-items')
      && scene.root?.isConnected && scene.items?.isConnected && !scene.root.hidden
      && scene.root.getClientRects().length > 0 && getComputedStyle(scene.root).visibility === 'visible';
  }
  const sameWatchlistScene = (a, b) => a && b && a.items === b.items && a.root === b.root
    && a.sync === b.sync && a.owner === b.owner && a.location === b.location;
  function validWatchlistModelKey(key) {
    if (typeof key !== 'string') return false;
    try {
      const parts = JSON.parse(key);
      return Array.isArray(parts) && parts.length === 2 && JSON.stringify(parts) === key
        && typeof parts[0] === 'string' && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(parts[0])
        && (parts[1] === 'verified' || parts[1] === 'unavailable');
    } catch { return false; }
  }
  function stampWatchlistRows(items, scene, records) {
    if (!(scene.owner === null || typeof scene.owner === 'string'
      && /^(?:\d{1,24}|wallet:[1-9A-HJ-NP-Za-km-z]{32,44})$/.test(scene.owner))
      || scene.sync !== appState.watchlistSync || scene.owner !== scene.sync.identity() || scene.location !== watchlistLocation()
      || scene.items !== items || items !== document.querySelector('#watchlist-items') || scene.root !== document.querySelector('#community')
      || !scene.root?.isConnected || !items.isConnected || !scene.root.contains(items)) return;
    for (const { key, node } of records) {
      if (!validWatchlistModelKey(key) || !node.isConnected || node.parentElement !== items) continue;
      // These are committed model/DOM facts, never a saved focus or attention claim.
      watchlistRowProvenance.set(node, { key, node, items, root:scene.root, sync:scene.sync, owner:scene.owner });
    }
  }
  function committedWatchlistRows(items, scene) {
    return [...items.children].flatMap(node => {
      const fact = watchlistRowProvenance.get(node);
      return fact && fact.node === node && fact.items === items && fact.root === scene.root && fact.sync === scene.sync
        && fact.owner === scene.owner && validWatchlistModelKey(fact.key) && node.isConnected && node.parentElement === items
        && scene.root.contains(node) ? [{ key:fact.key, node }] : [];
    });
  }
  function watchlistNodeKey(node) {
    if (node.nodeType !== 1) return '';
    if (node.matches('.saved-token-identity > a')) return 'link:identity';
    if (node.matches('.saved-token-view')) return 'link:view';
    for (const attribute of ['data-mint', 'data-share-mint', 'data-boost-mint', 'data-trade-mint', 'data-watch-retry', 'data-copy-address', 'data-remove-watch']) {
      if (node.matches('button') && node.hasAttribute(attribute))
        return `${node.tagName}:${attribute}:${node.getAttribute(attribute)}:${node.getAttribute('data-copy-kind') || ''}`;
    }
    for (const role of ['saved-token-main', 'saved-token-identity', 'saved-token-metrics', 'saved-token-actions',
      'portfolio-token-avatar', 'portfolio-token-stage', 'boost-package-badges', 'watchlist-unavailable-actions']) {
      if (node.classList.contains(role)) return `slot:${role}`;
    }
    return '';
  }
  function orderWatchlistNodes(parent, desired) {
    const keep = new Set(desired);
    for (const child of [...parent.childNodes]) if (!keep.has(child)) child.remove();
    const fixed = desired.findIndex(child => child === document.activeElement || child.contains(document.activeElement));
    let cursor = parent.firstChild;
    for (let i = 0; i < (fixed < 0 ? desired.length : fixed); i++) {
      const child = desired[i]; if (child !== cursor) parent.insertBefore(child, cursor); cursor = child.nextSibling;
    }
    if (fixed < 0) return;
    cursor = desired[fixed].nextSibling;
    for (let i = fixed + 1; i < desired.length; i++) {
      const child = desired[i]; if (child !== cursor) parent.insertBefore(child, cursor); cursor = child.nextSibling;
    }
  }
  function patchWatchlistNode(current, fresh) {
    if (current.nodeType === 3) { if (current.nodeValue !== fresh.nodeValue) current.nodeValue = fresh.nodeValue; return; }
    for (const attribute of [...current.attributes]) if (!fresh.hasAttribute(attribute.name)) current.removeAttribute(attribute.name);
    for (const attribute of fresh.attributes) if (current.getAttribute(attribute.name) !== attribute.value) current.setAttribute(attribute.name, attribute.value);
    const old = [...current.childNodes], used = new Set(), keyed = new Map();
    for (const child of old) {
      const key = watchlistNodeKey(child); if (!key) continue;
      if (!keyed.has(key)) keyed.set(key, []); keyed.get(key).push(child);
    }
    const incoming = [...fresh.childNodes], counts = new Map();
    for (const child of incoming) { const key = watchlistNodeKey(child); if (key) counts.set(key, (counts.get(key) || 0) + 1); }
    const desired = incoming.map(child => {
      const key = watchlistNodeKey(child);
      // Fresh avatars disconnect every obsolete image callback captured by the unchanged loader.
      if (key === 'slot:portfolio-token-avatar') return child;
      let retained;
      if (key && counts.get(key) === 1 && keyed.get(key)?.length === 1) retained = keyed.get(key)[0];
      else if (!key && !child.matches?.('a,button,input,select,textarea,[tabindex]')) retained = old.find(prior =>
        !used.has(prior) && !watchlistNodeKey(prior) && prior.nodeType === child.nodeType && prior.nodeName === child.nodeName
        && !prior.matches?.('a,button,input,select,textarea,[tabindex]'));
      if (!retained || retained.nodeName !== child.nodeName) return child;
      used.add(retained); patchWatchlistNode(retained, child); return retained;
    });
    orderWatchlistNodes(current, desired);
  }
  function watchlistPaintedOutlineVisible(element) {
    const rect = element.getBoundingClientRect(), style = getComputedStyle(element);
    if (!element.getClientRects().length || style.visibility !== 'visible' || style.outlineStyle === 'none') return false;
    const edge = Math.max(0, (parseFloat(style.outlineWidth) || 0) + (parseFloat(style.outlineOffset) || 0));
    const bounds = { left:0, right:innerWidth, top:0, bottom:innerHeight }, rootStyle = getComputedStyle(document.documentElement);
    for (const chrome of document.querySelectorAll('.topbar,.mobile-workspace-nav')) {
      if (!chrome.getClientRects().length || getComputedStyle(chrome).visibility !== 'visible') continue;
      const box = chrome.getBoundingClientRect();
      if (chrome.matches('.topbar')) bounds.top = Math.max(bounds.top, box.bottom);
      else bounds.bottom = Math.min(bounds.bottom, box.top);
    }
    for (let ancestor = element.parentElement; ancestor; ancestor = ancestor.parentElement) {
      const css = getComputedStyle(ancestor), r = ancestor.getBoundingClientRect();
      const clipX = /^(hidden|clip|auto|scroll)$/.test(css.overflowX), clipY = /^(hidden|clip|auto|scroll)$/.test(css.overflowY);
      if (!clipX && !clipY) continue;
      // Propagated root/body overflow clips to the viewport, not a translated document box.
      if (ancestor === document.documentElement || ancestor === document.body
        && rootStyle.overflowX === 'visible' && rootStyle.overflowY === 'visible'
        && rootStyle.contain === 'none' && css.contain === 'none') continue;
      const box = { left:r.left + ancestor.clientLeft, top:r.top + ancestor.clientTop,
        right:r.left + ancestor.clientLeft + ancestor.clientWidth, bottom:r.top + ancestor.clientTop + ancestor.clientHeight };
      if (clipX && clipY) {
        const radii = ['borderTopLeftRadius','borderTopRightRadius','borderBottomRightRadius','borderBottomLeftRadius']
          .map(key => Math.max(0, (parseFloat(css[key]) || 0) - ancestor.clientLeft));
        const points = [[rect.left-edge,rect.top-edge],[rect.right+edge,rect.top-edge],
          [rect.right+edge,rect.bottom+edge],[rect.left-edge,rect.bottom+edge]];
        const centers = [[box.left+radii[0],box.top+radii[0]],[box.right-radii[1],box.top+radii[1]],
          [box.right-radii[2],box.bottom-radii[2]],[box.left+radii[3],box.bottom-radii[3]]];
        for (let i = 0; i < 4; i++) {
          const radius = radii[i], [x,y] = points[i], [cx,cy] = centers[i];
          const corner = (i === 0 || i === 3 ? x < cx : x > cx) && (i < 2 ? y < cy : y > cy);
          if (radius && corner && (x-cx)**2 + (y-cy)**2 > radius**2) return false;
        }
      }
      if (clipX) { bounds.left = Math.max(bounds.left, box.left); bounds.right = Math.min(bounds.right, box.right); }
      if (clipY) { bounds.top = Math.max(bounds.top, box.top); bounds.bottom = Math.min(bounds.bottom, box.bottom); }
    }
    return rect.left-edge >= bounds.left && rect.right+edge <= bounds.right
      && rect.top-edge >= bounds.top && rect.bottom+edge <= bounds.bottom;
  }
  function renderWatchlistRows(items, scene, candidates) {
    const eligible = currentWatchlistScene(scene), prior = eligible && sameWatchlistScene(watchlistRowsState?.scene, scene)
      ? watchlistRowsState.records : eligible ? committedWatchlistRows(items, scene) : [];
    const original = document.activeElement;
    const owned = eligible && document.hasFocus() && !document.hidden && original?.isConnected
      && original.matches?.('a,button') && watchlistNodeKey(original)
      && prior.some(record => record.node.parentElement === items && record.node.contains(original));
    const originalRow = owned && prior.find(record => record.node.contains(original));
    const preVisible = owned && !original.disabled && original.matches(':focus-visible') && watchlistPaintedOutlineVisible(original);
    const counts = list => { const result = new Map(); for (const row of list) result.set(row.key, (result.get(row.key) || 0) + 1); return result; };
    const before = counts(prior), after = counts(candidates); let intervened = false;
    const changedFocus = event => { if (event.target !== original && event.target !== document.body) intervened = true; };
    if (owned) document.addEventListener('focusin', changedFocus, true);
    try {
      const records = candidates.map(candidate => {
        const retained = candidate.key && before.get(candidate.key) === 1 && after.get(candidate.key) === 1
          && prior.find(row => row.key === candidate.key && row.node.parentElement === items);
        if (!retained) return candidate;
        patchWatchlistNode(retained.node, candidate.node); return { ...candidate, node:retained.node };
      });
      orderWatchlistNodes(items, records.map(record => record.node));
      stampWatchlistRows(items, scene, records);
      // Rendering is synchronous: never carry a pre-render owner into another account or route.
      watchlistRowsState = currentWatchlistScene(scene) ? { scene, records } : undefined;
      if (preVisible && !intervened && original.isConnected && !original.disabled && original === document.activeElement
        && original.matches(':focus-visible') && currentWatchlistScene(scene) && document.hasFocus() && !document.hidden
        && records.some(record => record.key === originalRow.key && record.node === originalRow.node && record.node.contains(original))
        && !watchlistPaintedOutlineVisible(original)) original.scrollIntoView({ block:'nearest', inline:'nearest', behavior:'instant' });
      const recovery = document.querySelector('#watchlist-sync-retry');
      if (owned && !original.isConnected && !intervened && document.activeElement === document.body
        && currentWatchlistScene(scene) && document.hasFocus() && !document.hidden
        && recovery?.isConnected && !recovery.disabled && recovery.getClientRects().length
        && getComputedStyle(recovery).visibility === 'visible') recovery.focus();
    } finally { if (owned) document.removeEventListener('focusin', changedFocus, true); }
  }

  // app-source: 397
  function renderWatchlist(){
    const saved = appState.getWatchlist();
    const count = document.querySelector('#watch-count');
    const empty = document.querySelector('#watchlist-empty');
    const items = document.querySelector('#watchlist-items');
    if (count) count.textContent = appState.watchlistUnavailable ? 'Favorites unavailable' : `${saved.length} favorite${saved.length === 1 ? '' : 's'}`;
    if (empty) empty.hidden = saved.length > 0 || appState.watchlistUnavailable;
    const scene = items && watchlistScene(items);
    const candidates = items && saved.map(mint => {
      const asset = appState.assets.find(item => item.address === mint);
      const policy = appState.verifiedLaunchPolicyForMint(mint);
      const markup = asset ? appState.portfolioTokenCardMarkup({ mint: asset.address, name: asset.name, symbol: asset.symbol, source: 'Saved token · RPC verified', verified: true, removable: true })
        : policy?.onchainVerified ? appState.portfolioTokenCardMarkup({ mint, name: policy.name, symbol: policy.symbol, source: 'Saved token · verified launch', verified: true, removable: true })
          : `<div class="saved-token-row watchlist-unavailable"><div><strong>Token details unavailable</strong><span class="watchlist-unavailable-mint" title="${appState.escapeHtml(mint)}">${appState.escapeHtml(appState.shortAddress(mint))}</span><small>This token remains in your favorites.</small></div><div class="watchlist-unavailable-actions"><button type="button" class="secondary-button" data-watch-retry="${appState.escapeHtml(mint)}"${isWatchlistRetryPending(scene.sync, mint) ? ' disabled' : ''}>Retry check</button><button type="button" class="secondary-button token-card-copy-address" data-copy-address="${appState.escapeHtml(mint)}" data-copy-kind="token" aria-label="Copy full token address">Copy mint</button><button type="button" class="secondary-button" data-remove-watch="${appState.escapeHtml(mint)}" aria-label="Remove saved token">Remove</button></div></div>`;
      const template = document.createElement('template'); template.innerHTML = markup;
      return { key:/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint) ? JSON.stringify([mint, asset || policy?.onchainVerified ? 'verified' : 'unavailable']) : '', node:template.content.firstElementChild };
    });
    if (items) {
      if (scene.sync !== appState.watchlistSync || scene.owner !== scene.sync.identity() || scene.location !== watchlistLocation()
        || scene.items !== document.querySelector('#watchlist-items') || scene.root !== document.querySelector('#community')) return;
      renderWatchlistRows(items, scene, candidates);
    } else watchlistRowsState = undefined;
    appState.loadVerifiedTokenLogos(items);
    document.querySelectorAll('.watch-button').forEach(button => appState.setWatchButtonState(button, saved.includes(button.dataset.mint)));
    const coinWatch = document.querySelector('#coin-watch');
    if (coinWatch) appState.setWatchButtonState(coinWatch, saved.includes(appState.getCoinMintAddress()));
    appState.showWatchlistStatus(appState.watchlistNotice);
    appState.renderFollowedWallets();
  }
  // app-source-end

  // app-source: 398
  function readFollowedWallets(){
    const rows = JSON.parse(localStorage.getItem(appState.FOLLOWED_WALLETS_KEY) || '[]');
    if (!Array.isArray(rows) || rows.length > 200 || rows.some(row =>
      !row || typeof row.address !== 'string' || row.address !== row.address.trim() || !appState.validateSolanaMint(row.address).valid
      || !Array.isArray(row.roles) || row.roles.some(role => !['creator', 'trader'].includes(role)))) throw new Error('Invalid followed wallets');
    if (new Set(rows.map(row => row.address)).size !== rows.length) throw new Error('Duplicate followed wallets');
    return rows;
  }
  // app-source-end

  // app-source: 399
  function getFollowedWallets(){
    try { appState.lastKnownFollowedWallets = appState.readFollowedWallets(); }
    catch { /* Preserve the last verified list when browser storage is unavailable. */ }
    return [...appState.lastKnownFollowedWallets];
  }
  // app-source-end

  // app-source: 400
  function walletRoles(address){
    return [appState.walletDetailLaunches(address).length ? 'creator' : '', appState.walletDetailTrades(address).length ? 'trader' : ''].filter(Boolean);
  }
  // app-source-end

  // app-source: 401
  function saveFollowedWallet(address, { remove = false, roles = [] } = {}){
    try {
      if (typeof address !== 'string' || address !== address.trim() || !appState.validateSolanaMint(address).valid) throw new Error('Invalid wallet address');
      const prior = appState.readFollowedWallets();
      const next = remove ? prior.filter(row => row.address !== address)
        : prior.some(row => row.address === address) ? prior
          : [...prior, { address, roles: [...new Set(roles.filter(role => ['creator', 'trader'].includes(role)))] }];
      if (next.length > 200) throw new Error('Followed wallet limit reached');
      localStorage.setItem(appState.FOLLOWED_WALLETS_KEY, JSON.stringify(next));
      if (JSON.stringify(appState.readFollowedWallets()) !== JSON.stringify(next)) throw new Error('Followed wallets could not be verified');
      appState.lastKnownFollowedWallets = next;
      appState.renderFollowedWallets();
      if (!document.querySelector('#wallet-page')?.hidden) appState.renderWalletDetail();
      if (appState.exploreTab === 'following') {
        appState.updateExploreViews(true);
        if (!remove) void appState.refreshFollowedWalletHoldings();
      }
      appState.showToast(remove ? 'Wallet unfollowed on this device' : 'Wallet followed on this device');
      return true;
    } catch {
      appState.showToast('Wallet follow could not be saved. Allow browser storage and try again.');
      appState.renderFollowedWallets();
      return false;
    }
  }
  // app-source-end

  // app-source: 402
  function renderFollowedWallets(){
    const community = document.querySelector('#community');
    if (!community) return;
    let section = document.querySelector('#followed-wallets');
    if (!section) {
      section = document.createElement('section');
      section.id = 'followed-wallets';
      section.className = 'followed-wallets panel';
      section.setAttribute('aria-labelledby', 'followed-wallets-title');
      section.innerHTML = '<div class="followed-wallets-heading"><div><h3 id="followed-wallets-title">Followed wallets</h3><p>Creator and trader wallets you follow on this device. Recent activity covers listed coins and may be incomplete.</p></div><span id="followed-wallet-count"></span></div><div id="followed-wallet-rows"></div><p id="followed-wallet-status" role="status" aria-live="polite"></p>';
      community.append(section);
    }
    let browse = section.querySelector('[data-followed-wallet-browse]');
    if (!browse) {
      browse = document.createElement('a');
      browse.className = 'secondary-button followed-wallet-browse';
      browse.dataset.followedWalletBrowse = '';
      browse.href = '#leaderboard';
      browse.textContent = 'Browse leaderboard';
      section.querySelector('#followed-wallet-status').before(browse);
    }
    let rows;
    try { rows = appState.readFollowedWallets(); appState.lastKnownFollowedWallets = rows; document.querySelector('#followed-wallet-status').textContent = ''; }
    catch { rows = appState.lastKnownFollowedWallets; document.querySelector('#followed-wallet-status').textContent = 'Saved wallets could not be read. Check browser storage before changing this list.'; }
    const creators = new Set(appState.verifiedLaunchPolicies.map(launch => launch.creatorWallet).filter(Boolean));
    const traders = new Set(appState.collectRecentTrades(appState.assets, { limit: 1000, since: Math.floor(Date.now() / 1000) - 86400 }).map(trade => trade.trader).filter(Boolean));
    document.querySelector('#followed-wallet-count').textContent = `${rows.length} followed`;
    document.querySelector('#followed-wallet-rows').innerHTML = rows.map(row => {
      const roles = [...new Set([...row.roles, creators.has(row.address) ? 'creator' : '', traders.has(row.address) ? 'trader' : ''].filter(Boolean))];
      const address = appState.escapeHtml(row.address);
      return `<article class="followed-wallet-row"><a href="/wallet/${encodeURIComponent(row.address)}" title="${address}"><strong>${appState.escapeHtml(appState.shortAddress(row.address))}</strong><small>${address}</small></a><span class="followed-wallet-roles">${roles.map(role => `<span>${role === 'creator' ? 'Creator' : 'Trader'}</span>`).join('') || '<span>Wallet</span>'}</span><button type="button" data-unfollow-wallet="${address}" aria-label="Unfollow wallet ${address}">Unfollow</button></article>`;
    }).join('') || '<p class="followed-wallet-empty">No followed wallets yet. Open a wallet from the Burners, Creators, or Traders tabs in Leaderboard, or from a token page, then choose Follow wallet.</p>';
  }
  // app-source-end

  return { showWatchlistStatus, getWatchlist, restoreWalletFavorites, verifyWalletFavorites, saveWatchlist, setWatchButtonState, renderWatchlist, readFollowedWallets, getFollowedWallets, walletRoles, saveFollowedWallet, renderFollowedWallets, getFollowingTokenSources, getFollowingCoverage, refreshFollowedWalletHoldings };
}
