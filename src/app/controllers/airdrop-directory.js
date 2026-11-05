import { isOnCurveAirdrop } from '../../features/rewards/airdrop-discovery-model.js';
import { utcMoment } from '../../features/rewards/card-format.js';
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
      const reserveStatus = appState.communityReserveStates?.get(launch.mint) || appState.communityReserveStatus;
      const claimVerification = reserveStatus === 'loading' ? 'checking'
        : reserveStatus === 'ready' && reserve?.verified === true ? 'verified' : 'unavailable';
      const market = appState.assets.find(item => item.address === launch.mint);
      const claimActive = claimVerification === 'verified' && claimState.claimActive;
      const claimedTokens = claimState.published && /^\d+$/.test(String(reserve.claimedBaseUnits)) && /^\d+$/.test(String(reserve.totalBaseUnits))
        && BigInt(reserve.totalBaseUnits) > 0n
        ? Number(BigInt(reserve.claimedBaseUnits) * BigInt(reservedTokens) * 1_000_000n / BigInt(reserve.totalBaseUnits)) / 1_000_000 : null;
      const snapshotBasis = claimState.published ? reserve.snapshotBasis || null : null;
      const snapshotLabel = snapshotBasis === 'devnet-qa-cutoff' ? 'Devnet QA cutoff'
        : snapshotBasis === 'pump-migration' ? 'Migration' : 'On-chain snapshot';
      const windowSeconds = Number(reserve?.expiresAt) - Number(reserve?.migrationAt);
      const claimWindowDays = claimState.published && Number.isSafeInteger(windowSeconds)
        && windowSeconds > 0 && windowSeconds % 86_400 === 0 ? windowSeconds / 86_400 : null;
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
        claimVerification,
        marketStageKnown: typeof market?.complete === 'boolean' || market?.migrated === true,
        claimActive,
        migratedAndAirdropped: claimVerification==='verified'&&snapshotBasis==='pump-migration'&&claimedTokens>0,
        snapshotBasis,
        claimWindowDays,
        migrationSlot: claimState.published ? reserve.migrationSlot : null,
        migrationAt: claimState.published && Number.isSafeInteger(Number(reserve.migrationAt)) && Number(reserve.migrationAt) > 0
          ? Number(reserve.migrationAt) : null,
        status: claimState.status,
        statusLabel: claimVerification === 'verified' ? claimState.label : claimVerification === 'checking' ? 'Checking delivery…' : 'Delivery unavailable',
        merkleRoot: claimState.published ? reserve.merkleRoot : null,
        snapshotHash: claimState.published ? reserve.snapshotHash : null,
        deadline: claimState.published && reserve.expiresAt
          ? new Date(reserve.expiresAt * 1000).toLocaleString(undefined, { dateStyle:'medium', timeStyle:'long' })
          : 'After the holder snapshot',
        snapshot: claimState.published ? `${snapshotLabel} slot ${reserve.migrationSlot}` : 'Not taken yet',
        walletAllocation: null,
        onCurve: isOnCurveAirdrop({ claimPublished: claimState.published }, market),
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
      const note = appState.verifiedLaunchPoliciesStatus === 'loading' ? 'Checking launches…' : 'Launch data unavailable right now';
      node.innerHTML = `<article><span>Indexed launch policies</span><strong>—</strong><small>${note}</small></article><article><span>Policy allocation</span><strong>—</strong><small>${note}</small></article><article><span>Delivered so far</span><strong>—</strong><small>Delivery receipts unavailable</small></article><article><span>Eligible wallets</span><strong>—</strong><small>Eligibility snapshot unavailable</small></article>`;
      return;
    }
    const reserved = programs.reduce((sum, item) => sum + item.reservedTokens, 0);
    const claimSummary = appState.currentCommunityClaimSummary();
    const eligibilityPrograms = programs.filter(item => item.claimPublished && item.eligibleWallets != null);
    const eligible = eligibilityPrograms.length ? eligibilityPrograms.reduce((sum, item) => sum + item.eligibleWallets, 0) : null;
    const fundedCount = programs.filter(item => item.vaultVerified).length;
    const activeCount = programs.filter(item => item.claimActive).length;
    const claimsKnown = appState.communityReserveStatus === 'ready' && programs.every(item => item.claimVerification === 'verified');
    const fundingNote = claimsKnown
      ? `${fundedCount} of ${programs.length} airdrops funded · ${activeCount} ready for delivery`
      : appState.communityReserveStatus === 'loading' ? 'Checking funding' : 'Funding verification unavailable or incomplete';
    node.innerHTML = `<article><span>Indexed allocations</span><strong>${programs.length}</strong><small>${claimsKnown ? `${activeCount} ready for delivery` : '-'}</small></article><article><span>Planned tokens</span><strong>${appState.formatTokenAmount(reserved)}</strong><small>${fundingNote}</small></article><article data-community-claimed><span>Tokens delivered</span><strong>${claimSummary.amount}</strong><span>${appState.communityClaimUnit(claimSummary)}</span><small>${claimSummary.note}</small></article><article><span>Eligible wallets</span><strong>${eligible == null ? '—' : `${eligibilityPrograms.length < programs.length ? '≥' : ''}${appState.formatVerifiedAirdropAmount(eligible)}`}</strong><small>${eligible == null ? '-' : `Eligibility available for ${eligibilityPrograms.length} of ${programs.length} airdrops`}</small></article>`;
  }
  // app-source-end

  // app-source: 329
  function directoryWalletAmount(program){
    if (program.claimVerification === 'checking' || program.claimVerification === 'unavailable') return '-';
    if (!program.claimActive) return program.status === 'closed' ? 'Distribution closed' : 'Awaiting migration';
    if (!appState.connectedWalletAddress) return 'Connect to check';
    const allocation = appState.communityWalletAllocations.get(program.id);
    if (!allocation || allocation.wallet !== appState.connectedWalletAddress || allocation.snapshotHash !== program.snapshotHash)
      return 'Allocation pending';
    if (allocation.status === 'checking') return 'Checking…';
    if (allocation.status === 'claimable') return `${allocation.amount} ${program.symbol}`;
    if (allocation.status === 'claimed') return allocation.amount ? `${allocation.amount} ${program.symbol} · delivered` : 'Delivered';
    if (allocation.status === 'ineligible') return 'No allocation';
    return '-';
  }
  // app-source-end

  // app-source: 330
  function updateDirectoryWalletAmount(session, program, status, amount){
    if (!appState.isWalletSessionCurrent(session)) return false;
    appState.communityWalletAllocations.set(program.id, { wallet: session.address, snapshotHash: program.snapshotHash, status, amount, checkedAt:Date.now() });
    appState.renderAirdropDirectory();
    return true;
  }
  // app-source-end

  // app-source: 331
  let directoryRefreshDeferred=false;
  function renderAirdropDirectory(programs = appState.getAirdropPrograms()){
    const list = document.querySelector('#airdrop-directory');
    if (!list) return;
    const detail=document.querySelector('#airdrop-selected-program');
    // A passive directory reflow above the open detail must not move its
    // keyboard reader. Refresh the cards after focus leaves that detail.
    if(detail&&!detail.hidden&&detail.contains(document.activeElement)){
      if(!directoryRefreshDeferred){
        directoryRefreshDeferred=true;
        detail.addEventListener('focusout',()=>requestAnimationFrame(()=>{
          directoryRefreshDeferred=false;appState.renderAirdropDirectory();
        }),{once:true});
      }
      return;
    }
    const query = document.querySelector('#airdrop-search')?.value.trim().toLowerCase() || '';
    list.dataset.indexStatus = appState.verifiedLaunchPoliciesStatus;
    list.dataset.claimsStatus = appState.communityReserveStatus === 'ready' && programs.every(item => item.claimVerification === 'verified') ? 'ready' : 'unavailable';
    list.dataset.stagesStatus = programs.every(item => item.marketStageKnown) ? 'ready' : 'unavailable';
    list.dataset.allCount = String(programs.length);
    list.dataset.curveCount = String(programs.filter(item => item.onCurve).length);
    list.dataset.upcomingCount = String(programs.filter(item => item.status === 'upcoming').length);
    list.dataset.distributedCount = String(programs.filter(item => item.migratedAndAirdropped).length);
    list.dataset.closedCount = String(programs.filter(item => item.status === 'closed').length);
    const matchesStatus = item => appState.airdropDirectoryStatus === 'all'
      || (appState.airdropDirectoryStatus === 'curve' ? item.onCurve : appState.airdropDirectoryStatus === 'distributed' ? item.migratedAndAirdropped : false);
    const filtered = programs.filter(item => matchesStatus(item) && (!query || `${item.name} ${item.symbol} ${item.id}`.toLowerCase().includes(query)));
    const totalPages = Math.max(1, Math.ceil(filtered.length / appState.AIRDROP_DIRECTORY_PAGE_SIZE));
    appState.airdropDirectoryPage = Math.min(appState.airdropDirectoryPage, totalPages);
    const first = (appState.airdropDirectoryPage - 1) * appState.AIRDROP_DIRECTORY_PAGE_SIZE;
    const curveTab = appState.airdropDirectoryStatus === 'curve';
    const selectedPanel = document.querySelector('#airdrop-selected-program');
    const selectedMint = selectedPanel && !selectedPanel.hidden ? selectedPanel.dataset.mint : null;
    const active = document.activeElement;
    const focusedMint = active?.matches?.('[data-directory-mint]') && list.contains?.(active)
      ? active.dataset.directoryMint : null;
    list.innerHTML = filtered.slice(first, first + appState.AIRDROP_DIRECTORY_PAGE_SIZE).map(program => {
      const safeMint = appState.escapeHtml(program.id);
      const safeSymbol = appState.escapeHtml(program.symbol);
      const walletCheck = appState.communityWalletAllocations.get(program.id);
      const checking = walletCheck?.status === 'checking' && walletCheck.wallet === appState.connectedWalletAddress && walletCheck.snapshotHash === program.snapshotHash;
      const snapshotReady = program.eligibleWallets != null;
      const unknownClaim = program.claimVerification === 'checking' ? 'Checking delivery…'
        : program.claimVerification === 'unavailable' ? 'Delivery unavailable' : null;
      const snapshotLabel = unknownClaim ? program.claimVerification === 'checking' ? 'Checking…' : 'Unavailable'
        : snapshotReady ? `${appState.formatPolicyTokenCount(program.eligibleWallets)} wallets` : 'Pending';
      const cardData = appState.tokenCardData({ mint: program.id, policy: appState.verifiedLaunchPolicyForMint(program.id), reserve: { mint: program.id, verified: program.vaultVerified } });
      return `<article class="token-card-shell airdrop-directory-card" data-logo-mint="${safeMint}">
        <div class="directory-card-top"><span class="claim-token-mark" aria-hidden="true" title="Project artwork not published for this token">${appState.escapeHtml(program.symbol.slice(0, 2).toUpperCase())}</span><div class="directory-project-info"><span class="directory-token-identity"><strong>${safeSymbol}</strong>${appState.exploreBoostAmountMarkup(program.id)}<a href="/token/${encodeURIComponent(program.id)}">${appState.escapeHtml(program.name)}</a></span>
        <div class="directory-facts"><div class="directory-allocation-line"><span>Reserved tokens</span><strong>${appState.formatPolicyTokenCount(program.reservedTokens)}</strong></div><div><span>Snapshot</span><strong>${snapshotLabel}</strong></div>
        ${curveTab || appState.airdropDirectoryStatus === 'distributed' ? '' : `<div class="directory-funding-line"><span>Funding</span><strong>${cardData.reserveState === 'verified' ? 'Confirmed' : program.claimVerification === 'checking' ? 'Checking…' : program.claimVerification === 'unavailable' ? 'Unavailable' : 'Not confirmed'}</strong></div>`}</div>
        <details class="token-card-more"><summary>Details & links</summary>${program.claimPublished ? `<small class="directory-migration-time">${program.migrationAt ? `${program.snapshotBasis === 'devnet-qa-cutoff' ? 'Devnet QA cutoff' : program.snapshotBasis === 'pump-migration' ? 'Migrated' : 'Snapshot recorded'} ${utcMoment(program.migrationAt * 1000)}` : 'Snapshot time unavailable'}</small>` : ''}${appState.tokenCardAddressesMarkup(program.id)}${appState.exploreSocialLinksMarkup({ address: program.id, symbol: program.symbol })}<small>${appState.escapeHtml(program.statusLabel)} · ${appState.escapeHtml(appState.tokenCardEvidenceLabel(cardData))}</small></details></div></div>
        <div class="directory-footer"><span class="airdrop-status ${program.status}" data-inline-status>${unknownClaim || (program.claimActive ? 'Automatic delivery' : program.status === 'closed' ? 'Distribution closed' : program.onCurve ? 'On curve' : 'Awaiting migration')}</span>${program.claimActive ? `<div class="directory-wallet-allocation"><small>Your allocation</small><b>${appState.escapeHtml(appState.directoryWalletAmount(program))}</b></div>` : ''}<div class="token-card-actions">${appState.tokenCardWatchMarkup(program.id, program.symbol)}${appState.tokenCardShareMarkup(program.id, program.symbol, program.name)}${curveTab ? '' : `<button type="button" class="secondary-button directory-claim" data-directory-mint="${safeMint}" aria-controls="airdrop-selected-program" aria-expanded="${selectedMint === program.id}" ${checking ? 'disabled' : ''}>${appState.connectedWalletAddress && program.claimActive ? 'Allocation pending' : 'View airdrop'}</button>`}</div></div>
      </article>`;
    }).join('') || `<div class="empty-state">${appState.verifiedLaunchPoliciesStatus !== 'ready' ? '-' : query ? 'No airdrops match your search.' : appState.airdropDirectoryStatus === 'distributed' ? 'No completed airdrops yet.' : appState.airdropDirectoryStatus === 'curve' && list.dataset.stagesStatus !== 'ready' ? '-' : appState.airdropDirectoryStatus === 'curve' ? 'No coins on curve yet.' : 'No airdrops yet.'}</div>`;
    if (focusedMint) {
      const replacement = [...list.querySelectorAll('[data-directory-mint]')].find(button =>
        button.dataset.directoryMint === focusedMint && !button.disabled && button.getClientRects().length);
      if (replacement) replacement.focus({ preventScroll: true });
      else {
        const search = document.querySelector('#airdrop-search');
        if (search?.getClientRects().length) search.focus();
      }
    }
    appState.loadVerifiedTokenLogos(list);
    if (appState.connectedWalletAddress
      && appState.requestedPageRoute?.() === 'airdrops' && !document.hidden) {
      for (const program of filtered.slice(first, first + appState.AIRDROP_DIRECTORY_PAGE_SIZE)) {
        if (!program.claimPublished) continue;
        void appState.loadCommunityAllocation(program.id).catch(() => {});
      }
    }
    const pagination = document.querySelector('#airdrop-directory-pagination');
    if (pagination) {
      pagination.hidden = false;
      pagination.querySelector('[data-airdrop-page="prev"]').disabled = appState.airdropDirectoryPage <= 1;
      pagination.querySelector('[data-airdrop-page="next"]').disabled = appState.airdropDirectoryPage >= totalPages;
      pagination.querySelector('#airdrop-directory-range').textContent = filtered.length ? `${first + 1}–${Math.min(first + appState.AIRDROP_DIRECTORY_PAGE_SIZE, filtered.length)} of ${filtered.length} · page ${appState.airdropDirectoryPage} / ${totalPages}` : '0 indexed';
    }
  }
  // app-source-end

  // app-source: 332
  function renderAirdropProgramDetail(program, { preserveStatus = false, open = false } = {}){
    return appState.renderAirdropProgramDetailView(program, { connectedWalletAddress: appState.connectedWalletAddress, communityClaimPolicy: appState.communityClaimPolicy, wallet: appState.wallet, APP_EXPLORER_QUERY: appState.APP_EXPLORER_QUERY, preserveStatus, open }, { formatTokenAmount: appState.formatTokenAmount, formatVerifiedAirdropAmount: appState.formatVerifiedAirdropAmount });
  }
  // app-source-end

  return { getAirdropPrograms, airdropClaimRate, currentCommunityClaimSummary, renderAirdropSummary, directoryWalletAmount, updateDirectoryWalletAmount, renderAirdropDirectory, renderAirdropProgramDetail };
}
