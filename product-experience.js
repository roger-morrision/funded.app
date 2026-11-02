import { productEvent } from './product-events.js';
import { currentFeePolicyCopy } from './src/features/fees/fee-policy-copy.js';
import { mountStepOneFeeSplit } from './src/features/launch/fee-split-step.js';
import { initializeLeaderboardScroll } from './src/features/leaderboard/table-scroll.js';

// Compose existing controls; their data sources and transaction handlers stay authoritative.
const $ = selector => document.querySelector(selector);
const setText = (selector, value) => { const element = $(selector); if (element) element.textContent = value; };
function disclosure(target, label) {
  if (!target || target.parentElement?.classList.contains('product-details')) return;
  const details = document.createElement('details');
  details.className = 'product-details';
  if (target.parentElement?.classList.contains('main-content')) details.dataset.workspaceRoute = 'overview';
  const summary = document.createElement('summary'); summary.textContent = label;
  target.before(details); details.append(summary, target);
  return details;
}

function home() {
  setText('.home-hero-kicker', 'Solana token launchpad');
  const actions = $('.hero-actions');
  const explore = actions?.querySelector('[href="#explore"]');
  const launch = actions?.querySelector('[href="#launch"]');
  if (explore && launch) {
    explore.className = 'primary-button'; explore.textContent = 'Explore coins';
    launch.className = 'hero-secondary-action'; launch.textContent = 'Launch a coin';
    actions.prepend(explore);
  }
  const rewardGroups = $('.home-rewards-stack');
  const board = $('.home-launch-board');
  if (rewardGroups && board) {
    board.after(rewardGroups);
    disclosure(rewardGroups, 'Community rewards');
  }
  if (board && $('.workspace-network')?.textContent?.includes('Devnet')) {
    setText('.home-launch-board-title', 'Devnet launches');
  }
  if (board && !board.querySelector('.product-follow-note')) {
    const note = document.createElement('p');
    note.className = 'product-follow-note';
    note.innerHTML = 'Want to revisit a coin? Use its star, then open <a href="#explore">Explore</a> and choose Favorites.';
    (board.querySelector('.home-launch-table-wrap') || board.querySelector('.home-launch-grid'))?.after(note);
  }
  // Pause distracting continuous movement by default. The existing control can resume it.
  const pause = $('#home-feed-pause');
  if (pause?.getAttribute('aria-pressed') === 'false') pause.click();
}

function explore() {
  setText('.explore-hero h1', 'Explore coins');
  setText('.explore-lede', 'Find a token, compare its activity, and explore its community.');
  setText('button[data-explore-tab="trending"]', 'Trending');
  setText('.workspace-watch-link', 'Following');
  $('#explore-search')?.setAttribute('placeholder', 'Search coins or paste an address');
  const bar = $('.explore-control-bar');
  const sort = $('#explore-sort');
  const label = sort?.closest('label');
  if (label && bar) {
    label.classList.add('product-sort');
    label.firstChild.textContent = 'Sort';
    bar.append(label);
  }
  const labels = { boosted:'Active boosts', 'tier-burn':'Promotion spend', airdrop:'Airdrop allocation', 'holder-fee':'Holder reward share', 'x-fee':'X reward share', turnover:'Volume / market cap', 'recent-trade':'Recent activity', holders:'Holder count', change:'24h change', newest:'Newest' };
  for (const option of sort?.options || []) if (labels[option.value]) option.textContent = labels[option.value];
  // Common sorts first; protocol-specific and detailed sorts in labelled groups.
  if (sort && !sort.querySelector('optgroup')) {
    const groups = [
      ['funded.vip rewards', ['boosted', 'tier-burn', 'airdrop', 'holder-fee', 'x-fee']],
      ['More', ['trades', 'turnover', 'liquidity', 'recent-trade']],
    ];
    for (const value of ['volume', 'market-cap', 'newest', 'holders', 'change']) {
      const option = sort.querySelector(`option[value="${value}"]`);
      if (option) sort.append(option);
    }
    for (const [label, values] of groups) {
      const group = document.createElement('optgroup'); group.label = label;
      for (const value of values) { const option = sort.querySelector(`option[value="${value}"]`); if (option) group.append(option); }
      if (group.children.length) sort.append(group);
    }
  }
  const filters = $('#explore-filter-popover');
  filters?.setAttribute('role', 'dialog'); filters?.setAttribute('aria-label', 'Token filters');
  // Keyboard users can dismiss the drawer and return to the invoking control.
  filters?.addEventListener('keydown', event => {
    if (event.key === 'Escape') { $('#explore-filter-close')?.click(); $('#explore-filter-toggle')?.focus(); }
  });
  $('#explore-filter-toggle')?.addEventListener('click', () => {
    if (!filters?.hidden) filters.querySelector('button,select,input')?.focus();
  });
}

