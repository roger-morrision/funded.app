import { setCoinField as writeCoinField, escapeHtml, shortAddress, formatDashboardUsd } from '../shared/display.js';

// Receive current state on every render; the application owns data and wallet lifecycles.
export function renderWalletBurnersBoard(
  {
    burnersBoardState,
    verifiedLaunchPoliciesStatus,
  },
  {
    launchBurnersFallback,
    formatOnchainAge,
    exploreExplorer,
    document = globalThis.document,
  } = {}
) {
  const setCoinField = (selector, value) => writeCoinField(selector, value, document);
  const table = document.querySelector('#leaderboard-table');
  if (!table) return;
  const board = burnersBoardState.status === 'unavailable' && verifiedLaunchPoliciesStatus === 'ready'
    ? { status:'partial', wallets:launchBurnersFallback() } : burnersBoardState;
  document.querySelector('#leaderboard-panel')?.setAttribute('aria-labelledby', 'leaderboard-burners-tab');
  setCoinField('#leaderboard-table-kicker', board.status === 'partial' ? 'Confirmed launch burns · limited history' : 'Confirmed $FUNDED burns');
  setCoinField('#leaderboard-table-title', 'Wallet burn leaderboard');
  setCoinField('#leaderboard-hero-description', 'Wallets ranked by confirmed $FUNDED burns.');
  setCoinField('#leaderboard-source-note', board.status === 'partial'
    ? 'Only burns made during a launch are available right now. Other burns will appear when their history is ready.'
    : 'Only confirmed burns on this network count. Each transaction is counted once.');
  const builders = document.querySelector('#leaderboard .leaderboard-grid')?.closest('details');
  if (builders) builders.hidden = true;
  table.setAttribute('aria-label', 'Solana wallet burn leaderboard');
  const header = '<div class="leaderboard-table-head" role="row"><span>Rank</span><span>Wallet</span><span>Burned</span><span>First burn</span><span>Proof</span></div>';
  if (!['ready','partial'].includes(board.status)) {
    table.innerHTML = `${header}<div class="empty-state">${board.status === 'unavailable' ? 'Burn history is temporarily unavailable.' : 'Checking confirmed burns…'}</div>`;
    return;
  }
  if (!board.wallets.length) {
    const detail = board.status === 'partial'
      ? 'No launch burns are available in the current history.'
      : 'Wallets appear after a confirmed $FUNDED burn.';
    table.innerHTML = `${header}<div class="empty-state"><strong>${board.status === 'partial' ? 'No launch burns in this feed.' : 'No verified wallet burns yet.'}</strong><span>${detail}</span></div>`;
    return;
  }
  table.innerHTML = `${header}${board.wallets.slice(0,50).map((item,index) => {
    const amount = Number(item.burnedTokens).toLocaleString(undefined,{maximumFractionDigits:6});
    const firstBurn = item.firstBurnAt ? formatOnchainAge(Date.parse(item.firstBurnAt)) : 'Time unavailable';
    const receiptHref = exploreExplorer(`tx/${encodeURIComponent(item.latestSignature)}`);
    return `<div class="leaderboard-row${index === 0 ? ' featured' : ''}" role="row"><span class="rank-number">${String(index+1).padStart(2,'0')}</span><span class="leader-identity"><span class="leader-avatar">${escapeHtml(String(item.wallet || '').slice(0,2).toUpperCase())}</span><span><a href="/wallet/${encodeURIComponent(item.wallet)}"><strong>${escapeHtml(shortAddress(item.wallet))}</strong></a><small>${item.receiptCount} verified receipt${item.receiptCount === 1 ? '' : 's'}</small></span></span><span><b>${escapeHtml(amount)}</b><small>$FUNDED</small></span><span class="leader-value">${escapeHtml(firstBurn)}</span><span><a class="leaderboard-proof" href="${escapeHtml(receiptHref)}" target="_blank" rel="noopener noreferrer">Receipt ↗</a></span></div>`;
  }).join('')}`;
}

