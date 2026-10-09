// One instance owns the picker listener; wallet state is read only when rendering.
export function initProgramPicker({ isWalletConnected }) {
  const programPreviewData = {
    standard: { name: 'Standard launch', subtitle: 'A calm, accountable first step', progress: '1 of 3 complete', width: '33%', note: 'Connect a wallet to begin your launch review.' },
    pro: { name: 'Pro launch', subtitle: 'For teams ready to move with intent', progress: '2 of 3 complete', width: '78%', note: 'Priority review is available after the published route is confirmed.' },
    premier: { name: 'Premier launch', subtitle: 'Largest project showcase', progress: '2 of 3 complete', width: '88%', note: 'Spotlight review is available after the published route is confirmed.' },
    airdrop: { name: 'Airdrop reserve', subtitle: 'See who is eligible before you claim', progress: '2 of 3 complete', width: '66%', note: 'Review the allocation policy and claim status before connecting.' },
    explore: { name: 'Browse Launch Directory', subtitle: 'Find launches with a visible signal', progress: '1 of 3 complete', width: '33%', note: 'Open the explorer to inspect route, tier, and receipt history.' },
    receipts: { name: 'Receipt center', subtitle: 'Follow value after the launch', progress: '3 of 3 complete', width: '100%', note: 'Every verified event stays linked to its on-chain source.' },
  };
  function programNote(data, tier){
    return tier === 'standard' && isWalletConnected() ? 'Wallet connected. Review the fee route and launch cost before signing.' : data.note;
  }
  const programViews = {
    creator: {
      copy: 'Pick a route, understand the rules, then move into the workspace with the same information in view.',
      cta: 'Open creator launch',
      href: '#launch',
      cards: [
        ['standard', 'STANDARD', 'Start here', 'Launch without the guesswork', 'Core Pump launch, public fee route, and a basic funded.vip X announcement when publishing is active.', '0 $FUNDED', 'Basic X post'],
        ['pro', 'PRO', 'For serious launches', 'Give the launch a stronger signal', 'Pro badge, public burn receipt, and a featured funded.vip X launch post after verification when publishing is active.', '$100 in $FUNDED', 'Featured X post'],
        ['premier', 'PREMIER', 'Largest showcase', 'Put your launch in the spotlight', 'Premier badge, public burn receipt, one funded.vip X launch post and a follow-up after 24 hours when publishing is active.', '$200 in $FUNDED', 'Two X posts'],
      ],
    },
    community: {
      copy: 'Follow the parts of a launch that matter after the mint: allocations, discovery signals, and verified receipts.',
      cta: 'Open community hub',
      href: '#airdrops',
      cards: [
        ['airdrop', 'AIRDROP', 'Claim with context', 'See your community allocation', 'Check eligibility, reserve size, and claim status before signing anything.', '3% MINIMUM', 'Wallet eligibility'],
        ['explore', 'DIRECTORY', 'Discover with signal', 'Find launches worth a closer look', 'Inspect verified routes, launch tiers, and visible commitment signals.', 'LIVE FEED', 'Route + tier'],
        ['receipts', 'RECEIPTS', 'Track what happened', 'Follow every value movement', 'Review the public record from launch through claims, burns, and payouts.', 'ON-CHAIN', 'Source linked'],
      ],
    },
  };
  function renderProgramPreview(tier) {
    const data = programPreviewData[tier] || programPreviewData.standard;
    const name = document.querySelector('#program-preview-name');
    const subtitle = document.querySelector('#program-preview-subtitle');
    const progress = document.querySelector('#program-progress-label');
    const bar = document.querySelector('#program-progress-bar');
    const note = document.querySelector('#program-progress-note');
    if (name) name.textContent = data.name;
    if (subtitle) subtitle.textContent = data.subtitle;
    if (progress) progress.textContent = data.progress;
    if (bar) bar.style.width = data.width;
    if (note) note.textContent = programNote(data, tier);
  }
  function renderProgramView(view = 'creator') {
    const config = programViews[view] || programViews.creator;
    const list = document.querySelector('#program-option-list');
    const copy = document.querySelector('#program-market-copy');
    const cta = document.querySelector('#program-preview-cta');
    if (!list) return;
    list.innerHTML = config.cards.map(([key, label, hint, title, description, stat, meta], index) => `<button type="button" class="program-option${index === 0 ? ' active' : ''}" data-program-tier="${key}" aria-pressed="${index === 0 ? 'true' : 'false'}"><span class="program-option-top"><b>${label}</b><span>${hint}</span></span><strong>${title}</strong><small>${description}</small><span class="program-option-meta"><i>${stat}</i><i>${meta}</i><em>→</em></span></button>`).join('');
    if (copy) copy.textContent = config.copy;
    if (cta) { cta.textContent = `${config.cta} ↗`; cta.href = config.href; }
    const first = config.cards[0]?.[0];
    renderProgramPreview(first);
  }
  document.querySelector('.program-market-panel')?.addEventListener('click', event => {
    const tierButton = event.target.closest('[data-program-tier]');
    if (tierButton) {
      const tier = tierButton.dataset.programTier;
      document.querySelectorAll('[data-program-tier]').forEach(item => { item.classList.toggle('active', item === tierButton); item.setAttribute('aria-pressed', String(item === tierButton)); });
      renderProgramPreview(tier);
    }
    const viewButton = event.target.closest('[data-program-view]');
    if (viewButton) {
      document.querySelectorAll('[data-program-view]').forEach(item => { const active = item === viewButton; item.classList.toggle('active', active); item.setAttribute('aria-selected', String(active)); });
      renderProgramView(viewButton.dataset.programView);
    }
  });
}
