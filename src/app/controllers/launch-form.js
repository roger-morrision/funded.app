// Dependencies and mutable application state are read live through appState.
export function createLaunchFormController(appState) {
  // app-source: 641
  function setLaunchStep(step){
    const target = Math.min(2, Math.max(1, Number(step) || 1));
    if (target > appState.launchStep) {
      for (let previous = 1; previous < target; previous++) {
        const state = appState.getLaunchStepState(previous);
        if (!state.valid) {
          document.querySelector('#wizard-hint').textContent = state.message;
          const invalid = state.field && document.querySelector(state.field);
          for (let details = invalid?.closest('details'); details; details = details.parentElement?.closest('details')) details.open = true;
          if (invalid && invalid.getClientRects().length) {
            if (invalid.matches('#token-name, #token-symbol')) {
              invalid.dataset.launchTouched = 'true';
              appState.updateLaunchIdentityWarnings();
            } else {
              invalid.setAttribute('aria-invalid','true');
              const described = new Set((invalid.getAttribute('aria-describedby') || '').split(' ').filter(Boolean));
              described.add('wizard-hint'); invalid.setAttribute('aria-describedby',[...described].join(' '));
              invalid.addEventListener('input',()=>invalid.removeAttribute('aria-invalid'),{once:true});
            }
            invalid.focus();
          } else document.querySelector('#wizard-hint').focus();
          return;
        }
      }
    }
    appState.launchStep = target;
    const page = document.querySelector('#launch-dialog');
    page.dataset.step = String(appState.launchStep);
    document.querySelectorAll('[data-launch-step]').forEach(panel => {
      const active = Number(panel.dataset.launchStep) === appState.launchStep;
      panel.hidden = !active;
      panel.classList.toggle('active', active);
    });
    document.querySelectorAll('[data-launch-step-target]').forEach(button => {
      const target = Number(button.dataset.launchStepTarget);
      button.classList.toggle('active', target === appState.launchStep);
      button.classList.toggle('complete', target < appState.launchStep);
      if (target === appState.launchStep) button.setAttribute('aria-current', 'step');
      else button.removeAttribute('aria-current');
    });
    appState.updateLaunchPreview();
    appState.updateLaunchButton();
    window.dispatchEvent(new CustomEvent('funded:launch-step', {detail: {step: appState.launchStep}}));
    const heading = page.querySelector('[data-launch-step="' + appState.launchStep + '"] h3');
    if (heading && location.hash === '#launch') { heading.tabIndex = -1; heading.focus({preventScroll:true}); heading.scrollIntoView({block:'start',behavior:'instant'}); }
  }
  // app-source-end

  // app-source: 642
  function setLaunchMode(mode){
    appState.launchMode = mode === 'custom' ? 'custom' : 'quick';
    const custom = appState.launchMode === 'custom';
    appState.setLaunchProfile(custom ? 'community' : 'fast');
    document.querySelector('#custom-policy').hidden = !custom;
    document.querySelector('#launch-mode-quick').classList.toggle('active', !custom);
    document.querySelector('#launch-mode-quick').setAttribute('aria-pressed', String(!custom));
    document.querySelector('#launch-mode-custom').classList.toggle('active', custom);
    document.querySelector('#launch-mode-custom').setAttribute('aria-pressed', String(custom));
    if (!custom) {
      document.querySelector('#creator-wallet-share').value = '80';
      document.querySelector('#holder-airdrop-share').value = '0';
      document.querySelector('#x-share').value = '0';
      document.querySelector('#x-recipient').value = '';
      document.querySelector('#x-recipient').disabled = true;
    }
    appState.updateLaunchPolicyControls();
  }
  // app-source-end

  // app-source: 643
  function launchFormSnapshot(){
    const value = id => document.getElementById(id)?.value || '';
    return {
      profile: appState.launchProfile, mode: appState.launchMode, tier: appState.launchBurnTier,
      name: value('token-name').trim(), symbol: value('token-symbol').trim().toUpperCase(),
      description: value('token-description'), tagline: value('token-tagline'), roadmap: value('token-roadmap'),
      website: value('token-website').trim(), x: value('token-x').trim(), telegram: value('token-telegram').trim(), discord: value('token-discord').trim(),
      communityTokens: Number(value('community-airdrop-tokens')), creatorBuySol: Number(value('creator-buy-sol')),
      creatorWalletPercent: Number(value('creator-wallet-share')), holderAirdropPercent: Number(value('holder-airdrop-share')),
      solClaimPercent: Number(value('x-share')), xRecipient: appState.normalizeXHandle(value('x-recipient')),
    };
  }
  // app-source-end

  // app-source: 644
  function setLaunchProfile(profile){
    appState.launchProfile = profile === 'fast' ? 'fast' : 'community';
    document.querySelectorAll('[data-launch-profile]').forEach(card => {
      const active = card.dataset.launchProfile === appState.launchProfile;
      card.classList.toggle('active', active);
      card.setAttribute('aria-pressed', String(active));
    });
    const pageDetails = document.querySelector('.launch-page-details');
    if (appState.launchProfile === 'community') {
      if (pageDetails) pageDetails.open = true;
      const story = document.querySelector('.launch-optional-story');
      if (story) story.open = true;
      const advanced = document.querySelector('#launch-advanced-options, .launch-fee-options');
      if (advanced?.matches('details')) advanced.open = true;
    }
    const hint = document.querySelector('#wizard-hint');
    if (hint && appState.launchStep === 1 && !document.querySelector('#token-name')?.value.trim()) {
      hint.textContent = appState.launchProfile === 'fast' ? 'Quick setup: your 80% creator share goes to your wallet. Add a name and ticker.' : 'Community setup: choose holder and X rewards in Launch settings.';
    }
  }
  // app-source-end

  return { setLaunchStep, setLaunchMode, launchFormSnapshot, setLaunchProfile };
}