export function renderProjectBurnBoard(
  {
    burnBoardState,
    verifiedLaunchPoliciesStatus,
  },
  {
    launchBurnBoardFallback,
    formatOnchainAge,
    exploreExplorer,
    document = globalThis.document,
  } = {}
) {
  const table = document.querySelector('#leaderboard-table');
  if (!table) return;
  const board = burnBoardState.status === 'unavailable' && verifiedLaunchPoliciesStatus === 'ready'
    ? { status: 'partial', projects: launchBurnBoardFallback() } : burnBoardState;
  const projects = board.projects;
  document.querySelector('#leaderboard-panel')?.setAttribute('aria-labelledby', 'leaderboard-burn-board-tab');
  const kicker = document.querySelector('#leaderboard-table-kicker');
  const heading = document.querySelector('#leaderboard-table-title');
  const note = document.querySelector('#leaderboard-source-note');
  const heroDescription = document.querySelector('#leaderboard-hero-description');
  const builders = document.querySelector('#leaderboard .leaderboard-grid')?.closest('details');
  if (kicker) kicker.textContent = board.status === 'partial' ? 'Confirmed launch burns · limited history' : 'Confirmed $FUNDED burns';
  if (heading) heading.textContent = 'Project burn board';
  if (note) note.textContent = board.status === 'partial'
    ? 'Only burns made during a launch are available right now. Other project burns will appear when their history is ready.'
    : 'Projects are ranked by confirmed burns linked to their launches.';
  if (heroDescription) heroDescription.textContent = 'Projects ranked by verified $FUNDED burns attributed to their launches.';
  if (builders) builders.hidden = true;
  table.setAttribute('aria-label', 'Solana project burn board');
  const header = '<div class="leaderboard-table-head" role="row"><span>Rank</span><span>Project</span><span>Burned</span><span>Last burn</span><span>Proof</span></div>';
  if (!['ready', 'partial'].includes(board.status)) {
    const message = board.status === 'unavailable'
      ? 'Project burn history is temporarily unavailable. Try again shortly.'
      : 'Checking confirmed project burns…';
    table.innerHTML = `${header}<div class="empty-state">${message}</div>`;
    return;
  }
  if (!projects.length) {
    const detail = board.status === 'partial'
      ? 'No launch burns are available in the current history.'
      : 'Projects appear here after a confirmed $FUNDED burn is linked to a launch.';
    table.innerHTML = `${header}<div class="empty-state"><strong>No project burns yet.</strong><span>${detail}</span></div>`;
    return;
  }
  table.innerHTML = `${header}${projects.slice(0, 50).map((item, index) => {
    const lastBurn = item.lastBurnAt ? formatOnchainAge(Date.parse(item.lastBurnAt)) : 'Time unavailable';
    const amount = Number(item.burnedTokens).toLocaleString(undefined, { maximumFractionDigits: 6 });
    const tokenHref = `/token/${encodeURIComponent(item.mint)}`;
    const receiptHref = exploreExplorer(`tx/${encodeURIComponent(item.latestSignature)}`);
    return `<div class="leaderboard-row${index === 0 ? ' featured' : ''}" role="row"><span class="rank-number">${String(index + 1).padStart(2, '0')}</span><span class="leader-identity"><span class="leader-avatar mint">${escapeHtml(String(item.symbol || 'T').slice(0, 2))}</span><span><a href="${escapeHtml(tokenHref)}"><strong>${escapeHtml(item.name)}</strong></a><small>${escapeHtml(item.symbol)} · ${item.burnerCount} verified burner${item.burnerCount === 1 ? '' : 's'}</small></span></span><span><b>${escapeHtml(amount)}</b><small>$FUNDED</small></span><span class="leader-value">${escapeHtml(lastBurn)}</span><span><a class="leaderboard-proof" href="${escapeHtml(receiptHref)}" target="_blank" rel="noopener noreferrer">Receipt ↗</a></span></div>`;
  }).join('')}`;
}

