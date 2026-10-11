import { initializeAppState } from '../runtime.js';

export function initializeExploreFiltersActions(appState) {
  // app-source: 810
  document.querySelector('#home-launch-grid')?.addEventListener('click', async event => {
    const copy = event.target.closest('.home-launch-copy-address');
    if (copy) {
      event.preventDefault();
      event.stopPropagation();
      try {
        await navigator.clipboard.writeText(copy.dataset.copyAddress);
        appState.showToast(copy.dataset.copyKind === 'creator' ? 'Creator wallet address copied' : 'Token address copied');
      } catch {
        appState.showToast('Could not copy address');
      }
      return;
    }
    const boost = event.target.closest('[data-boost-mint]');
    if (boost) { appState.openExploreBoost(boost.dataset.boostMint); return; }
    const trade = event.target.closest('[data-trade-mint]');
    if (trade) appState.openExploreTrade(trade.dataset.tradeMint);
  });
  // app-source-end

  // app-source: 811
  document.addEventListener('click', async event => {
    const copy = event.target.closest('.token-card-copy-address, .home-launch-copy-address');
    if (!copy) return;
    event.preventDefault();
    event.stopPropagation();
    try {
      await navigator.clipboard.writeText(copy.dataset.copyAddress);
      appState.showToast(copy.dataset.copyKind === 'creator' ? 'Creator wallet address copied' : 'Token address copied');
    } catch {
      appState.showToast('Could not copy address');
    }
  }, true);
  // app-source-end

  // app-source: 812
  document.querySelector('#airdrop-claim-list')?.addEventListener('click', event => {
    const live = event.target.closest('[data-check-community-mint]');
    if (live) {
      const program = appState.getAirdropPrograms().find(row => row.id === live.dataset.checkCommunityMint);
      if (program) { appState.renderAirdropProgramDetail(program); void appState.checkCommunityClaim(program.id).catch(error => appState.showToast(String(error.message || error))); }
      return;
    }
    const button = event.target.closest('[data-preview-claim]');
    if (!button) return;
    const claims = appState.getPreviewClaims();
    claims[button.dataset.previewClaim] = { claimedAt: new Date().toISOString(), mode: 'local-preview' };
    localStorage.setItem(appState.AIRDROP_PREVIEW_CLAIM_KEY, JSON.stringify(claims));
    appState.renderAirdropClaims();
    appState.showToast('Claim preview completed — no tokens were transferred');
  });
  // app-source-end

  // app-source: 813
  document.querySelectorAll('[data-airdrop-filter]').forEach(button => button.addEventListener('click', () => appState.renderAirdropClaims(button.dataset.airdropFilter)));
  // app-source-end

  // app-source: 814
  document.querySelector('#airdrop-search')?.addEventListener('input', () => {
    document.querySelector('#airdrop-selected-program').hidden = true;
    appState.airdropDirectoryPage = 1;
    appState.renderAirdropDirectory();
  });
  // app-source-end

  // app-source: 815
  document.addEventListener('funded:airdrop-directory-status', event => {
    if (!['all','curve','claiming'].includes(event.detail?.status)) return;
    appState.airdropDirectoryStatus = event.detail.status;
    appState.airdropDirectoryPage = 1;
    document.querySelector('#airdrop-selected-program').hidden = true;
    appState.renderAirdropDirectory();
  });
  document.addEventListener('funded:token-list-markets', () => appState.renderAirdropDirectory());
  // app-source-end

  // app-source: 816
  document.querySelector('#airdrop-directory-pagination')?.addEventListener('click', event => {
    const button = event.target.closest('[data-airdrop-page]');
    if (!button || button.disabled) return;
    appState.airdropDirectoryPage += button.dataset.airdropPage === 'next' ? 1 : -1;
    document.querySelector('#airdrop-selected-program').hidden = true;
    appState.renderAirdropDirectory();
  });
  // app-source-end

  // app-source: 817
  document.querySelector('#airdrop-directory')?.addEventListener('click', event => {
    const button = event.target.closest('[data-directory-mint]');
    if (!button) return;
    const program = appState.getAirdropPrograms().find(item => item.id === button.dataset.directoryMint);
    if (!program) return;
    appState.renderAirdropProgramDetail(program);
    if (appState.connectedWalletAddress && program.claimActive)
      void appState.checkCommunityClaim(program.id).catch(error => appState.showToast(String(error.message || error)));
    document.querySelector('#airdrop-selected-program')?.scrollIntoView({ block: 'start' });
  });
  // app-source-end

  // app-source: 818
  document.querySelector('#airdrop-detail-close')?.addEventListener('click', () => { document.querySelector('#airdrop-selected-program').hidden = true; });
  // app-source-end

  // app-source: 819
  document.querySelector('#airdrop-selected-status')?.addEventListener('click', event => {
    const button = event.target.closest('[data-fund-community-mint]');
    if (button) void appState.fundCommunityReserve(button.dataset.fundCommunityMint);
    const check = event.target.closest('[data-check-community-mint]');
    if (check) void appState.checkCommunityClaim(check.dataset.checkCommunityMint).catch(error => appState.showToast(String(error.message || error)));
    const claim = event.target.closest('[data-claim-community-mint]');
    if (claim) void appState.submitCommunityClaim(claim.dataset.claimCommunityMint);
  });
  // app-source-end

  // app-source: 820
  document.querySelector('#leaderboard-sort')?.addEventListener('change', () => appState.renderAirdropAnalytics());
  // app-source-end

  // app-source: 821
  document.querySelector('#leaderboard-private')?.addEventListener('change', () => appState.renderAirdropAnalytics());
  // app-source-end

  // app-source: 822
  document.querySelector('#airdrop-export-csv')?.addEventListener('click', appState.exportAirdropCsv);
  // app-source-end

  // app-source: 823
  document.querySelector('#buyback-add-claim')?.addEventListener('click', appState.recordBuybackPreviewClaim);
  // app-source-end

  // app-source: 824
  document.querySelector('#buyback-run-preview')?.addEventListener('click', appState.runBuybackPreview);
  // app-source-end

  // app-source: 825
  document.querySelector('#buyback-example-fees')?.addEventListener('input', appState.renderBuybackExample);
  // app-source-end

  // app-source: 826
  document.querySelector('#funded-burn-amount')?.addEventListener('input', appState.updateFundedBurnButton);
  // app-source-end

  // app-source: 827
  document.querySelector('#funded-burn-submit')?.addEventListener('click', appState.submitFundedBurn);
  // app-source-end

  // app-source: 828
  document.querySelector('#funded-buy-amount')?.addEventListener('input', () => { appState.fundedBuyPreview = null; appState.renderFundedBuyControl('Preview the current Solana pool quote before signing.'); });
  // app-source-end

  // app-source: 829
  document.querySelector('#funded-buy-submit')?.addEventListener('click', appState.handleFundedBuy);
  // app-source-end

  // app-source: 830
  document.querySelector('#referral-example-input').addEventListener('input', event => {
    const fees = Math.max(0, Number(event.target.value) || 0);
    const fundedRevenue = fees * appState.APP_ECONOMICS.fundedSharePercent / 100;
    appState.APP_ECONOMICS.appReferralLevels.forEach(level => {
      const output = document.querySelector(`#referral-level-${level.level}-output`);
      if (output) output.textContent = `$${(fundedRevenue * level.percentOfFundedRevenue / 100).toFixed(2)}`;
    });
  });
  // app-source-end

  // app-source: 831
  document.querySelector('#fee-flow-input')?.addEventListener('input', appState.renderFeeFlowCalculator);
  // app-source-end

  // app-source: 832
  document.querySelector('#launch-list').addEventListener('click', async event => {
    const tierInfo = event.target.closest('[data-tier-info-mint]');
    if (tierInfo) { appState.openExploreTierInfo(tierInfo.dataset.tierInfoMint); return; }
    const boost = event.target.closest('[data-boost-mint]');
    if (boost) { appState.openExploreBoost(boost.dataset.boostMint); return; }
    const watch = event.target.closest('.scanner-watch');
    if (watch) { appState.toggleExploreWatch(watch.dataset.mint, watch); return; }
    const copy = event.target.closest('.copy-row');
    if (copy) {
      try { await navigator.clipboard.writeText(copy.dataset.mint); appState.showToast('Mint address copied'); } catch { appState.showToast(copy.dataset.mint); }
      return;
    }
  });
  // app-source-end

  // app-source: 833
  document.querySelector('#explore-tier-close')?.addEventListener('click', () => document.querySelector('#explore-tier-dialog')?.close());
  // app-source-end

  // app-source: 834
  document.querySelector('#explore-boost-close')?.addEventListener('click', () => document.querySelector('#explore-boost-dialog')?.close());
  // app-source-end

  // app-source: 835
  document.querySelector('#explore-boost-dialog')?.addEventListener('click', event => {
    const option = event.target.closest('[data-boost-package]');
    if (option && !appState.boostCheckout.busy && !appState.boostCheckout.pendingSignature) {
      appState.boostCheckout.packageId = option.dataset.boostPackage;
      appState.boostCheckout.quote = null;
      appState.boostCheckout.message = '';
      appState.renderExploreBoostDialog();
      return;
    }
    if (event.target.closest('.explore-boost-pay')) void appState.handleExploreBoostPay();
  });
  // app-source-end

  // app-source: 838
  document.querySelectorAll('.filter').forEach(button => button.addEventListener('click', () => appState.openFilterDialog(button)));
  // app-source-end

  // app-source: 839
  document.querySelectorAll('.recipient-chip').forEach(button => button.addEventListener('click', () => { button.parentElement.querySelector('.active')?.classList.remove('active'); button.classList.add('active'); appState.showToast(`${button.textContent} recipients selected`); }));
  // app-source-end

  // app-source: 840
  document.querySelector('#filter-close').addEventListener('click', () => appState.closeDialog('filter-dialog'));
  // app-source-end

  // app-source: 841
  document.querySelector('#notifications-button').addEventListener('click', () => document.querySelector('#notification-dialog').showModal());
  // app-source-end

  // app-source: 842
  document.querySelector('#capital-flow .icon-button')?.addEventListener('click', () => appState.openInfoDialog('capital'));
  // app-source-end

  // app-source: 843
  const DESKTOP_SIDEBAR_KEY = 'funded.desktop-sidebar-collapsed';
  initializeAppState(appState, 'DESKTOP_SIDEBAR_KEY', DESKTOP_SIDEBAR_KEY);
  // app-source-end

  // app-source: 844
  const desktopSidebarToggle = document.querySelector('#desktop-sidebar-toggle');
  initializeAppState(appState, 'desktopSidebarToggle', desktopSidebarToggle);
  // app-source-end

  // app-source: 845
  const desktopNavLinks = [...document.querySelectorAll('#sidebar .nav-item, #sidebar .profile-row')];
  initializeAppState(appState, 'desktopNavLinks', desktopNavLinks);
  // app-source-end

  // app-source: 846
  for (const link of appState.desktopNavLinks) {
    const label = link.classList.contains('profile-row') ? 'Wallet profile' : [...link.childNodes]
      .filter(node => node.nodeType === Node.TEXT_NODE).map(node => node.textContent.trim()).filter(Boolean).join(' ');
    if (label) link.title = label;
  }
  // app-source-end
}
