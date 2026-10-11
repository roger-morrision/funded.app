import { initializeAppState } from '../runtime.js';

// Startup runs in the order declared in start.js.
export function initializeLaunchActions(appState) {
  // app-source: 664
  window.addEventListener('funded:recover-registration',async event=>{
    const report=message=>window.dispatchEvent(new CustomEvent('funded:recovery-result',{detail:message}));
    try{
      const {mint,id}=event.detail||{};const row=appState.readLaunchJournal().find(r=>r.id===id&&r.mint===mint&&r.state==='registration-pending');
      if(!row||row.cluster!=='devnet')throw new Error('No pending Solana registration matches this request.');
      const policy=JSON.parse(localStorage.getItem(`funded.launch.${mint}`)||'null');if(!appState.policyMatchesJournal(policy,row))throw new Error('Saved policy does not match this launch. Do not recreate the coin.');
      const session=appState.captureWalletSession();if(!session||session.address!==row.payer)throw new Error('Connect the original launch wallet before registration.');appState.assertWalletSessionCurrent(session);
      if(!policy.policySignature){if(typeof session.provider.signMessage!=='function')throw new Error('This wallet must support message signing.');const signed=await session.provider.signMessage(new TextEncoder().encode(appState.launchPolicyStatement(policy)));appState.assertWalletSessionCurrent(session);policy.policySignature=appState.bs58.encode(signed.signature||signed);localStorage.setItem(`funded.launch.${mint}`,JSON.stringify(policy));}
      report('Checking the original launch and policy with the API. No coin transaction is being sent.');
      const result=await appState.apiRequest('/api/launches',{method:'POST',body:policy});if(!result.available||result.data?.mint!==mint||!result.data?.onchainVerified)throw new Error('Registration is still pending verified API evidence.');
      if (appState.verifiedPilotLaunchRegistration(result, mint)) appState.emitPilotSignal('launch-confirmed');
      appState.recordLaunchEvent(id,{state:'completed'});report('Original launch registered. No duplicate launch was created.');void appState.loadVerifiedLaunchPolicies();
    }catch(error){report(error.message);}
  });
  // app-source-end

  // app-source: 665
  document.querySelector('#connect-button').onclick = appState.connectWallet;
  // app-source-end

  // app-source: 666
  document.querySelector('#profile-connect')?.addEventListener('click', () => {
    if (appState.connectedWalletAddress) document.querySelector('#profile-dialog')?.showModal();
    else void appState.connectWallet();
  });
  // app-source-end

  // app-source: 667
  document.addEventListener('click', event => {
    const button = event.target.closest('button');
    if (!button || !/^connect wallet/i.test(button.textContent.trim())) return;
    if (['connect-button', 'profile-connect', 'coin-trade-button', 'trade-submit', 'launch-button', 'airdrop-button', 'sol-claim-submit'].includes(button.id)) return;
    event.preventDefault();
    appState.connectWallet();
  });
  // app-source-end

  // app-source: 668
  document.querySelector('#mobile-wallet-close')?.addEventListener('click', appState.mobileWallet.cancel);
  // app-source-end

  // app-source: 669
  document.querySelector('#mobile-wallet-copy')?.addEventListener('click', appState.mobileWallet.copyLink);
  // app-source-end

  // app-source: 670
  document.querySelector('#launch-close').addEventListener('click', () => {
    appState.requestPageRouteFocus();
    location.hash = '#overview';
    appState.launchOpener=null;
  });
  // app-source-end

  // app-source: 671
  document.querySelector('#airdrop-button').addEventListener('click', appState.requestAirdrop);
  // app-source-end

  // app-source: 672
  document.querySelector('#launch-review-retry')?.addEventListener('click', async () => {
    if (appState.developerBuyLimitReached()) {
      document.querySelector('#creator-buy-sol')?.focus();
      return;
    }
    if (!appState.feeRouterState.verified) await appState.refreshFeeRouterConfig();
    else if (appState.wallet) await appState.refreshWalletInfo();
    appState.updateLaunchNavigation();
  });
  // app-source-end

  // app-source: 673
  document.querySelectorAll('#token-name, #token-symbol, #token-description, #token-tagline, #token-roadmap, #token-website, #token-x, #token-telegram, #token-discord, #x-recipient, #community-airdrop-tokens, #creator-buy-sol').forEach(input => input.addEventListener('input', () => {
    if (input.matches('#token-name, #token-symbol')) { input.dataset.launchTouched = 'true'; appState.updateLaunchIdentityWarnings(); }
    if (appState.LAUNCH_SOCIAL_FIELDS.includes(input.id)) appState.updateLaunchSocialValidity(input);
    if (input.matches('#community-airdrop-tokens')) appState.syncCommunityAirdropPresets();
    if (input.matches('#token-name, #token-symbol, #creator-buy-sol')) appState.scheduleLaunchCostRefresh();
    appState.updateLaunchPreview();
    appState.updateCostSummary();
    appState.updateLaunchButton();
  }));
  // app-source-end

  // app-source: 674
  document.querySelectorAll('#token-name, #token-symbol').forEach(input => input.addEventListener('blur', () => {
    input.dataset.launchTouched = 'true';
    appState.updateLaunchIdentityWarnings();
  }));
  // app-source-end

  // app-source: 675
  document.querySelector('#token-x')?.addEventListener('change', event => {
    appState.normalizeLaunchSocialField(event.currentTarget);
    appState.updateLaunchSocialValidity(event.currentTarget);
    appState.updateLaunchPreview();
    appState.updateLaunchButton();
  });
  // app-source-end

  // app-source: 676
  document.querySelectorAll('[data-airdrop-tokens]').forEach(button => button.addEventListener('click', () => {
    const input = document.querySelector('#community-airdrop-tokens');
    if (!input) return;
    input.value = button.dataset.airdropTokens;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }));
  // app-source-end

  // app-source: 677
  let imagePreparationRevision = 0;
  initializeAppState(appState, 'imagePreparationRevision', imagePreparationRevision);
  // app-source-end

  // app-source: 678
  document.querySelector('#token-image')?.addEventListener('change', async event => {
    const revision = ++appState.imagePreparationRevision;
    const file = event.target.files?.[0];
    const preview = document.querySelector('#token-image-preview');
    const cardPreview = document.querySelector('#preview-token-image');
    const cardPlaceholder = document.querySelector('#preview-token-image-placeholder');
    const packageArtwork = document.querySelector('#launch-package-example-art');
    if (!preview) return;
    const status=document.querySelector('#image-preparation-status');
    const removeButton=document.querySelector('#image-remove');
    if(removeButton)removeButton.disabled=!file;
    preview.style.backgroundImage='';preview.textContent=file?'…':'⌁';if(cardPreview){cardPreview.style.backgroundImage='';cardPreview.classList.remove('has-image');}if(packageArtwork){packageArtwork.style.backgroundImage='';packageArtwork.classList.remove('has-image');}if(cardPlaceholder)cardPlaceholder.hidden=false;if(status)status.textContent=file?'Preparing locally. Nothing is uploaded yet.':'No image selected.';
    try{const image=await appState.prepareLaunchImage(file,{crop:document.querySelector('#image-square-crop')?.checked});if(revision!==appState.imagePreparationRevision||file!==event.target.files?.[0])return;if(image){preview.textContent='';preview.style.backgroundImage=`url(${image.url})`;if(cardPreview){cardPreview.style.backgroundImage=`url(${image.url})`;cardPreview.classList.add('has-image');}if(packageArtwork){packageArtwork.style.backgroundImage=`url(${image.url})`;packageArtwork.classList.add('has-image');}if(cardPlaceholder)cardPlaceholder.hidden=true;if(status)status.textContent=`Ready: ${image.width} × ${image.height}, ${Math.ceil(image.file.size/1000)} KB. Review the preview before signing.`;}}
    catch(error){if(revision!==appState.imagePreparationRevision||file!==event.target.files?.[0])return;await appState.prepareLaunchImage(null);event.target.value='';if(removeButton)removeButton.disabled=true;if(status)status.textContent=error.message;preview.textContent='!';}
    appState.updateLaunchPreview();appState.updateLaunchButton();
  });
  let bannerPreparationRevision = 0;
  document.querySelector('#token-banner')?.addEventListener('change', async event => {
    const revision = ++bannerPreparationRevision;
    const file = event.target.files?.[0];
    const preview = document.querySelector('#token-banner-preview');
    const status = document.querySelector('#token-banner-status');
    const remove = document.querySelector('#token-banner-remove');
    if (preview) { preview.hidden = true; preview.style.backgroundImage = ''; }
    if (status) status.textContent = file ? 'Preparing banner…' : 'No banner selected.';
    if (remove) remove.hidden = !file;
    try {
      const banner = await appState.prepareLaunchBanner(file);
      if (revision !== bannerPreparationRevision || file !== event.target.files?.[0]) return;
      if (banner) {
        if (preview) { preview.style.backgroundImage = `url("${banner.url}")`; preview.hidden = false; }
        if (status) status.textContent = `Ready: ${banner.width} × ${banner.height}, ${Math.ceil(banner.file.size / 1000)} KB. Review before signing.`;
      }
    } catch (error) {
      if (revision !== bannerPreparationRevision || file !== event.target.files?.[0]) return;
      await appState.prepareLaunchBanner(null);
      event.target.value = '';
      if (remove) remove.hidden = true;
      if (status) status.textContent = error.message;
    }
    appState.updateLaunchPreview(); appState.updateLaunchButton();
  });
  document.querySelector('#token-banner-remove')?.addEventListener('click', () => {
    const input = document.querySelector('#token-banner');
    if (!input) return;
    input.value = '';
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  // app-source-end

  // app-source: 679
  document.querySelector('#terms-agree').addEventListener('change', appState.updateLaunchButton);
  // app-source-end

  // app-source: 680
  document.querySelector('#fee-route-agree').addEventListener('change', appState.updateLaunchButton);
  // app-source-end

  // app-source: 681
  document.querySelector('#launch-next').addEventListener('click', () => appState.setLaunchStep(appState.launchStep + 1));
  // app-source-end

  // app-source: 682
  document.querySelector('#launch-back').addEventListener('click', () => appState.setLaunchStep(appState.launchStep - 1));
  // app-source-end

  // app-source: 683
  document.querySelector('#launch-mode-quick').addEventListener('click', () => appState.setLaunchMode('quick'));
  // app-source-end

  // app-source: 684
  document.querySelector('#launch-mode-custom').addEventListener('click', () => appState.setLaunchMode('custom'));
  // app-source-end

  // app-source: 685
  document.querySelectorAll('[data-launch-profile]').forEach(card => card.addEventListener('click', () => appState.setLaunchMode(card.dataset.launchProfile === 'community' ? 'custom' : 'quick')));
  // app-source-end

  // app-source: 686
  appState.setLaunchProfile('fast');
  // app-source-end

  // app-source: 687
  document.querySelectorAll('.creator-burn-card[data-burn-tier]').forEach(button => button.addEventListener('click', () => appState.setLaunchBurnTier(button.dataset.burnTier)));
  // app-source-end

  // app-source: 688
  document.querySelector('#launch-tier-refresh')?.addEventListener('click', async () => {
    await Promise.allSettled([appState.refreshLaunchTierPricing(), appState.loadFundedBurnState({ force:true })]);
    if (appState.wallet) appState.scheduleLaunchCostRefresh();
  });
  // app-source-end

  // app-source: 689
  document.querySelectorAll('[data-launch-step-target]').forEach(button => button.addEventListener('click', () => { const target = Number(button.dataset.launchStepTarget); appState.setLaunchStep(target); }));
  // app-source-end

  // app-source: 690
  document.querySelectorAll('[data-copy-referral-link]').forEach(button => button.addEventListener('click', async () => { const code = await appState.referralCodeForShare(); if (!code) return; const link = appState.buildReferralUrl(code); try { await navigator.clipboard.writeText(link); appState.trackReferralEvent('invite_link_copied'); appState.showToast('Invite link copied'); } catch { appState.showToast(link); } }));
  // app-source-end

  // app-source: 691
  document.querySelector('#referral-share-native')?.addEventListener('click', async () => { const code = await appState.referralCodeForShare(); if (!code) return; appState.openShareComposer({ kind:'referral', title:'Join funded.vip', text:'Explore verified launches and published fee routes with me on funded.vip.', url:appState.buildReferralUrl(code) }); });
  // app-source-end

  // app-source: 692
  document.querySelector('#referral-copy-code')?.addEventListener('click', async () => { const code = await appState.referralCodeForShare(); if (!code) return; try { await navigator.clipboard.writeText(code); appState.showToast('Referral code copied'); } catch { appState.showToast(code); } });
  // app-source-end

  // app-source: 693
  document.querySelectorAll('[data-referral-campaign]').forEach(button => button.addEventListener('click', async () => { const code = await appState.referralCodeForShare(); if (!code) return; const channel = button.dataset.referralCampaign; const link = appState.buildReferralUrl(code, channel); try { await navigator.clipboard.writeText(link); appState.trackReferralEvent('campaign_link_copied', { channel }); appState.showToast(`${channel} campaign link copied`); } catch { appState.showToast(link); } }));
  // app-source-end

  // app-source: 695
  document.querySelectorAll('[data-role]').forEach(button => button.addEventListener('click', () => {
    document.querySelectorAll('[data-role]').forEach(item => item.classList.toggle('active', item === button));
    const target = { creator: '#launch', referrer: '#referrals', community: '#airdrops' }[button.dataset.role];
    localStorage.setItem('funded.app.workspace.role', button.dataset.role);
    document.querySelector(target)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }));
  // app-source-end

  // app-source: 696
  document.querySelectorAll('.referral-share-row').forEach(row => {
    const actions = document.createElement('div');
    actions.className = 'referral-share-actions';
    const shareButton = document.createElement('button');
    shareButton.type = 'button'; shareButton.className = 'secondary-button'; shareButton.textContent = 'Share';
    shareButton.addEventListener('click', async () => {
      const code = await appState.referralCodeForShare();
      if (!code) return;
      appState.openShareComposer({ kind:'referral', title:'Join funded.vip', text:'Explore verified launches and published fee routes with me on funded.vip.', url:appState.buildReferralUrl(code) });
    });
    const messageButton = document.createElement('button');
    messageButton.type = 'button'; messageButton.className = 'secondary-button'; messageButton.textContent = 'Copy message';
    messageButton.addEventListener('click', async () => {
      const code = await appState.referralCodeForShare();
      if (!code) return;
      const link = appState.buildReferralUrl(code);
      const message = `Join me on funded.vip to launch a coin: ${link}`;
      try { await navigator.clipboard.writeText(message); appState.trackReferralEvent('invite_message_copied'); appState.showToast('Invite message copied'); } catch { appState.showToast(message); }
    });
    actions.append(shareButton, messageButton); row.append(actions);
  });
  // app-source-end

  // app-source: 697
  const fundedMintInput = document.querySelector('#funded-mint-address');
  initializeAppState(appState, 'fundedMintInput', fundedMintInput);
  // app-source-end

  // app-source: 698
  if (appState.fundedMintInput) { appState.fundedMintInput.value = appState.getFundedMintAddress(); appState.updateFundedMintConfig(); }
  // app-source-end

  // app-source: 700
  document.querySelectorAll('#creator-wallet-share, #holder-airdrop-share, #x-share, #x-recipient').forEach(input => input.addEventListener('input', appState.updateLaunchPolicyControls));
  // app-source-end

  // app-source: 701
  document.querySelectorAll('[data-info]').forEach(link => link.addEventListener('click', event => { event.preventDefault(); appState.openInfoDialog(link.dataset.info); }));
  // app-source-end

  // app-source: 702
  document.querySelector('#info-close').addEventListener('click', appState.closeInfoDialog);
  // app-source-end

  // app-source: 703
  document.querySelector('#info-dialog').addEventListener('cancel', event => {
    event.preventDefault();
    appState.closeInfoDialog();
  });
  // app-source-end

  // app-source: 704
  document.querySelectorAll('[data-close-dialog]').forEach(button => button.addEventListener('click', () => appState.closeDialog(button.dataset.closeDialog)));
  // app-source-end

  // app-source: 705
  document.querySelector('#open-tape').addEventListener('click', () => document.querySelector('#payment-dialog').showModal());
  // app-source-end

  // app-source: 706
  document.querySelector('.notification').addEventListener('click', () => document.querySelector('#notification-dialog').showModal());
  // app-source-end

  // app-source: 707
  document.querySelector('.profile-row').addEventListener('click', event => { event.preventDefault(); document.querySelector('#profile-dialog').showModal(); });
  // app-source-end

  // app-source: 708
  document.querySelector('#profile-disconnect')?.addEventListener('click', async () => {
    await appState.disconnectWallet();
    document.querySelector('#profile-dialog')?.close();
  });
  // app-source-end

  // app-source: 709
  document.querySelector('#wallet-popover-disconnect')?.addEventListener('click', async () => {
    await appState.disconnectWallet();
  });
  // app-source-end

  // app-source: 710
  document.querySelector('#wallet-popover-detail-link')?.addEventListener('click', event => {
    if (!appState.connectedWalletAddress) return;
    event.preventDefault();
    appState.walletDetailTab = 'activity';
    appState.walletDetailFilter = 'all';
    history.pushState({}, '', `/wallet/${encodeURIComponent(appState.connectedWalletAddress)}`);
    appState.showWalletPage();
  });
  // app-source-end

  // app-source: 711
  document.querySelector('#wallet-popover')?.querySelectorAll('a').forEach(link => link.addEventListener('click', () => {
    const popover = document.querySelector('#wallet-popover');
    const trigger = document.querySelector('#connect-button');
    if (popover) popover.hidden = true;
    trigger?.setAttribute('aria-expanded', 'false');
  }));
  // app-source-end

  // app-source: 712
  document.addEventListener('click', event => {
    const popover = document.querySelector('#wallet-popover');
    const trigger = document.querySelector('#connect-button');
    if (!event.isTrusted) return;
    if (!popover || popover.hidden || trigger?.contains(event.target) || popover.contains(event.target)) return;
    popover.hidden = true;
    trigger?.setAttribute('aria-expanded', 'false');
  });
  // app-source-end

  // app-source: 713
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    const popover = document.querySelector('#wallet-popover');
    const trigger = document.querySelector('#connect-button');
    if (!popover || popover.hidden) return;
    popover.hidden = true;
    trigger?.setAttribute('aria-expanded', 'false');
    trigger?.focus();
  });
  // app-source-end

  // app-source: 714
  document.querySelector('#profile-copy-address')?.addEventListener('click', async () => {
    const address = appState.connectedWalletAddress;
    if (!address) return appState.showToast('Connect your wallet to copy its address');
    try { await navigator.clipboard.writeText(address); appState.showToast('Wallet address copied'); } catch { appState.showToast(address); }
  });
  // app-source-end

  // app-source: 715
  document.querySelector('#launch-button').addEventListener('click', appState.handleLaunchAction);
  // app-source-end

  // app-source: 716
  document.querySelector('#launch-review-close')?.addEventListener('click', appState.closeLaunchReview);
  // app-source-end

  // app-source: 717
  document.querySelector('#launch-review-cancel')?.addEventListener('click', appState.closeLaunchReview);
  // app-source-end

  // app-source: 718
  document.querySelector('#launch-review-dialog')?.addEventListener('close', () => { if (appState.pendingLaunchReview) appState.emitPilotSignal('launch-review-cancelled'); appState.pendingLaunchReview = null; });
  // app-source-end

  // app-source: 719
  document.querySelector('#launch-review-confirm')?.addEventListener('click', appState.confirmLaunchReview);
  // app-source-end

  // app-source: 720
  document.querySelector('#simulate-button')?.addEventListener('click', appState.simulateLaunch);
  // app-source-end

  // app-source: 721
  document.querySelector('#trade-submit')?.addEventListener('click', appState.openTradeReview);
  // app-source-end

  // app-source: 722
  document.querySelector('#trade-review-close')?.addEventListener('click', () => document.querySelector('#trade-review-dialog')?.close());
  // app-source-end

  // app-source: 723
  document.querySelector('#trade-review-cancel')?.addEventListener('click', () => document.querySelector('#trade-review-dialog')?.close());
  // app-source-end

  // app-source: 724
  document.querySelector('#trade-review-confirm')?.addEventListener('click', () => {
    document.querySelector('#trade-review-dialog')?.close();
    void appState.executeTrade();
  });
  // app-source-end

  // app-source: 725
  document.querySelector('#sol-claim-submit')?.addEventListener('click', appState.submitSolClaim);
  // app-source-end

  // app-source: 727
  for (const id of ['sol-claim-x-account', 'sol-claim-id']) {
    document.getElementById(id)?.addEventListener('input', () => { appState.updateClaimBindingReview(); appState.resetSolClaimStatus(); });
  }
  // app-source-end

  // app-source: 728
  document.addEventListener('change', event => {
    if (event.target?.id === 'claim-binding-agree') appState.resetSolClaimStatus();
  });
  // app-source-end

  // app-source: 729
  document.querySelector('#trade-side')?.addEventListener('change', appState.updateTradeAmountLabel);
  // app-source-end

  // app-source: 730
  document.querySelectorAll('[data-coin-trade-side]').forEach(button => button.addEventListener('click', () => {
    const side = button.dataset.coinTradeSide;
    const select = document.querySelector('#trade-side');
    if (!select || !['buy', 'sell'].includes(side) || select.value === side) return;
    select.value = side;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    select.dispatchEvent(new Event('input', { bubbles: true }));
    const amount = document.querySelector('#trade-amount');
    if (amount) { amount.value = ''; amount.dispatchEvent(new Event('input', { bubbles: true })); }
    appState.setTradeStatus(`Enter a ${side === 'buy' ? 'SOL' : 'token'} amount to calculate a live quote.`);
  }));
  // app-source-end

  // app-source: 731
  document.querySelectorAll('[data-coin-buy-amount]').forEach(button => button.addEventListener('click', () => {
    if (document.querySelector('#trade-side')?.value !== 'buy') return;
    const amount = document.querySelector('#trade-amount');
    if (!amount) return;
    amount.value = button.dataset.coinBuyAmount;
    amount.dispatchEvent(new Event('input', { bubbles: true }));
    appState.setTradeStatus('Quick amount selected. Calculating a live quote.');
  }));
  // app-source-end

  // app-source: 732
  const coinQuickAmountDefaults = ['0.1', '0.25', '0.5', '1', '2', '5'];
  initializeAppState(appState, 'coinQuickAmountDefaults', coinQuickAmountDefaults);
  // app-source-end

  // app-source: 733
  const coinQuickAmountKey = 'funded.coin-quick-buy-amounts.v1';
  initializeAppState(appState, 'coinQuickAmountKey', coinQuickAmountKey);
  // app-source-end

  // app-source: 734
  const coinQuickAmountButtons = [...document.querySelectorAll('[data-coin-buy-amount]')];
  initializeAppState(appState, 'coinQuickAmountButtons', coinQuickAmountButtons);
  // app-source-end

}
