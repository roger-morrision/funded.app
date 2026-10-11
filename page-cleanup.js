import './page-cleanup.css';
import './professional-ui.css';

// Keep the primary task visible before optional illustrations and supporting data.
const guideLabels = {
  capital: 'How claimed fees are allocated',
  community: 'How the watchlist works',
  profile: 'How wallet actions are verified',
  holder: 'How holder payouts are verified',
  wallet: 'How wallet activity is verified',
  'docs-subtopic': 'View the illustrated guide',
  list: 'How a listing is verified',
  rewards: 'How rewards become payable',
  burn: 'How a burn is verified',
  fees: 'View the published fee split',
  docs: 'View the illustrated guide',
  airdrops: 'How a claim is verified',
  referrals: 'How referral rewards qualify',
  privacy: 'How wallet signing works',
  visits: 'How optional visit tracking works',
};

function foldVisualGuides() {
  for (const poster of document.querySelectorAll('.page-infographic, .infographic-poster')) {
    if (poster.parentElement?.classList.contains('page-cleanup-guide')) continue;
    const key = poster.dataset.pageInfographic || poster.dataset.infographicPoster;
    if (!key) continue;
    const disclosure = document.createElement('details');
    disclosure.className = 'page-cleanup-guide';
    disclosure.dataset.guide = key;
    const summary = document.createElement('summary');
    summary.textContent = guideLabels[key] || 'View the visual guide';
    poster.before(disclosure);
    disclosure.append(summary, poster);
  }
}

function showWalletGateBeforeAirdrops() {
  const root = document.getElementById('airdrops');
  const directory = root?.querySelector(':scope > .airdrop-public-programs');
  const gate = root?.querySelector(':scope > .airdrop-hero-layout');
  if (directory && gate && gate.nextElementSibling !== directory) {
    gate.after(directory);
  }
}

function showExploreResultsBeforeExtras() {
  const root = document.getElementById('explore');
  const cards = root?.querySelector(':scope > #asset-grid');
  const table = root?.querySelector(':scope > .explore-scanner');
  const anchor = root?.querySelector(':scope > .explore-market-kpis') || root?.querySelector(':scope > .explore-control-bar');
  if (!cards || !table || !anchor) return;
  if (anchor.nextElementSibling !== cards) anchor.after(cards);
  if (cards.nextElementSibling !== table) cards.after(table);
}

function setupHomeTierShortcuts() {
  const tabs = document.querySelector('.home-launch-tabs');
  const settings = document.querySelector('.home-feed-settings');
  const panel = settings?.querySelector('.home-feed-settings-panel');
  if (!tabs || !panel || panel.querySelector('.page-cleanup-home-tiers')) return;
  const group = document.createElement('div');
  group.className = 'page-cleanup-home-tiers';
  group.setAttribute('role', 'group');
  group.setAttribute('aria-label', 'More launch tiers and watchlist');
  const heading = document.createElement('strong');
  heading.textContent = 'More launch views';
  group.append(heading);
  const tierButtons = [];
  for (const value of ['standard', 'boost', 'pro', 'premier']) {
    const original = tabs.querySelector(`[data-home-launch-tab="${value}"]`);
    if (!original) continue;
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = original.textContent.trim();
    button.dataset.homeTierShortcut = value;
    button.addEventListener('click', () => { original.click(); settings.open = false; });
    group.append(button);
    tierButtons.push(button);
  }
  const selected = document.createElement('span');
  selected.className = 'page-cleanup-selected-tier';
  selected.setAttribute('aria-live', 'polite');
  selected.hidden = true;
  settings.before(selected);
  panel.querySelector('.home-filter-head')?.after(group);
  const update = () => {
    const active = tabs.querySelector('[data-home-launch-tab][aria-selected="true"]')?.dataset.homeLaunchTab || 'all';
    for (const button of tierButtons) button.setAttribute('aria-pressed', String(button.dataset.homeTierShortcut === active));
    selected.hidden = !tierButtons.some(button => button.dataset.homeTierShortcut === active);
    selected.textContent = selected.hidden ? '' : `${active.toUpperCase()} filter`;
  };
  new MutationObserver(update).observe(tabs, { subtree: true, attributes: true, attributeFilter: ['aria-selected'] });
  update();
}

let refreshQueued = false;
function refreshPageCleanup() {
  if (refreshQueued) return;
  refreshQueued = true;
  requestAnimationFrame(() => {
    refreshQueued = false;
    foldVisualGuides();
    showWalletGateBeforeAirdrops();
    showExploreResultsBeforeExtras();
    setupHomeTierShortcuts();
  });
}

function startPageCleanup() {
  refreshPageCleanup();
  const observer = new MutationObserver(refreshPageCleanup);
  observer.observe(document.body, { childList: true, subtree: true });
  window.setTimeout(() => observer.disconnect(), 20000);
  window.addEventListener('hashchange', refreshPageCleanup);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startPageCleanup, { once: true });
else startPageCleanup();