export function renderLeaderboard(
  {
    leaderboardView,
    burnersBoardState,
    verifiedLaunchPolicies,
    assets,
    coinSolUsdPrice,
    verifiedLaunchPoliciesStatus,
    exploreFeedAvailable,
    EXPLORE_CLUSTER,
  },
  {
    loadWalletBurnBoard,
    renderWalletBurnersBoard,
    renderProjectBurnBoard,
    rankObservedTraders,
    exploreExplorer,
    formatOnchainAge,
    loadVerifiedTokenLogos,
    document = globalThis.document,
  } = {}
) {
  const setCoinField = (selector, value) => writeCoinField(selector, value, document);
  const title = document.querySelector('#leaderboard-status-title');
  const note = document.querySelector('#leaderboard-status-note');
  const badge = document.querySelector('#leaderboard-status-badge');
  const table = document.querySelector('#leaderboard-table');
  if (!table) return;
  table.dataset.view = leaderboardView;
  if (leaderboardView === 'burners') {
    if (burnersBoardState.status === 'idle') void loadWalletBurnBoard();
    renderWalletBurnersBoard();
    return;
  }
  if (leaderboardView === 'burn-board') { renderProjectBurnBoard(); return; }
  if (leaderboardView === 'traders') {
    document.querySelector('#leaderboard-panel')?.setAttribute('aria-labelledby', 'leaderboard-traders-tab');
    document.querySelector('#leaderboard .leaderboard-grid')?.closest('details')?.setAttribute('hidden', '');
    setCoinField('#leaderboard-table-kicker', 'Observed Pump trades · last 24 hours');
    setCoinField('#leaderboard-table-title', 'Observed trader leaderboard');
    setCoinField('#leaderboard-hero-description', 'A partial ranking of wallet SOL volume from recent, confirmed Pump trades across sampled verified tokens.');
    const { scannedTokens, traders } = rankObservedTraders?.(assets, verifiedLaunchPolicies) || { scannedTokens: 0, traders: [] };
    const unavailable = EXPLORE_CLUSTER !== 'devnet' || verifiedLaunchPoliciesStatus !== 'ready' || !exploreFeedAvailable;
    setCoinField('#leaderboard-source-note', unavailable
      ? 'The verified launch registry or trade feed is unavailable.'
      : `24-hour sample from ${scannedTokens} verified token${scannedTokens === 1 ? '' : 's'}. The feed keeps up to 20 recent trades per token and scans a limited set of tokens; ranks do not represent all trading.`);
    setCoinField('#leaderboard-status-title', unavailable ? 'Trader ranking unavailable' : traders.length ? `${traders.length} observed trading wallet${traders.length === 1 ? '' : 's'}` : 'No observed traders yet');
    setCoinField('#leaderboard-status-note', unavailable ? 'Verified trade activity could not be loaded.' : 'Ranked by observed SOL volume in the last 24 hours.');
    setCoinField('#leaderboard-status-badge', unavailable ? 'Unavailable' : 'Partial history');
    table.setAttribute('aria-label', 'Observed Solana trader leaderboard for the last 24 hours');
    const header = '<div class="leaderboard-table-head" role="row"><span>Rank</span><span>Wallet</span><span>Trades</span><span>SOL volume</span><span>Proof</span></div>';
    if (unavailable || !scannedTokens || !traders.length) {
      const heading = unavailable ? 'Trader ranking unavailable' : !scannedTokens ? 'Waiting for trade scans' : 'No trades in this sample';
      const detail = unavailable ? 'Try again when the verified launch registry and trade feed are available.' : !scannedTokens
        ? 'The leaderboard will populate after verified tokens have been scanned.'
        : 'No wallet-attributed Pump trades were found in the recent scanned activity.';
      table.innerHTML = `${header}<div class="empty-state"><strong>${heading}</strong><span>${detail}</span></div>`;
      return;
    }
    table.innerHTML = `${header}${traders.slice(0, 50).map((item, index) => {
      const amount = item.volumeSol > 0 && item.volumeSol < 0.000001 ? '<0.000001' : item.volumeSol.toLocaleString(undefined, { maximumFractionDigits: 6 });
      const receiptHref = exploreExplorer(`tx/${encodeURIComponent(item.latestSignature)}`);
      return `<div class="leaderboard-row${index === 0 ? ' featured' : ''}" role="row"><span class="rank-number">${String(index + 1).padStart(2, '0')}</span><span class="leader-identity"><span class="leader-avatar blue" aria-hidden="true">${escapeHtml(item.wallet.slice(0, 2).toUpperCase())}</span><span><a href="/wallet/${encodeURIComponent(item.wallet)}"><strong>${escapeHtml(shortAddress(item.wallet))}</strong></a><small>${item.tokenCount} token${item.tokenCount === 1 ? '' : 's'} observed</small></span></span><span><b>${item.tradeCount}</b><small>${item.buyCount} buy · ${item.sellCount} sell</small></span><span class="leader-value">${escapeHtml(amount)} SOL</span><span><a class="leaderboard-proof" href="${escapeHtml(receiptHref)}" target="_blank" rel="noopener noreferrer" aria-label="View recent transaction for ${escapeHtml(shortAddress(item.wallet))} on Solana Explorer">Trade ↗</a></span></div>`;
    }).join('')}`;
    return;
  }
  document.querySelector('#leaderboard-panel')?.setAttribute('aria-labelledby', 'leaderboard-creators-tab');
  const kicker = document.querySelector('#leaderboard-table-kicker');
  const heading = document.querySelector('#leaderboard-table-title');
  const sourceNote = document.querySelector('#leaderboard-source-note');
  const heroDescription = document.querySelector('#leaderboard-hero-description');
  const builders = document.querySelector('#leaderboard .leaderboard-grid')?.closest('details');
  if (kicker) kicker.textContent = 'Verified launches · Solana';
  if (heading) heading.textContent = 'Creator launches';
  if (sourceNote) sourceNote.textContent = 'Only confirmed Solana launches are shown. Market cap uses the verified curve or pool value and an available SOL/USD rate.';
  if (heroDescription) heroDescription.textContent = 'Creators behind confirmed launches, ranked by available market cap.';
  if (builders) builders.hidden = true;
  table.dataset.view = 'creators';
  table.setAttribute('aria-label', 'Solana creator launch leaderboard');
  const launchByMint = new Map((Array.isArray(verifiedLaunchPolicies) ? verifiedLaunchPolicies : []).map(item => [item.mint, item]));
  const verified = EXPLORE_CLUSTER === 'devnet'
    ? assets.flatMap(item => {
      const policy = launchByMint.get(item.address);
      const creator = policy?.onchainVerified ? policy.creatorWallet || policy.feePayer : null;
      return item.address && creator ? [{ ...item, creator }] : [];
    })
    : [];
  const marketCapUsd = item => {
    const capSol = item.migrated === true ? item.poolMarketCapSol : item.curveCapSol;
    if (capSol == null || capSol === '' || !Number.isFinite(coinSolUsdPrice)) return null;
    const cap = Number(capSol) * coinSolUsdPrice;
    return Number.isFinite(cap) && cap >= 0 ? cap : null;
  };
  const ranked = verified.map(item => ({ ...item, capUsd: marketCapUsd(item) }))
    .sort((a, b) => (b.capUsd ?? -1) - (a.capUsd ?? -1)
      || Number(b.createdTimestamp || 0) - Number(a.createdTimestamp || 0)
      || a.address.localeCompare(b.address)).slice(0, 25);
  const header = '<div class="leaderboard-table-head" role="row"><span>Rank</span><span>Token</span><span>Creator</span><span>Market cap</span><span>Launched</span></div>';
  const creatorRankingUnavailable = verifiedLaunchPoliciesStatus !== 'ready' || !exploreFeedAvailable;
  const empty = creatorRankingUnavailable
    ? '<div class="empty-state"><strong>Creator ranking unavailable.</strong><span>The verified launch registry or market feed could not be loaded; an empty ranking is not evidence of zero launches.</span></div>'
    : '<div class="empty-state"><strong>No verified creator launches yet.</strong><span>Launches appear after their policy and mint are confirmed on Solana.</span></div>';
  if (!ranked.length) {
    if (title) title.textContent = creatorRankingUnavailable ? 'Creator ranking unavailable' : EXPLORE_CLUSTER === 'devnet' ? 'No verified Solana launches yet' : 'Leaderboard unavailable on this cluster';
    if (note) note.textContent = creatorRankingUnavailable ? 'Launch registry or market feed unavailable; creator count not verified.' : 'No confirmed creator launches are available to rank.';
    if (badge) badge.textContent = 'Unavailable';
    table.innerHTML = `${header}${empty}`;
    return;
  }
  if (title) title.textContent = `${ranked.length} verified launch${ranked.length === 1 ? '' : 'es'} on Solana`;
  if (note) note.textContent = 'Ranked from confirmed launch policies and available market caps. Missing market data is shown as unavailable.';
  if (badge) badge.textContent = 'RPC verified';
  const avatarClass = index => ['mint', 'lavender', 'coral', 'blue'][index % 4];
  table.innerHTML = `${header}${ranked.map((item, index) => {
    const symbol = String(item.symbol || 'TOKEN').trim() || 'TOKEN';
    const name = String(item.name || symbol).trim() || symbol;
    return `<div class="leaderboard-row${index === 0 ? ' featured' : ''}" role="row"><span class="rank-number">${String(index + 1).padStart(2, '0')}</span><span class="leaderboard-token-cell" data-logo-mint="${escapeHtml(item.address)}"><span class="leader-avatar leader-token-logo ${avatarClass(index)}" aria-hidden="true">${escapeHtml(symbol.slice(0, 2).toUpperCase())}</span><span class="leaderboard-token-label"><a href="/token/${encodeURIComponent(item.address)}"><strong>${escapeHtml(symbol)}</strong></a><small title="${escapeHtml(name)}">${escapeHtml(name)}</small></span></span><span class="leader-identity leaderboard-creator-cell"><span><a href="/wallet/${encodeURIComponent(item.creator)}"><strong>${escapeHtml(shortAddress(item.creator))}</strong></a><small>Creator wallet</small></span></span><span><b>${item.capUsd == null ? '$—' : escapeHtml(formatDashboardUsd(item.capUsd))}</b><small>${item.capUsd == null ? 'Market data unavailable' : item.migrated === true ? 'Pool MC' : 'Curve MC'}</small></span><span class="leader-value">${item.createdTimestamp ? escapeHtml(formatOnchainAge(Number(item.createdTimestamp) * 1000)) : 'Time unavailable'}</span></div>`;
  }).join('')}`;
  loadVerifiedTokenLogos?.(table, { probeMissing: true });
}