function launch() {
  const options = $('[data-launch-step="2"]');
  const packages = $('.creator-burn-section');
  if (options && packages) {
    packages.classList.remove('launch-tier-first');
    options.querySelector('.launch-cost-jump')?.after(packages);
    const story=options.querySelector('#launch-story-options');
    if(story)options.querySelector('.launch-funding-section')?.after(story);
  }
  const first = $('[data-launch-step="1"]');
  const description = first?.querySelector('label:has(#token-description)');
  const image = first?.querySelector('label:has(#token-image-picker)');
  if (description && image) {
    image.after(description);
    disclosure(description, 'Description · optional');
  }
  const packagePreview = $('.launch-package-preview');
  if (options && packagePreview) {
    const preview = packagePreview.closest('#launch-presentation-preview') || disclosure(packagePreview, 'Preview token page & X posts');
    preview.id = 'launch-presentation-preview';
    options.append(preview);
  }
  setText('[data-launch-step-target="2"] span', 'Rewards & launch');
  $('[data-launch-step-target="2"]')?.setAttribute('aria-label', 'Step 2: Rewards and launch');
  setText('#launch-route-title', 'Launch a coin');
  setText('#launch-route-shell .page-lede', `Control your 80% creator share. ${currentFeePolicyCopy().headline}. Review the full fee distribution and launch cost before signing.`);
  setText('#benefits-step-title', 'Choose your fee route');
  setText('[data-launch-step="2"] > .step-heading p', 'The recommended setup directs 80% of collected creator fees to your wallet. Airdrop size, developer buy, and promotion are separate choices.');
  const funding = $('.launch-funding-section');
  if (funding && !funding.querySelector('.product-airdrop-note')) {
    const note = document.createElement('p');
    note.className = 'product-airdrop-note';
    note.textContent = 'Airdrops use your token. Fee rewards use SOL.';
    funding.querySelector('.section-label-row')?.after(note);
  }
  setText('.launch-preview-heading span', 'Preview');
  setText('#custom-policy-title', 'Split your 80%');
  setText('#custom-policy .section-label-row > span', 'Must total 80%');
  mountStepOneFeeSplit();
  setText('.launch-total-cost-note', 'Review network fees, optional purchases, and any $FUNDED burn before signing.');
}

function portfolio() {
  const root = $('#my-launches');
  const heading = $('.portfolio-launches-heading');
  const grid = root?.querySelector(':scope > .role-grid');
  const bar = $('.portfolio-view-tabs');
  if (root && heading && grid && bar && !$('#portfolio-created-tab')) {
    const panel = document.createElement('section');
    panel.id = 'portfolio-created-panel'; panel.className = 'portfolio-tab-panel'; panel.hidden = true;
    panel.setAttribute('role', 'tabpanel'); panel.setAttribute('aria-labelledby', 'portfolio-created-tab'); panel.tabIndex = 0;
    panel.append(heading, grid); $('.portfolio-dashboard')?.append(panel);
    const button = document.createElement('button');
    button.id = 'portfolio-created-tab'; button.type = 'button'; button.dataset.portfolioTab = 'created';
    button.setAttribute('role', 'tab'); button.setAttribute('aria-selected', 'false'); button.setAttribute('aria-controls', panel.id);
    button.tabIndex = -1; button.textContent = 'Created coins'; bar.append(button);
  }
  setText('#portfolio-trades-tab', 'Activity');
  setText('#watchlist-heading', 'Following');
  disclosure($('#community-preferences'), 'Following preferences');
}

function details() {
  const summary = $('#coin-summary-title');
  if (summary && !$('#coin-fee-status-guide')) {
    const guide = document.createElement('p');
    guide.id = 'coin-fee-status-guide';
    guide.className = 'coin-fee-status-guide';
    guide.textContent = 'Read this coin in order: launch and policy verified on Solana → creator fees collected → split allocated → payment confirmed by receipt. Each step needs its own evidence; an allocation is not a completed payout.';
    summary.closest('.coin-summary-heading')?.after(guide);
  }
  disclosure($('.reward-upcoming'), 'How to qualify for upcoming rewards');
  setText('.coin-profile-updates > strong', 'No updates yet');
  setText('.coin-profile-updates > p', 'Updates from this project will appear here.');
  setText('.coin-profile-links-note', 'Links provided by the project.');
  const about = $('.coin-hero-about');
  const headerAside = $('#coin-page .coin-hero-aside');
  if (about && headerAside) { about.classList.add('product-token-about'); headerAside.prepend(about); }
  setText('.coin-market-aside-title', 'Launch progress');
  setText('.header-search-results-head strong', 'Explore coins');
  const trade = $('#trade-panel');
  const quote = trade?.querySelector('.coin-trade-quote-details');
  const submit = trade?.querySelector('.trade-actions');
  if (quote && submit) {
    submit.before(quote);
    quote.open = true;
    setText('.coin-trade-quote-details > summary', 'Quote, maximum spend, and fees');
  }
}

home(); explore(); launch(); portfolio(); details(); initializeLeaderboardScroll();
// New route-scoped disclosures are created after the workspace's initial sync.
window.dispatchEvent(new Event('funded:layout-change'));
document.body.classList.add('product-experience-ready');
function recordRoute() {
  if (location.pathname.startsWith('/token/') || location.hash.startsWith('#coin/')) productEvent('token_view');
  else if (location.hash === '#explore') productEvent('explore_view');
  else if (location.hash === '#payments') productEvent('rewards_view');
  else if (location.hash === '#launch') productEvent('launch_details');
}
window.addEventListener('hashchange', recordRoute); recordRoute();
window.addEventListener('funded:launch-step', event => {
  const name = {1:'launch_details',2:'launch_options',3:'launch_review'}[event.detail?.step];
  if (name) productEvent(name);
});
document.addEventListener('click', event => {
  if (event.target.closest('#coin-share-link,[data-share-mint]')) productEvent('share_open');
});
