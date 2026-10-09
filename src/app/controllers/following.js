// Dependencies and mutable application state are read live through appState.
export function createFollowingController(appState) {
  // app-source: 393
  function showWatchlistStatus(message){
    appState.watchlistNotice = message;
    for (const host of [document.querySelector('#watchlist-items')?.parentElement, document.querySelector('#coin-watch')?.closest('.coin-identity')]) {
      if (!host) continue;
      let status = host.querySelector('[data-watchlist-status]');
      if (!status) { status = document.createElement('p'); status.className = 'field-help'; status.dataset.watchlistStatus = ''; status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite'); host.append(status); }
      if (status.textContent !== message) status.textContent = message;
      status.hidden = !message;
    }
  }
  // app-source-end

  // app-source: 394
  function getWatchlist(){
    appState.lastKnownWatchlist = appState.watchlistSync.get();
    return [...appState.lastKnownWatchlist];
  }
  // app-source-end

  // app-source: 395
  async function saveWatchlist(mint, { remove = false } = {}){
    const saved = await appState.watchlistSync.save(mint, remove);
    if (saved && !remove) window.dispatchEvent(new Event('funded:watchlist-added'));
    if (!saved) appState.showToast('Favorites could not be saved. Check sign-in and retry.');
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

  // app-source: 397
  function renderWatchlist(){
    const saved = appState.getWatchlist();
    const count = document.querySelector('#watch-count');
    const empty = document.querySelector('#watchlist-empty');
    const items = document.querySelector('#watchlist-items');
    if (count) count.textContent = appState.watchlistUnavailable ? 'Favorites unavailable' : `${saved.length} favorite${saved.length === 1 ? '' : 's'}`;
    if (empty) empty.hidden = saved.length > 0 || appState.watchlistUnavailable;
    if (items) items.innerHTML = saved.map(mint => {
      const asset = appState.assets.find(item => item.address === mint);
      const policy = appState.verifiedLaunchPolicyForMint(mint);
      return asset ? appState.portfolioTokenCardMarkup({ mint: asset.address, name: asset.name, symbol: asset.symbol, source: 'Saved token · RPC verified', verified: true, removable: true })
        : policy?.onchainVerified ? appState.portfolioTokenCardMarkup({ mint, name: policy.name, symbol: policy.symbol, source: 'Saved token · verified launch', verified: true, removable: true })
          : `<div class="saved-token-row watchlist-unavailable"><div><strong>Token details unavailable</strong><span class="watchlist-unavailable-mint" title="${appState.escapeHtml(mint)}">${appState.escapeHtml(appState.shortAddress(mint))}</span><small>This token remains in your favorites.</small></div><div class="watchlist-unavailable-actions"><button type="button" class="secondary-button" data-watch-retry="${appState.escapeHtml(mint)}">Retry check</button><button type="button" class="secondary-button token-card-copy-address" data-copy-address="${appState.escapeHtml(mint)}" data-copy-kind="token" aria-label="Copy full token address">Copy mint</button><button type="button" class="secondary-button" data-remove-watch="${appState.escapeHtml(mint)}" aria-label="Remove saved token">Remove</button></div></div>`;
    }).join('');
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
    }).join('') || '<p class="followed-wallet-empty">No followed wallets yet. Open a creator or trader wallet from a token page, then choose Follow wallet.</p>';
  }
  // app-source-end

  return { showWatchlistStatus, getWatchlist, saveWatchlist, setWatchButtonState, renderWatchlist, readFollowedWallets, getFollowedWallets, walletRoles, saveFollowedWallet, renderFollowedWallets };
}
