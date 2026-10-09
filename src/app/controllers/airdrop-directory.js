// Dependencies and mutable application state are read live through appState.
export function createAirdropDirectoryController(appState) {
  // app-source: 322
  function getAirdropPrograms(){
    return appState.verifiedLaunchPolicies.flatMap(launch => {
      const allocationPercent = Number(launch.communityAirdrop?.allocationPercent);
      const reservedTokens = Number(launch.communityAirdrop?.reservedTokens);
      if (!launch.mint || !Number.isFinite(allocationPercent) || !Number.isSafeInteger(reservedTokens) || reservedTokens <= 0) return [];
      const reserve = appState.verifiedCommunityReserves.get(launch.mint);
      const claimState = appState.airdropClaimState(reserve);
      const claimActive = claimState.claimActive;
      const claimedTokens = claimState.published && /^\d+$/.test(String(reserve.claimedBaseUnits)) && /^\d+$/.test(String(reserve.totalBaseUnits))
        && BigInt(reserve.totalBaseUnits) > 0n
        ? Number(BigInt(reserve.claimedBaseUnits) * BigInt(reservedTokens) * 1_000_000n / BigInt(reserve.totalBaseUnits)) / 1_000_000 : null;
      return [{
        id: launch.mint,
        name: launch.name || 'Solana launch',
        symbol: launch.symbol || 'TOKEN',
        allocationPercent,
        reservedTokens,
        creatorWallet: launch.creatorWallet,
        reserveStatus: reserve?.status || 'unverified',
        vaultInitialized: reserve?.vaultInitialized === true,
        vaultForFunding: reserve?.vault || null,
        claimedTokens,
        eligibleWallets: claimState.published ? reserve.leafCount : null,
        claimedWallets: null,
        vaultVerified: reserve?.verified === true && ['funded','drop-active','drop-closed'].includes(reserve.status) && Number(reserve.reservedTokens) === reservedTokens,
        vaultAddress: reserve?.verified === true ? claimState.published ? reserve.drop : reserve.vault : null,
        fundingSignature: reserve?.verified === true ? reserve.fundingSignature : null,
        claimPublished: claimState.published,
        claimActive,
        migrationSlot: claimState.published ? reserve.migrationSlot : null,
        status: claimState.status,
        statusLabel: claimState.label,
        merkleRoot: claimState.published ? reserve.merkleRoot : null,
        snapshotHash: claimState.published ? reserve.snapshotHash : null,
        deadline: claimState.published && reserve.expiresAt ? new Date(reserve.expiresAt * 1000).toLocaleString() : 'After verified migration snapshot',
        snapshot: claimState.published ? `Migration slot ${reserve.migrationSlot}` : 'Migration snapshot · unverified',
        walletAllocation: null,
      }];
    });
  }
  // app-source-end

  // app-source: 323
  function airdropClaimRate(program){ return program.claimedTokens != null && program.vaultVerified === true && program.reservedTokens ? program.claimedTokens / program.reservedTokens : null; }
  // app-source-end

  // app-source: 324
  function currentCommunityClaimSummary(){
    return appState.communityClaimSummary(appState.verifiedLaunchPolicies, appState.verifiedCommunityReserves, {
      launchesReady: appState.verifiedLaunchPoliciesStatus === 'ready', reservesReady: appState.communityReserveStatus === 'ready',
    });
  }
  // app-source-end

  // app-source: 325
  function renderAirdropSummary(programs){
    const node = document.querySelector('#airdrop-summary-kpis');
    if (!node) return;
    if (appState.verifiedLaunchPoliciesStatus !== 'ready') {
      const note = appState.verifiedLaunchPoliciesStatus === 'loading' ? 'Checking the verified launch registry' : 'Launch registry unavailable; counts not verified';
      node.innerHTML = `<article><span>Indexed launch policies</span><strong>—</strong><small>${note}</small></article><article><span>Policy allocation</span><strong>—</strong><small>${note}</small></article><article><span>Claimed so far</span><strong>—</strong><small>Claim receipts unavailable</small></article><article><span>Eligible wallets</span><strong>—</strong><small>Eligibility snapshot unavailable</small></article>`;
      return;
    }
    const reserved = programs.reduce((sum, item) => sum + item.reservedTokens, 0);
    const claimSummary = appState.currentCommunityClaimSummary();
    const eligibilityPrograms = programs.filter(item => item.claimPublished && item.eligibleWallets != null);
    const eligible = eligibilityPrograms.length ? eligibilityPrograms.reduce((sum, item) => sum + item.eligibleWallets, 0) : null;
    const fundedCount = programs.filter(item => item.vaultVerified).length;
    const activeCount = programs.filter(item => item.claimActive).length;
    const fundingNote = appState.communityReserveStatus === 'ready'
      ? `${fundedCount} of ${programs.length} airdrops funded · ${activeCount} open for claims`
      : appState.communityReserveStatus === 'loading' ? 'Checking funding' : 'Funding status unavailable';
    node.innerHTML = `<article><span>Published airdrops</span><strong>${programs.length}</strong><small>${activeCount} open for claims</small></article><article><span>Planned tokens</span><strong>${appState.formatTokenAmount(reserved)}</strong><small>${fundingNote}</small></article><article data-community-claimed><span>Community airdrops claimed</span><strong>${claimSummary.amount}</strong><span>${appState.communityClaimUnit(claimSummary)}</span><small>${claimSummary.note}</small></article><article><span>Eligible wallets</span><strong>${eligible == null ? '—' : `${eligibilityPrograms.length < programs.length ? '≥' : ''}${appState.formatVerifiedAirdropAmount(eligible)}`}</strong><small>${eligible == null ? 'Eligibility details unavailable' : `Eligibility available for ${eligibilityPrograms.length} of ${programs.length} airdrops`}</small></article>`;
  }
  // app-source-end

  // app-source: 329
  function directoryWalletAmount(program){
    if (!program.claimActive) return program.status === 'closed' ? 'Claims closed' : 'Check when claims open';
    if (!appState.connectedWalletAddress) return 'Connect to check';
    const allocation = appState.communityWalletAllocations.get(program.id);
    if (!allocation || allocation.wallet !== appState.connectedWalletAddress || allocation.snapshotHash !== program.snapshotHash)
      return 'Check allocation';
    if (allocation.status === 'checking') return 'Checking…';
    if (allocation.status === 'claimable') return `${allocation.amount} ${program.symbol}`;
    if (allocation.status === 'claimed') return 'Already claimed';
    if (allocation.status === 'ineligible') return 'No allocation';
    return 'Proof unavailable';
  }
  // app-source-end

  // app-source: 330
  function updateDirectoryWalletAmount(session, program, status, amount){
    if (!appState.isWalletSessionCurrent(session)) return false;
    appState.communityWalletAllocations.set(program.id, { wallet: session.address, snapshotHash: program.snapshotHash, status, amount });
    appState.renderAirdropDirectory();
    return true;
  }
  // app-source-end

  // app-source: 331
  function renderAirdropDirectory(programs = appState.getAirdropPrograms()){
    const list = document.querySelector('#airdrop-directory');
    if (!list) return;
    const query = document.querySelector('#airdrop-search')?.value.trim().toLowerCase() || '';
    list.dataset.indexStatus = appState.verifiedLaunchPoliciesStatus;
    list.dataset.upcomingCount = String(programs.filter(item => item.status === 'upcoming').length);
    list.dataset.claimingCount = String(programs.filter(item => item.status === 'claiming').length);
    list.dataset.closedCount = String(programs.filter(item => item.status === 'closed').length);
    const filtered = programs.filter(item => item.status === appState.airdropDirectoryStatus && (!query || `${item.name} ${item.symbol} ${item.id}`.toLowerCase().includes(query)));
    const totalPages = Math.max(1, Math.ceil(filtered.length / appState.AIRDROP_DIRECTORY_PAGE_SIZE));
    appState.airdropDirectoryPage = Math.min(appState.airdropDirectoryPage, totalPages);
    const first = (appState.airdropDirectoryPage - 1) * appState.AIRDROP_DIRECTORY_PAGE_SIZE;
    list.innerHTML = filtered.slice(first, first + appState.AIRDROP_DIRECTORY_PAGE_SIZE).map(program => {
      const safeMint = appState.escapeHtml(program.id);
      const safeSymbol = appState.escapeHtml(program.symbol);
      const walletCheck = appState.communityWalletAllocations.get(program.id);
      const checking = walletCheck?.status === 'checking' && walletCheck.wallet === appState.connectedWalletAddress && walletCheck.snapshotHash === program.snapshotHash;
      const snapshotReady = program.eligibleWallets != null;
      const cardData = appState.tokenCardData({ mint: program.id, policy: appState.verifiedLaunchPolicyForMint(program.id), reserve: { mint: program.id, verified: program.vaultVerified } });
      return `<article class="token-card-shell airdrop-directory-card" data-logo-mint="${safeMint}">
        <div class="directory-card-top"><span class="claim-token-mark" aria-hidden="true" title="Project artwork not published for this token">${appState.escapeHtml(program.symbol.slice(0, 2).toUpperCase())}</span><div><span class="directory-token-identity"><strong>${safeSymbol}</strong>${appState.exploreBoostAmountMarkup(program.id)}<a href="/token/${encodeURIComponent(program.id)}">${appState.escapeHtml(program.name)}</a></span><span class="airdrop-status ${program.status}">${appState.escapeHtml(program.statusLabel)}</span></div></div>
        <div class="directory-stats"><span><small>Planned airdrop</small><b>${appState.formatPolicyTokenCount(program.reservedTokens)} $${safeSymbol}</b></span><span><small>Funding</small><b>${cardData.reserveState === 'verified' ? 'Confirmed' : appState.communityReserveStatus === 'loading' ? 'Checking…' : appState.communityReserveStatus === 'unavailable' ? 'Unavailable' : 'Not confirmed'}</b></span><span><small>Eligible wallets</small><b>${snapshotReady ? `${appState.formatPolicyTokenCount(program.eligibleWallets)} wallets` : 'Pending'}</b></span></div>
        <div class="directory-footer"><span><small>Your amount</small><b>${appState.escapeHtml(appState.directoryWalletAmount(program))}</b></span><div class="token-card-actions">${appState.tokenCardWatchMarkup(program.id, program.symbol)}${appState.tokenCardShareMarkup(program.id, program.symbol, program.name)}<button type="button" class="secondary-button directory-claim" data-directory-mint="${safeMint}" aria-controls="airdrop-selected-program" ${checking ? 'disabled' : ''}>${appState.connectedWalletAddress && program.claimActive ? 'Check allocation' : 'View claim status'}</button></div></div>
        <details class="token-card-more"><summary>Addresses and verification</summary>${appState.tokenCardAddressesMarkup(program.id)}${appState.exploreSocialLinksMarkup({ address: program.id, symbol: program.symbol })}<small>${appState.escapeHtml(appState.tokenCardEvidenceLabel(cardData))}</small></details>
      </article>`;
    }).join('') || `<div class="empty-state">${appState.verifiedLaunchPoliciesStatus === 'loading' ? 'Checking airdrops…' : appState.verifiedLaunchPoliciesStatus === 'unavailable' ? 'Airdrops are temporarily unavailable.' : query ? 'No airdrops match your search.' : appState.airdropDirectoryStatus === 'claiming' ? 'No claims are open yet.' : appState.airdropDirectoryStatus === 'closed' ? 'No closed airdrops yet.' : 'No upcoming airdrops yet.'}</div>`;
    appState.loadVerifiedTokenLogos(list, { probeMissing: true });
    const pagination = document.querySelector('#airdrop-directory-pagination');
    if (pagination) {
      pagination.hidden = filtered.length <= appState.AIRDROP_DIRECTORY_PAGE_SIZE;
      pagination.querySelector('[data-airdrop-page="prev"]').disabled = appState.airdropDirectoryPage <= 1;
      pagination.querySelector('[data-airdrop-page="next"]').disabled = appState.airdropDirectoryPage >= totalPages;
      pagination.querySelector('#airdrop-directory-range').textContent = filtered.length ? `${first + 1}–${Math.min(first + appState.AIRDROP_DIRECTORY_PAGE_SIZE, filtered.length)} of ${filtered.length} · page ${appState.airdropDirectoryPage} / ${totalPages}` : '0 indexed';
    }
  }
  // app-source-end

  // app-source: 332
  function renderAirdropProgramDetail(program){
    return appState.renderAirdropProgramDetailView(program, { connectedWalletAddress: appState.connectedWalletAddress, communityClaimPolicy: appState.communityClaimPolicy, wallet: appState.wallet, APP_EXPLORER_QUERY: appState.APP_EXPLORER_QUERY }, { formatTokenAmount: appState.formatTokenAmount, formatVerifiedAirdropAmount: appState.formatVerifiedAirdropAmount });
  }
  // app-source-end

  return { getAirdropPrograms, airdropClaimRate, currentCommunityClaimSummary, renderAirdropSummary, directoryWalletAmount, updateDirectoryWalletAmount, renderAirdropDirectory, renderAirdropProgramDetail };
}
