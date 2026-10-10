import './product-experience.css';
import { productEvent } from './product-events.js';

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
  setText('#home-hero-title', 'Launch a token. Grow your community.');
  setText('.hero-copy', 'Discover Solana tokens, launch your own, and share rewards with your community.');
  const actions = $('.hero-actions');
  const explore = actions?.querySelector('[href="#explore"]');
  const launch = actions?.querySelector('[href="#launch"]');
  if (explore && launch) {
    explore.className = 'primary-button'; explore.textContent = 'Explore tokens';
    launch.className = 'hero-secondary-action'; launch.textContent = 'Launch a token';
    actions.prepend(explore);
  }
  const rewardGroups = $('.home-rewards-stack');
  const board = $('.home-launch-board');
  if (rewardGroups && board) {
    board.after(rewardGroups);
    disclosure(rewardGroups, 'Community rewards');
  }
  // Pause distracting continuous movement by default. The existing control can resume it.
  const pause = $('#home-feed-pause');
  if (pause?.getAttribute('aria-pressed') === 'false') pause.click();
}

function explore() {
  setText('.explore-hero h1', 'Explore tokens');
  setText('.explore-lede', 'Find a token, compare its activity, and explore its community.');
  setText('button[data-explore-tab="trending"]', 'Trending');
  setText('.workspace-watch-link', 'Following');
  $('#explore-search')?.setAttribute('placeholder', 'Search tokens or paste an address');
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
  const filters = $('#explore-filter-popover');
  filters?.setAttribute('role', 'dialog'); filters?.setAttribute('aria-label', 'Token filters');
  // Keyboard users can dismiss the drawer and return to the invoking control.
  filters?.addEventListener('keydown', event => {
    if (event.key === 'Escape') { $('#explore-filter-close')?.click(); $('#explore-filter-toggle')?.focus(); }
  });
  $('#explore-filter-toggle')?.addEventListener('click', () => {
    if (!filters?.hidden) filters.querySelector('button,select,input')?.focus();
  });
  disclosure($('.explore-benefit-leaders'), 'Explore reward programs');
  disclosure($('.stonk-enhancement-grid'), 'Trading currencies');
}

function launch() {
  const options = $('[data-launch-step="2"]');
  const packages = $('.creator-burn-section');
  if (options && packages) {
    packages.classList.remove('launch-tier-first');
    options.querySelector('.launch-funding-section')?.after(packages);
  }
  const first = $('[data-launch-step="1"]');
  const description = first?.querySelector('label:has(#token-description)');
  const image = first?.querySelector('label:has(#token-image-picker)');
  if (description && image) {
    image.after(description);
    disclosure(description, 'Description · optional');
  }
  const packagePreview = $('.launch-package-preview');
  if (options && packagePreview) options.append(packagePreview);
  setText('[data-launch-step-target="2"] span', 'Rewards & launch');
  $('[data-launch-step-target="2"]')?.setAttribute('aria-label', 'Step 2: Rewards and launch');
  setText('#launch-route-title', 'Launch a token');
  setText('#launch-route-shell .page-lede', 'Add your token details, choose your rewards, and review the total before signing.');
  setText('.launch-preview-heading span', 'Preview');
  setText('#launch-mode-quick strong', 'Keep your creator share');
  setText('#launch-mode-quick small', 'Receive your 80% share in your wallet.');
  setText('#launch-mode-custom strong', 'Share with your community');
  setText('#launch-mode-custom small', 'Split your share between your wallet, token holders, and an X account.');
  setText('#custom-policy-title', 'Choose your fee split');
  setText('.launch-total-cost-note', 'Review network fees, optional purchases, and any $FUNDED burn before signing.');
}

function portfolio() {
  const root = $('#my-launches');
  const heading = $('.portfolio-launches-heading');
  const grid = heading?.nextElementSibling;
  const bar = $('.portfolio-view-tabs');
  if (root && heading && grid?.matches('.role-grid') && bar) {
    const panel = document.createElement('section');
    panel.id = 'portfolio-created-panel'; panel.className = 'portfolio-tab-panel'; panel.hidden = true;
    panel.setAttribute('role', 'tabpanel'); panel.setAttribute('aria-labelledby', 'portfolio-created-tab'); panel.tabIndex = 0;
    panel.append(heading, grid); $('.portfolio-dashboard')?.append(panel);
    const button = document.createElement('button');
    button.id = 'portfolio-created-tab'; button.type = 'button'; button.dataset.portfolioTab = 'created';
    button.setAttribute('role', 'tab'); button.setAttribute('aria-selected', 'false'); button.setAttribute('aria-controls', panel.id);
    button.tabIndex = -1; button.textContent = 'Created tokens'; bar.append(button);
  }
  setText('#portfolio-trades-tab', 'Activity');
  setText('#watchlist-heading', 'Following');
  disclosure($('#community-preferences'), 'Following preferences');
}

function details() {
  setText('#rewards-history-tab', 'History');
  setText('#rewards-overview .reward-overview-start h2', 'Explore rewards');
  $('#rewards-overview .reward-overview-start .eyebrow')?.remove();
  disclosure($('.reward-upcoming'), 'How to qualify for upcoming rewards');
  setText('.coin-profile-updates > strong', 'No updates yet');
  setText('.coin-profile-updates > p', 'Updates from this project will appear here.');
  setText('.coin-profile-links-note', 'Links provided by the project.');
  // The chart and trade panel remain above the longer project description.
  const about = $('.coin-hero-about');
  const layout = $('.coin-layout');
  if (about && layout) { about.classList.add('product-token-about'); layout.after(about); }
  setText('.coin-market-aside-title', 'Launch progress');
  setText('.header-search-results-head strong', 'Explore tokens');
}

home(); explore(); launch(); portfolio(); details();
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
