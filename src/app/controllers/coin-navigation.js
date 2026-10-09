// Dependencies and mutable application state are read live through appState.
export function createCoinNavigationController(appState) {
  // app-source: 983
  function showCoinPage(open = true){
    const main = document.querySelector('.main-content');
    const page = document.querySelector('#coin-page');
    const walletPage = document.querySelector('#wallet-page');
    if (!main || !page) return;
    if (!open){
      ++appState.coinLoadId;
      main.classList.remove('coin-view');
      page.hidden = true;
      // Navigation can beat the first token-detail render. A workspace route
      // still needs its first Explore check even if coin-view was never set.
      if (!appState.exploreUpdatedAt && !appState.coinExitExploreLoad) {
        appState.coinExitExploreLoad = appState.loadOnchainExploreData().catch(() => {
          const status = document.querySelector('#home-live-status');
          const note = document.querySelector('#home-verified-launches-note');
          if (status) status.textContent = 'Solana RPC · unavailable';
          if (note) note.textContent = 'Unable to verify live data';
        }).finally(() => { appState.coinExitExploreLoad = null; });
      }
      return;
    }
    const mintAddress = appState.getCoinMintAddress();
    main.classList.remove('wallet-view');
    if (walletPage) walletPage.hidden = true;
    appState.setCoinField('#coin-full-address', mintAddress || 'No mint address');
    const addressButton = document.querySelector('#coin-copy-address');
    if (addressButton) appState.setCoinField('#coin-address', appState.shortAddress(mintAddress));
    appState.resetCoinSurface(mintAddress); appState.renderCoinPromotionBadge(); main.classList.add('coin-view'); page.hidden = false; window.scrollTo({ top: 0, behavior: 'smooth' });
    appState.startCoinLabelSanitizer();
    const watch = document.querySelector('#coin-watch'); if (watch) appState.setWatchButtonState(watch, appState.getWatchlist().includes(mintAddress));
    const sharedEntry = new URLSearchParams(location.search);
    const buyReceipt = sharedEntry.get('buy'), sellReceipt = sharedEntry.get('sell');
    const sharedTradeReceipts = /^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(String(buyReceipt || ''))
      && /^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(String(sellReceipt || ''));
    let callout = page.querySelector('#shared-coin-callout');
    if (sharedEntry.has('src') || sharedEntry.has('ref') || sharedTradeReceipts) {
      if (!callout) { callout = document.createElement('div'); callout.id = 'shared-coin-callout'; callout.className = 'share-insights'; page.querySelector('.coin-hero-card')?.after(callout); }
      if (callout) {
        callout.replaceChildren();
        const title = document.createElement('strong'); title.textContent = 'Opened a shared coin link';
        const detail = document.createElement('small'); detail.textContent = 'Add this coin to favorites on this device so you can find it again. Check the live data before acting.';
        const save = document.createElement('button'); save.type = 'button'; save.className = 'secondary-button'; save.textContent = appState.getWatchlist().includes(mintAddress) ? 'In favorites' : 'Add to favorites';
        save.setAttribute('aria-pressed', String(appState.lastKnownWatchlist.includes(mintAddress)));
        save.addEventListener('click', async () => {
          if (!await appState.saveWatchlist(mintAddress, { remove: save.getAttribute('aria-pressed') === 'true' })) return;
          appState.renderWatchlist();
          appState.setWatchButtonState(watch, appState.lastKnownWatchlist.includes(mintAddress));
          save.setAttribute('aria-pressed', String(appState.lastKnownWatchlist.includes(mintAddress)));
          save.textContent = appState.lastKnownWatchlist.includes(mintAddress) ? 'In favorites' : 'Add to favorites';
        });
        callout.append(title, detail, save);
        if (sharedTradeReceipts && appState.validateSolanaMint(mintAddress).valid) {
          const tradeTitle = document.createElement('strong'); tradeTitle.textContent = 'Check the shared closed trade';
          const tradeNote = document.createElement('small'); tradeNote.textContent = 'The two full receipts are public. Verify the same wallet bought and sold an exact token-account position with no intervening activity.';
          const buyLink = document.createElement('a'); buyLink.href = appState.exploreExplorer(`tx/${encodeURIComponent(buyReceipt)}`); buyLink.textContent = 'Open buy receipt ↗'; buyLink.target = '_blank'; buyLink.rel = 'noopener noreferrer';
          const sellLink = document.createElement('a'); sellLink.href = appState.exploreExplorer(`tx/${encodeURIComponent(sellReceipt)}`); sellLink.textContent = 'Open sell receipt ↗'; sellLink.target = '_blank'; sellLink.rel = 'noopener noreferrer';
          const verify = document.createElement('button'); verify.type = 'button'; verify.className = 'secondary-button'; verify.textContent = 'Verify closed trade result';
          const outcome = document.createElement('small'); outcome.setAttribute('role', 'status');
          verify.addEventListener('click', async () => {
            verify.disabled = true; outcome.textContent = 'Checking finalized receipts and token-account history…';
            try {
              const { formatLamportsAsSol, verifyRoundTripFromSignatures } = await import('../../../trade-roundtrip.js');
              const activeConnection = appState.connection || (await appState.getSolana(), appState.connection);
              const proof = await verifyRoundTripFromSignatures(activeConnection, { buySignature:buyReceipt, sellSignature:sellReceipt, mint:mintAddress });
              outcome.textContent = `Verified closed position. Wallet SOL change in the two receipts: ${proof.positive ? '+' : ''}${formatLamportsAsSol(proof.netLamports)} SOL. This includes all SOL movements in those transactions; it is not wallet-wide profit.`;
            } catch (error) { outcome.textContent = `Unable to verify this result: ${error.message}`; }
            finally { verify.disabled = false; }
          });
          callout.append(tradeTitle, tradeNote, buyLink, sellLink, verify, outcome);
        }
        if (appState.normalizeReferralCode(sharedEntry.get('ref'))) {
          const consent = document.createElement('label'); consent.className = 'share-visit-consent';
          const checkbox = document.createElement('input'); checkbox.type = 'checkbox';
          checkbox.checked = Boolean(document.querySelector('#share-visit-consent')?.checked);
          checkbox.addEventListener('change', () => {
            const privacyControl = document.querySelector('#share-visit-consent');
            if (!privacyControl) return;
            privacyControl.checked = checkbox.checked;
            privacyControl.dispatchEvent(new Event('change'));
          });
          consent.append(checkbox, document.createTextNode(' Count visits from this browser for the inviter (optional)'));
          const privacy = document.createElement('small'); privacy.textContent = 'A random browser ID and visit day are kept for 30 days. Change this any time in Privacy.';
          callout.append(consent, privacy);
        }
      }
    } else if (callout) callout.remove();
    appState.loadCoinOnChain(mintAddress);
  }
  // app-source-end

  // app-source: 984
  function coinRouteRequested(){ const directPath = location.pathname.startsWith('/token/') || location.pathname.startsWith('/launch/coin/'); return location.hash.startsWith('#coin/') || (directPath && !location.hash); }
  // app-source-end

  // app-source: 985
  function walletRouteRequested(){ return location.pathname.startsWith('/wallet/') && !location.hash; }
  // app-source-end

  return { showCoinPage, coinRouteRequested, walletRouteRequested };
}
