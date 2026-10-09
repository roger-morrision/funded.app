// Dependencies and mutable application state are read live through appState.
export function createAirdropReportingController(appState) {
  // app-source: 337
  function renderAirdropAnalytics(){
    return appState.renderAirdropAnalyticsView({ indexedClaimers: appState.indexedClaimers, demoAirdropNotifications: appState.demoAirdropNotifications, demoAirdropHistory: appState.demoAirdropHistory }, { formatTokenAmount: appState.formatTokenAmount, getAirdropPrograms: appState.getAirdropPrograms, airdropClaimRate: appState.airdropClaimRate, loadVerifiedTokenLogos: appState.loadVerifiedTokenLogos, getVerifiedUnclaimedWallets: appState.getVerifiedUnclaimedWallets });
  }
  // app-source-end

  // app-source: 338
  function getVerifiedUnclaimedWallets(){
    return appState.demoUnclaimedWallets.filter(item => item.snapshotVerified === true && Number(item.eligible) > Number(item.claimed));
  }
  // app-source-end

  // app-source: 339
  function exportAirdropCsv(){
    const verifiedWallets = appState.getVerifiedUnclaimedWallets();
    if (!verifiedWallets.length) {
      appState.showToast('No verified eligibility snapshot or unclaimed wallets are available to export');
      return;
    }
    const rows = [['wallet', 'program', 'eligible', 'claimed', 'unclaimed', 'status'], ...verifiedWallets.map(item => [item.wallet, item.program, item.eligible, item.claimed, item.eligible - item.claimed, item.status])];
    const csv = rows.map(row => row.map(value => `"${String(value).replaceAll('"', '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'funded-airdrop-unclaimed-wallets.csv';
    link.hidden = true;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    appState.showToast('Unclaimed wallet CSV exported');
  }
  // app-source-end

  // app-source: 340
  function renderAirdropClaims(filter = appState.activeAirdropFilter){
    appState.activeAirdropFilter = filter;
    const list = document.querySelector('#airdrop-claim-list');
    const previewClaimed = Boolean(appState.getPreviewClaims()[appState.previewAirdrop.id]);
    const programs = appState.getAirdropPrograms();
    const claims = [
      ...programs.map(program => ({ ...program, state: program.id === appState.previewAirdrop.id && previewClaimed ? 'claimed' : program.claimActive ? 'claimable' : program.status, badge: program.id === appState.previewAirdrop.id ? 'Demo allocation' : 'Policy allocation' })),
    ];
    const filtered = claims.filter(claim => filter === 'all' || claim.state === filter);
    if (list) list.innerHTML = filtered.map(claim => {
      const isPreview = claim.id === appState.previewAirdrop.id;
      const action = claim.state === 'claimable' ? `<button type="button" class="secondary-button claim-action" data-check-community-mint="${appState.escapeHtml(claim.id)}">Check eligibility</button>` : `<button type="button" class="secondary-button claim-action" disabled>${claim.state === 'claimed' ? 'Claim recorded' : claim.vaultVerified ? 'Opens after snapshot' : 'Requires funded vault'}</button>`;
      const amount = claim.walletAllocation == null ? `${appState.formatTokenAmount(claim.reservedTokens)} ${claim.vaultVerified ? 'tokens vaulted' : 'tokens planned'}` : `${appState.formatTokenAmount(claim.walletAllocation)} ${appState.escapeHtml(claim.symbol)}`;
      const detail = isPreview
        ? 'Local interaction preview. No wallet signature or token transfer occurs.'
        : `${claim.allocationPercent}% supply policy allocation · $FUNDED-holder snapshot at migration`;
      return `<article class="token-card-shell claim-card" data-claim-state="${claim.state}" data-logo-mint="${appState.escapeHtml(claim.id)}"><div class="claim-token"><span>${appState.escapeHtml(claim.symbol.slice(0, 1))}</span><div><strong>${appState.escapeHtml(claim.name)}</strong><small>${appState.escapeHtml(claim.symbol)} · ${appState.escapeHtml(claim.badge)}</small></div></div><div class="claim-amount"><span>${claim.state === 'claimed' ? 'Preview result' : claim.walletAllocation == null ? claim.vaultVerified ? 'Verified vault reserve' : 'Policy allocation' : 'Example allocation'}</span><strong>${amount}</strong></div><p>${detail}</p><div class="token-card-actions claim-token-actions">${!isPreview ? `${appState.tokenCardWatchMarkup(claim.id, claim.symbol)}${appState.tokenCardShareMarkup(claim.id, claim.symbol, claim.name)}` : ''}${action}</div></article>`;
    }).join('') || `<div class="empty-state">${appState.verifiedLaunchPoliciesStatus === 'loading' ? 'Checking published allocations…' : appState.verifiedLaunchPoliciesStatus === 'unavailable' ? 'Launch registry unavailable; claim availability cannot be verified.' : 'No claims match this filter.'}</div>`;
    if (list) appState.loadVerifiedTokenLogos(list);
    document.querySelectorAll('[data-airdrop-filter]').forEach(button => button.classList.toggle('active', button.dataset.airdropFilter === filter));
    const state = document.querySelector('#claim-wallet-state');
    if (state) state.textContent = appState.connectedWalletAddress ? `Wallet ${appState.connectedWalletAddress.slice(0, 4)}…${appState.connectedWalletAddress.slice(-4)} connected. Check an open claim for your verified allocation.` : 'Connect your wallet to check open Solana claims.';
    const count = document.querySelector('#claim-program-count');
    if (count) count.textContent = appState.verifiedLaunchPoliciesStatus === 'ready'
      ? `${programs.length} ${programs.length === 1 ? 'airdrop' : 'airdrops'}`
      : appState.verifiedLaunchPoliciesStatus === 'loading' ? 'Checking airdrops…' : 'Airdrops unavailable';
    appState.renderAirdropSummary(programs);
    appState.renderAirdropDirectory(programs);
    appState.renderAirdropAnalytics();
  }
  // app-source-end

  return { renderAirdropAnalytics, getVerifiedUnclaimedWallets, exportAirdropCsv, renderAirdropClaims };
}
