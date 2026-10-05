import { readExploreFilterUrl, sanitizeExploreFilters } from './explore-filter-url.js';
// Workspace composition owns layout and navigation. Financial state remains in its source modules.
import { EXPLORE_CLUSTER, APP_MAINNET_READ_ONLY } from './app-config.js';
import { mountDocsReference } from './docs-reference.js';
import { icon } from './ui-icons.js';
import airdropWolfDropUrl from './airdrop-wolf-drop.webp';
import './workspace-ui.css';
import './home-reference.css';
import './ansem-pages.css';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const text = (selector, value) => { const node = $(selector); if (node) node.textContent = value; };
const node = (tag, className, content) => {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (content) element.textContent = content;
  return element;
};
// Moves existing nodes, preserving listeners, IDs, and live data updates.
function disclose(target, label, { open = false, id } = {}) {
  if (!target || target.parentElement?.classList.contains('ui-disclosure')) return null;
  const details = node('details', 'ui-disclosure');
  if (id) details.id = id;
  details.open = open;
  if (target.parentElement?.classList.contains('main-content')) {
    details.dataset.workspaceRoute = target.matches('.referral-toolkit,.referral-progress-panel') ? 'referrals' : 'overview';
  }
  const summary = node('summary', '', label);
  target.before(details);
  details.append(summary, target);
  return details;
}

function tabs(root, entries, name) {
  const bar = node('div', 'ui-tabs');
  bar.setAttribute('role', 'tablist'); bar.setAttribute('aria-label', name);
  const select = (key, focus = false) => {
    entries.forEach(entry => {
      const active = entry.key === key && !entry.button.hidden;
      entry.panel.hidden = !active;
      entry.button.setAttribute('aria-selected', String(active));
      entry.button.tabIndex = active ? 0 : -1;
      if (active && focus) entry.button.focus();
    });
    root.dataset.activeView = key;
  };
  entries.forEach(entry => {
    entry.panel.id ||= `${root.id}-${entry.key}`;
    entry.panel.classList.add('ui-tab-panel');
    entry.panel.setAttribute('role', 'tabpanel');
    entry.panel.tabIndex = 0;
    const button = node('button', '', entry.label);
    button.type = 'button'; button.id = `${entry.panel.id}-tab`;
    button.setAttribute('role', 'tab'); button.setAttribute('aria-controls', entry.panel.id);
    entry.panel.setAttribute('aria-labelledby', button.id);
    button.addEventListener('click', () => select(entry.key));
    entry.button = button; bar.append(button);
  });
  bar.addEventListener('keydown', event => {
    const available = entries.filter(entry => !entry.button.hidden);
    const index = available.findIndex(entry => entry.button === document.activeElement);
    if (index < 0) return;
    const offset = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? available.length - 1 : (index + offset + available.length) % available.length;
    if (offset || event.key === 'Home' || event.key === 'End') { event.preventDefault(); select(available[next].key, true); }
  });
  select.setAvailable = (key, available) => {
    const entry = entries.find(item => item.key === key);
    if (!entry) return;
    entry.button.hidden = !available;
    if (!available) {
      entry.panel.hidden = true;
      entry.button.setAttribute('aria-selected', 'false');
      entry.button.tabIndex = -1;
      if (root.dataset.activeView === key) select(entries.find(item => !item.button.hidden)?.key);
    }
  };
  root.prepend(bar); select(entries[0].key);
  return select;
}

function navigation() {
  $$('[data-icon]').forEach(item => item.innerHTML = icon(item.dataset.icon));
  $('#notifications-button').innerHTML = icon('notifications');
  $('#open-menu').innerHTML = icon('menu');
  $('#close-menu').innerHTML = icon('close');
  $('.search-box > span').innerHTML = icon('explore');
  $('#desktop-sidebar-toggle span').innerHTML = icon('chevronLeft');
  $('#home-ticker-back').innerHTML = icon('chevronLeft');
  $('#home-ticker-forward').innerHTML = icon('chevronRight');
  $('#home-feed-pause').innerHTML = icon('pause');
  $('.home-feed-settings summary').innerHTML = icon('filter');
  $('#coin-copy-address').innerHTML = icon('copy');
  $('.nav-more summary span').innerHTML = icon('chevronDown');
  $('[data-home-view="grid"]').innerHTML = `${icon('grid')} Grid`;
  $('[data-home-view="table"]').innerHTML = `${icon('table')} Table`;
  Object.entries({
    'home-kpi-launches-card':'launch', 'home-kpi-fees-card':'coin',
    'home-kpi-app-revenue-card':'analytics', 'home-kpi-holders-card':'users',
    'home-kpi-x-card':'socialX', 'home-kpi-buyback-card':'refresh',
    'home-kpi-burn-card':'burn', 'home-kpi-burn-value-card':'coin',
    'home-kpi-community-card':'users', 'home-kpi-airdrop-card':'rewards',
    'home-kpi-referrals-card':'send', 'home-kpi-volume-card':'analytics',
  }).forEach(([id, name]) => {
    const mark = $(`#${id} .home-kpi-icon`);
    if (mark) mark.innerHTML = icon(name);
  });
  const feedSettings = $('.home-feed-settings');
  feedSettings?.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    feedSettings.open = false;
    $('summary', feedSettings)?.focus();
  });
  document.addEventListener('pointerdown', event => {
    if (feedSettings?.open && !feedSettings.contains(event.target)) feedSettings.open = false;
  });
  $$('button.dialog-close, #explore-filter-close, #share-close').forEach(button => {
    if (button.textContent.trim() === '×') button.innerHTML = icon('close');
  });
  const searchTrigger = node('button', 'header-search-trigger');
  searchTrigger.innerHTML = icon('explore');
  searchTrigger.type = 'button';
  searchTrigger.id = 'header-search-trigger';
  searchTrigger.setAttribute('aria-label', 'Search launches');
  searchTrigger.setAttribute('aria-haspopup', 'dialog');
  searchTrigger.setAttribute('aria-controls', 'header-search-dialog');
  $('.top-actions')?.before(searchTrigger);
  const searchDialog = node('dialog', 'header-search-dialog');
  searchDialog.id = 'header-search-dialog';
  searchDialog.setAttribute('aria-label', 'Search launches');
  searchDialog.innerHTML = `<form class="header-search-panel"><label for="header-search-input">Search launches</label><div class="header-search-field"><span aria-hidden="true">${icon('explore')}</span><input id="header-search-input" type="search" role="combobox" aria-autocomplete="list" aria-expanded="true" autocomplete="off" placeholder="Search name, ticker, or mint" aria-controls="header-search-results" /><button type="button" class="header-search-close" aria-label="Close search">${icon('close')}</button></div><div class="header-search-results-head"><strong id="header-search-results-title">TOP VERIFIED LAUNCHES</strong><span>NAME · $TICKER · MINT</span></div><div id="header-search-results" class="header-search-results" role="listbox" aria-label="Verified launch search results"></div><p id="header-search-help">↑↓ navigate · ↵ open · Esc close</p></form>`;
  document.body.append(searchDialog);
  const modalSearch = $('#header-search-input', searchDialog);
  const globalSearch = $('#global-search');
  const searchResults = $('#header-search-results', searchDialog);
  let candidates = [];
  let activeCandidate = -1;
  const renderSearchResults = () => {
    candidates = window.fundedVerifiedSearchCandidates?.(modalSearch.value) || [];
    activeCandidate = candidates.length ? 0 : -1;
    $('#header-search-results-title', searchDialog).textContent = modalSearch.value.trim() ? 'MATCHING VERIFIED LAUNCHES' : 'TOP VERIFIED LAUNCHES';
    searchResults.replaceChildren();
    if (!candidates.length) {
      const empty = node('p', 'header-search-empty', modalSearch.value.trim() ? 'No verified launch matches this search. Press Enter to search Launch Directory.' : 'No verified launches in the current feed.');
      searchResults.append(empty);
    }
    candidates.forEach((candidate, index) => {
      const link = node('a', 'header-search-result');
      link.id = `header-search-result-${index}`;
      link.href = `/token/${encodeURIComponent(candidate.mint)}`;
      link.setAttribute('role', 'option');
      link.setAttribute('aria-selected', String(index === activeCandidate));
      const token = node('span', 'header-search-token');
      const avatar = node('span', 'header-search-avatar', String(candidate.symbol || 'T').slice(0, 1).toUpperCase());
      avatar.setAttribute('aria-hidden', 'true');
      const identity = node('span', 'header-search-identity');
      identity.append(node('strong', '', candidate.name), node('small', '', `$${candidate.symbol} · ${candidate.mint.slice(0, 5)}…${candidate.mint.slice(-4)}`));
      const market = node('span', 'header-search-market');
      market.append(node('strong', '', candidate.marketCap), node('small', '', candidate.stage));
      token.append(avatar, identity);
      link.append(token, market);
      link.addEventListener('click', () => searchDialog.close());
      searchResults.append(link);
      if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(candidate.mint)) {
        const image = new Image();
        image.alt = '';
        image.decoding = 'async';
        image.onload = () => { if (avatar.isConnected) avatar.replaceChildren(image); };
        image.src = `/devnet-images/${encodeURIComponent(candidate.mint)}`;
      }
    });
    modalSearch.setAttribute('aria-activedescendant', activeCandidate >= 0 ? `header-search-result-${activeCandidate}` : '');
  };
  const selectCandidate = index => {
    activeCandidate = index;
    for (const [position, link] of [...searchResults.querySelectorAll('[role="option"]')].entries()) link.setAttribute('aria-selected', String(position === index));
    modalSearch.setAttribute('aria-activedescendant', index >= 0 ? `header-search-result-${index}` : '');
    searchResults.querySelector(`#header-search-result-${index}`)?.scrollIntoView({ block: 'nearest' });
  };
  searchTrigger.addEventListener('click', () => {
    modalSearch.value = globalSearch?.value || '';
    renderSearchResults();
    searchDialog.showModal();
    modalSearch.focus();
    modalSearch.select();
  });
  modalSearch.addEventListener('input', renderSearchResults);
  document.addEventListener('funded:verified-search-index', () => { if (searchDialog.open) renderSearchResults(); });
  modalSearch.addEventListener('keydown', event => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    if (candidates.length) selectCandidate((activeCandidate + (event.key === 'ArrowDown' ? 1 : candidates.length - 1)) % candidates.length);
  });
  $('.header-search-close', searchDialog).addEventListener('click', () => searchDialog.close());
  $('form', searchDialog).addEventListener('submit', event => {
    event.preventDefault();
    if (activeCandidate >= 0) { location.assign(`/token/${encodeURIComponent(candidates[activeCandidate].mint)}`); return; }
    const query = modalSearch.value.trim();
    searchDialog.close();
    const applyQuery = () => {
      if (!globalSearch) return;
      globalSearch.value = query;
      globalSearch.dispatchEvent(new Event('input', { bubbles: true }));
    };
    if (location.hash !== '#explore') {
      window.addEventListener('hashchange', () => requestAnimationFrame(applyQuery), { once: true });
      location.hash = '#explore';
    } else applyQuery();
  });
  searchDialog.addEventListener('click', event => { if (event.target === searchDialog) searchDialog.close(); });
  searchDialog.addEventListener('close', () => { if (searchTrigger.getClientRects().length) searchTrigger.focus(); });
  const helpTrigger = node('button', 'help-topics-trigger', 'Help');
  helpTrigger.id = 'help-topics-trigger';
  helpTrigger.type = 'button';
  helpTrigger.setAttribute('aria-label', 'Open help topics');
  helpTrigger.setAttribute('aria-controls', 'help-topics-panel');
  helpTrigger.setAttribute('aria-expanded', 'false');
  const helpPanel = node('aside', 'help-topics-panel');
  helpPanel.id = 'help-topics-panel';
  helpPanel.hidden = true;
  helpPanel.setAttribute('role', 'dialog');
  helpPanel.setAttribute('aria-label', 'funded.vip help topics');
  helpPanel.innerHTML = `<header><div><strong>funded.vip</strong><small>Devnet help topics</small></div><button type="button" aria-label="Close help topics">${icon('close')}</button></header><p class="help-topics-intro">Find the record or guide you need. Live messaging is unavailable in this preview.</p><div class="help-topics-choices"><button type="button" data-help-topic="coin">Coin details</button><button type="button" data-help-topic="trade">Trading issues</button><button type="button" data-help-topic="airdrop">Airdrop status</button><button type="button" data-help-topic="launch">Launch receipts</button></div><div class="help-topics-answer" role="status" aria-live="polite"><strong>How can we help?</strong><p>Choose a topic to see where to check its verified Devnet record.</p><a href="#docs">Open the help guide →</a></div>`;
  const helpTopics = {
    coin: { title: 'Coin details', answer: 'Open a token page to compare its mint, creator, market snapshot, and launch policy. Missing indexed fields are marked unavailable.', href: '#docs/coin-pages', link: 'Read about coin pages →' },
    trade: { title: 'Trading issues', answer: 'If your wallet shows a submitted trade, open its transaction link and check the result before trying again. If you cancelled in your wallet, refresh the quote when you are ready.', href: '#docs/trading', link: 'Read trading guidance →' },
    airdrop: { title: 'Airdrop status', answer: 'Check vault funding, the migration snapshot, claim proof, and any confirmed receipt before treating an allocation as claimable.', href: '#airdrops', link: 'Check airdrop evidence →' },
    launch: { title: 'Launch receipts', answer: 'Compare the mint, fee owner, tier burn, and finalized transaction from the token record. A selected tier is not a verified badge until its burn receipt is confirmed.', href: '#docs/launch', link: 'Read launch guidance →' },
  };
  const setHelpOpen = open => {
    helpPanel.hidden = !open;
    helpTrigger.setAttribute('aria-expanded', String(open));
    if (open) helpPanel.querySelector('header button').focus();
    else helpTrigger.focus();
  };
  helpTrigger.addEventListener('click', () => setHelpOpen(helpPanel.hidden));
  helpPanel.querySelector('header button').addEventListener('click', () => setHelpOpen(false));
  helpPanel.addEventListener('click', event => {
    const choice = event.target.closest('[data-help-topic]');
    if (choice) {
      const topic = helpTopics[choice.dataset.helpTopic];
      for (const button of helpPanel.querySelectorAll('[data-help-topic]')) button.setAttribute('aria-pressed', String(button === choice));
      const answer = helpPanel.querySelector('.help-topics-answer');
      answer.querySelector('strong').textContent = topic.title;
      answer.querySelector('p').textContent = topic.answer;
      const link = answer.querySelector('a');
      link.href = topic.href;
      link.textContent = topic.link;
    }
    if (event.target.closest('.help-topics-answer a')) setHelpOpen(false);
  });
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && !helpPanel.hidden) setHelpOpen(false); });
  window.addEventListener('hashchange', () => { if (!helpPanel.hidden) setHelpOpen(false); });
  document.body.append(helpTrigger, helpPanel);
  const mobile = node('nav', 'mobile-workspace-nav'); mobile.setAttribute('aria-label', 'Mobile workspace');
  for (const [href, label, glyph] of [['overview','Home','home'],['explore','Explore','explore'],['launch','Launch','launch'],['my-launches','Portfolio','portfolio'],['payments','Rewards','rewards']]) {
    const link = node('a', '', ''); link.href = `#${href}`;
    link.innerHTML = icon(glyph); link.append(node('span', '', label)); mobile.append(link);
  }
  document.body.append(mobile);
  const network = node('span', 'workspace-network', EXPLORE_CLUSTER === 'mainnet-beta' ? (APP_MAINNET_READ_ONLY ? 'Mainnet · read only' : 'Mainnet') : 'Devnet · test SOL');
  network.title = EXPLORE_CLUSTER === 'devnet' ? 'Solana Devnet uses test SOL with no monetary value.' : APP_MAINNET_READ_ONLY ? 'Solana Mainnet preview: transactions are disabled.' : 'Solana Mainnet: transactions use real SOL.'; network.setAttribute('aria-label', network.title); $('.top-actions')?.prepend(network);
  const sidebar = $('#sidebar');
  sidebar?.addEventListener('click', event => {
    if (event.target.closest('a')) $('#close-menu')?.click();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') { const more = $('.nav-more'); if (more?.open) { more.open = false; $('summary', more).focus(); } }
  });
  const preference = node('label', 'workspace-preference', 'Start page');
  const select = node('select'); select.setAttribute('aria-label', 'Preferred start page');
  select.innerHTML = '<option value="overview">Home</option><option value="explore">Explore</option>';
  try { select.value = localStorage.getItem('funded.start-page') || 'overview'; } catch {}
  select.addEventListener('change', () => { try { localStorage.setItem('funded.start-page', select.value); } catch {} });
  preference.append(select); $('#profile')?.append(preference);
  if (!location.hash && location.pathname === '/' && select.value === 'explore') location.hash = '#explore';
}

function home() {
  const hero = $('.hero-section');
  const board = $('.home-launch-board');
  if (hero && board) hero.after(board);
  disclose($('.hero-stakeholders'), 'How participants benefit');
  disclose($('.home-referral-guide'), 'How referral rewards work');
}

function explore() {
  const root = $('#explore');
  const leaders = $('.explore-benefit-leaders', root);
  const scanner = $('.explore-scanner', root);
  if (leaders && scanner) {
    const disclosure = leaders.parentElement?.matches('details.ui-disclosure') ? leaders.parentElement : null;
    if (disclosure) disclosure.replaceWith(leaders);
    scanner.after(leaders);
  }
  const popover = $('#explore-filter-popover');
  const filterButton = $('#explore-filter-toggle');
  filterButton?.append(node('span', '', 'Filters'));
  const count = node('p', 'workspace-filter-summary'); count.id = 'workspace-filter-summary'; count.setAttribute('role','status');
  $('.explore-control-bar')?.after(count);
  const stage = $('.explore-stage-filter');
  if (stage) text('[data-explore-stage="near"]', 'Graduating');
  const watch = node('a', 'workspace-watch-link', 'Watchlist'); watch.href = '#community'; $('.explore-tabs')?.append(watch);
  const headingActions = $('.explore-heading .heading-actions', root);
  const tabs = $('.explore-tabs', root);
  if (tabs && headingActions) headingActions.prepend(tabs);
  const timeframe = $('.explore-timeframe', root);
  if (timeframe) $('.explore-control-left', root)?.prepend(timeframe);
  const viewSwitch = $('.explore-view-switch', root);
  if (viewSwitch && headingActions) headingActions.append(viewSwitch);
  const quickFilters = node('div', 'explore-quick-filters');
  const stageStrip = node('div', 'explore-index-filters');
  stageStrip.setAttribute('role', 'group');
  stageStrip.setAttribute('aria-label', 'Launch stage filters');
  stageStrip.append(node('span', 'explore-quick-label', 'STAGE'));
  for (const [label, stageValue] of [['All', 'all'], ['On curve', 'curve'], ['Graduated', 'graduated']]) {
    const button = node('button', 'index-filter', label);
    button.type = 'button';
    button.dataset.stage = stageValue;
    stageStrip.append(button);
    button.addEventListener('click', () => $(`.explore-stage-filter [data-explore-stage="${stageValue}"]`, root)?.click());
  }
  const tierStrip = node('div', 'explore-tier-filters');
  tierStrip.setAttribute('role', 'group');
  tierStrip.setAttribute('aria-label', 'Verified launch tier filters');
  tierStrip.append(node('span', 'explore-quick-label', 'TIER'));
  for (const [label, value] of [['All tiers', 'all'], ['Promoted', 'promoted'], ['Standard', 'standard'], ['Pro', 'pro'], ['Premier', 'premier']]) {
    const button = node('button', 'index-filter', label);
    button.type = 'button';
    button.dataset.promotion = value;
    tierStrip.append(button);
    button.addEventListener('click', () => {
      const promotion = $('#explore-promotion-filter');
      if (promotion) { promotion.value = value; promotion.dispatchEvent(new Event('change', { bubbles: true })); }
    });
  }
  const thresholds = node('div', 'explore-threshold-filters');
  const cap = node('select', 'explore-threshold-select');
  cap.id = 'explore-quick-min-cap';
  cap.setAttribute('aria-label', 'Minimum market cap');
  for (const [label, value] of [['MC · any', ''], ['MC ≥ $10K', '10000'], ['MC ≥ $50K', '50000'], ['MC ≥ $100K', '100000'], ['MC ≥ $1M', '1000000'], ['MC · custom', 'custom']]) {
    const option = node('option', '', label); option.value = value; cap.append(option);
  }
  const age = node('select', 'explore-threshold-select');
  age.id = 'explore-quick-max-age';
  age.setAttribute('aria-label', 'Maximum token age');
  for (const [label, value] of [['Age · any', ''], ['New · < 1h', '1'], ['New · < 6h', '6'], ['New · < 24h', '24'], ['< 7 days', '168']]) {
    const option = node('option', '', label); option.value = value; age.append(option);
  }
  const advancedCap = $('#explore-min-cap-sol');
  const advancedAge = $('#explore-max-age-hours');
  cap.addEventListener('change', () => {
    if (cap.value === 'custom') {
      if (filterButton?.getAttribute('aria-expanded') !== 'true') filterButton?.click();
      advancedCap?.focus();
      return;
    }
    if (!advancedCap) return;
    advancedCap.value = cap.value;
    advancedCap.dispatchEvent(new Event('input', { bubbles: true }));
  });
  age.addEventListener('change', () => {
    if (!advancedAge) return;
    advancedAge.value = age.value;
    advancedAge.dispatchEvent(new Event('change', { bubbles: true }));
  });
  const syncThresholds = () => {
    const capValue = advancedCap?.value.trim() || '';
    cap.value = [...cap.options].some(option => option.value === capValue) ? capValue : 'custom';
    age.value = advancedAge?.value || '';
  };
  advancedCap?.addEventListener('input', syncThresholds);
  advancedAge?.addEventListener('change', syncThresholds);
  root?.addEventListener('funded:explore-filters-cleared', syncThresholds);
  thresholds.append(cap, age);
  quickFilters.append(stageStrip, tierStrip, thresholds);
  $('.explore-control-bar', root)?.before(quickFilters);
  const syncQuickFilters = () => {
    const selectedStage = $('.explore-stage-filter [aria-pressed="true"]', root)?.dataset.exploreStage || 'all';
    const selectedPromotion = $('#explore-promotion-filter')?.value || 'all';
    $$('.index-filter', quickFilters).forEach(button => {
      const active = button.dataset.stage ? button.dataset.stage === selectedStage : button.dataset.promotion === selectedPromotion;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
  };
  root?.addEventListener('click', event => {
    if (event.target.closest('[data-explore-stage], [data-explore-tab], [data-explore-window], [data-explore-view], [data-explore-sort], [data-explore-lane], #explore-clear-filters')) {
      queueMicrotask(() => { syncQuickFilters(); save(); });
    }
  });
  $('#explore-promotion-filter')?.addEventListener('change', syncQuickFilters);
  root?.addEventListener('funded:explore-filters-cleared', syncQuickFilters);
  syncQuickFilters();
  const sort = $('#explore-sort'); sort?.classList.remove('sr-only');
  if (sort) { const label = node('label', 'workspace-sort', 'More sort options'); label.append(sort); popover?.querySelector('#explore-clear-filters')?.before(label); }
  const keys = ['explore-search','explore-sort','explore-promotion-filter','explore-reward-filter','explore-risk-filter','explore-max-age-hours','explore-authority-filter','explore-min-volume-sol','explore-min-cap-sol','explore-min-trades','explore-min-traders'];
  let restoring = false;
  const capture = () => ({
    ...Object.fromEntries(keys.map(id => [id, $('#'+id)?.value || ''])),
    stage: $('.explore-stage-filter [aria-pressed="true"]', root)?.dataset.exploreStage || 'all',
    tab: $('.explore-tabs [aria-pressed="true"]', root)?.dataset.exploreTab || 'trending',
    window: $('.explore-timeframe [aria-pressed="true"]', root)?.dataset.exploreWindow || '24h',
    view: $('.explore-view-switch [aria-pressed="true"]', root)?.dataset.exploreView || 'grid',
  });
  const summarize = () => {
    const active = keys.slice(2).filter(id => { const value = $('#'+id)?.value; return value && value !== 'all'; });
    if ($('.explore-stage-filter [aria-pressed="true"]', root)?.dataset.exploreStage !== 'all') active.push('stage');
    count.replaceChildren();
    if (!active.length && !$('#explore-search')?.value) return;
    count.append(node('span', '', `${active.length} filter${active.length === 1 ? '' : 's'}${$('#explore-search')?.value ? ' · search active' : ''}`));
    const clear = node('button', 'text-button', 'Clear all'); clear.type = 'button';
    clear.addEventListener('click', () => { $('#explore-clear-filters')?.click(); const search = $('#explore-search'); if(search){search.value='';search.dispatchEvent(new Event('input',{bubbles:true}));} });
    count.append(clear);
  };
  const save = () => {
    summarize(); if (restoring) return;
    try { sessionStorage.setItem('funded.explore-view.usd', JSON.stringify(capture())); } catch {}
  };
  const restore = () => {
    restoring = true;
    try {
      const shared = readExploreFilterUrl(location.href);
      const saved = sanitizeExploreFilters(shared || JSON.parse(sessionStorage.getItem('funded.explore-view.usd') || '{}'));
      if (shared) {
        $('#explore-clear-filters')?.click();
        const search = $('#explore-search');
        if (search) { search.value = ''; search.dispatchEvent(new Event('input', { bubbles: true })); }
      }
      for (const [key, selector, attribute] of [
        ['tab', '.explore-tabs', 'exploreTab'],
        ['window', '.explore-timeframe', 'exploreWindow'],
        ['stage', '.explore-stage-filter', 'exploreStage'],
        ['view', '.explore-view-switch', 'exploreView'],
      ]) {
        const value = saved[key];
        const button = $$(selector + ' button', root).find(item => item.dataset[attribute] === value);
        button?.click();
      }
      for (const id of keys.filter(id => id !== 'explore-sort')) {
        const input = $('#'+id);
        if (input && typeof saved[id] === 'string' && saved[id].length < 200 && (input.tagName !== 'SELECT' || [...input.options].some(option => option.value === saved[id] && !option.disabled))) {
          input.value = saved[id];
          input.dispatchEvent(new Event(input.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
        }
      }
      const savedSort = $$('#explore-sort option').find(option => option.value === saved['explore-sort'] && !option.disabled);
      if (savedSort) { sort.value = savedSort.value; sort.dispatchEvent(new Event('change', { bubbles: true })); }
    } catch {} finally { restoring = false; summarize(); }
  };
  root?.addEventListener('input', save); root?.addEventListener('change', save);
  $('#global-search')?.addEventListener('input', () => queueMicrotask(save));
  root?.addEventListener('funded:explore-filters-cleared', save);
  $('#explore-clear-filters')?.addEventListener('click', save);
  root?.addEventListener('click', event => { if (event.target.closest('[data-explore-stage],[data-explore-tab],[data-explore-window],[data-explore-view]')) queueMicrotask(save); });
  window.addEventListener('popstate', () => restore());
  restore();
  syncThresholds();
}

function launch() {
  $('#wizard-hint')?.setAttribute('tabindex','-1');
  $$('[data-launch-step-target]').forEach(button=>button.setAttribute('aria-label',`Step ${button.dataset.launchStepTarget}: ${['Token details','Launch settings','Review'][Number(button.dataset.launchStepTarget)-1]}`));
  disclose($('.enhanced-token-page'), 'Optional story and roadmap');
  const tier = $('.creator-burn-section');
  const firstStep = $('[data-launch-step="1"]');
  if (tier && firstStep) { tier.classList.add('launch-tier-first'); firstStep.prepend(tier); }
  const coinFields = firstStep?.querySelector('.coin-fields');
  const description = firstStep?.querySelector('.full-label:has(#token-description)');
  const socials = firstStep?.querySelector('.launch-optional-socials');
  const image = firstStep?.querySelector('.full-label:has(#token-image-picker)');
  if (coinFields && description && socials && image) coinFields.after(description, socials, image);
  text('#creator-burn-title', 'Launch tier');
  text('#creator-burn-title + span', 'Choose before coin details');
  if (tier) {
    const explanations = {
      standard: ['Standard', 'No $FUNDED burn. The core Pump launch and published community airdrop policy still apply.'],
      pro: ['Pro', 'A confirmed $FUNDED burn is bound to the launch transaction. Its badge and featured-review eligibility appear after verification. Placement requires a separate review.'],
      premier: ['Premier', 'Includes the Pro benefits and makes the launch eligible for homepage spotlight review. Placement is not guaranteed.'],
    };
    const guide = node('div', 'launch-tier-guide-links');
    const guideDialog = node('dialog', 'launch-tier-guide-dialog');
    guideDialog.setAttribute('aria-labelledby', 'launch-tier-guide-title');
    guideDialog.innerHTML = `<button type="button" class="launch-tier-guide-close" aria-label="Close tier guide">${icon('close')}</button><p class="eyebrow">Launch tier</p><h3 id="launch-tier-guide-title"></h3><p class="launch-tier-guide-copy"></p><a href="#buybacks">View burn policy →</a>`;
    for (const [key, [title, description]] of Object.entries(explanations)) {
      const button = node('button', 'text-button', `About ${title}`);
      button.type = 'button';
      button.setAttribute('aria-haspopup', 'dialog');
      button.addEventListener('click', () => {
        const amount = tier.querySelector(`[data-burn-tier="${key}"] strong`)?.textContent?.trim() || '';
        guideDialog.querySelector('h3').textContent = `${title} · ${amount}`;
        guideDialog.querySelector('.launch-tier-guide-copy').textContent = description;
        guideDialog.showModal();
      });
      guide.append(button);
    }
    tier.append(guide, guideDialog);
    guideDialog.querySelector('.launch-tier-guide-close').addEventListener('click', () => guideDialog.close());
    guideDialog.addEventListener('click', event => { if (event.target === guideDialog) guideDialog.close(); });
  }
  const summary = $('#launch-review-summary');
  const page = $('#launch-dialog');
  function updateReview() {
    if (!summary) return;
    for (const [target, source, fallback] of [
      ['#review-token-name','#token-name','Token name'],
      ['#review-token-symbol','#token-symbol','TICKER'],
      ['#review-community','#preview-community','—'],
      ['#review-creator-buy','#preview-creator-buy','None'],
      ['#review-promotion','#preview-burn-tier','Standard'],
      ['#review-network','#preview-network','Solana Devnet'],
      ['#review-estimated-spend','#preview-launch-cost','Estimate unavailable'],
    ]) {
      const input = $(source);
      const output = $(target, summary);
      if (output) output.textContent = String(input?.value || input?.textContent || fallback).trim();
    }
    const estimate = $('#review-estimated-spend', summary);
    const estimateReady = /\bSOL\b/.test(estimate?.textContent || '');
    estimate?.classList.toggle('is-unavailable', !estimateReady);
    const estimateDetail = $('#review-estimate-detail', summary);
    if (estimateDetail) estimateDetail.textContent = estimateReady
      ? 'Check the itemized cost and confirm the fee route in the payment panel before signing.'
      : ($('#cost-note')?.textContent || 'Refresh the launch estimate before signing.');
    for (const [key, inputId, outputId, fallback] of [
      ['creator','#creator-wallet-share','#review-creator-share',80],
      ['holders','#holder-airdrop-share','#review-holder-share',0],
      ['x','#x-share','#review-x-share',0],
      ['protocol',null,'#review-protocol-share',20],
    ]) {
      const raw = inputId ? Number($(inputId)?.value) : fallback;
      const share = Number.isFinite(raw) ? Math.max(0, Math.min(100, raw)) : fallback;
      const output = $(outputId, summary);
      if (output) output.textContent = `${share}%`;
      const segment = $(`[data-review-share="${key}"]`, summary);
      if (segment) segment.style.width = `${share}%`;
    }
  }
  page?.addEventListener('input',updateReview);
  window.addEventListener('funded:launch-step', updateReview);
  const preview = $('.launch-preview-sticky');
  if (preview) new MutationObserver(updateReview).observe(preview,{subtree:true,childList:true,characterData:true});
  const funding = $('#community-airdrop-help');
  const reserve = $('#community-airdrop-tokens');
  reserve?.addEventListener('input', () => {
    const amount = Number(reserve.value);
    if (funding) funding.textContent = Number.isSafeInteger(amount) ? `${amount.toLocaleString()} tokens · ${(amount / 1e9 * 100).toFixed(2)}% of supply. Allowed: 30M–500M.` : 'Enter a whole token amount between 30M and 500M.';
  });
  const route = node('div','launch-distribution-summary');
  route.innerHTML = '<div class="distribution-bar" aria-label="80 percent creator-directed; 20 percent protocol"><i></i><i></i></div><p>80% creator-directed · 20% protocol<br><small>Percentages of gross collected creator fees. Allocation is not a paid reward.</small></p>';
  $('.fee-split-fixed')?.after(route);
  // The initial step is set by the application; align first paint before any interaction.
  page.dataset.step = '1';
  $$('[data-launch-step]',page).forEach(panel=>panel.hidden=panel.dataset.launchStep!=='1');
  updateReview();
}

function rewards() {
  const root = $('#payments'); if (!root) return;
  const x = node('div'); x.id = 'rewards-x';
  while(root.firstChild) x.append(root.firstChild);
  const overview = node('div'); overview.id = 'rewards-overview';
  overview.innerHTML = '<div class="workspace-page-header"><p class="eyebrow">Your rewards</p><h1>Rewards, in one place</h1><p>Choose a reward type to check eligibility, review available amounts, and find confirmed receipts.</p></div><div class="reward-entry-grid"><button type="button" data-reward-open="creator"><strong>Creator fees</strong><span>Collected fees from your tokens</span><small>Connect your launch wallet</small></button><button type="button" data-reward-open="holder"><strong>Holder rewards</strong><span>SOL distributions and eligibility</span><small>Snapshot and funding required</small></button><button type="button" data-reward-open="x"><strong>X partner rewards</strong><span>Claims linked to your X account</span><small>X sign-in required</small></button><a href="#referrals"><strong>Referral rewards</strong><span>Qualified activity and claim receipts</span><small>Wallet attribution required</small></a><a href="#airdrops"><strong>Token airdrops</strong><span>Allocation, eligibility, and claims</span><small>Verified vault and proof required</small></a></div><p class="source-note">Allocated amounts, claimable rewards, and confirmed payments are different states. Each reward type shows its own units and evidence.</p>';
  const creator = node('div'); creator.id = 'rewards-creator';
  creator.innerHTML = '<h2>Creator rewards</h2><p>Review collected fees for the connected launch wallet. Open a token in Portfolio to request a payout when its verified threshold is met.</p><p class="reward-wallet-prompt">Connect your launch wallet to see your records.</p><a class="secondary-button" href="#my-launches">Open Portfolio →</a>';
  const personal = $('[data-personal-rewards]'); if(personal)creator.append(personal);
  const xSummary = $('[data-x-rewards]',personal || creator);if(xSummary)x.prepend(xSummary);
  const holder = node('div'); holder.id = 'rewards-holder';
  const automatic = $('[data-automatic-rewards]'); if(automatic)holder.append(automatic);
  root.append(overview,creator,holder,x);
  const select = tabs(root,[{key:'overview',label:'Overview',panel:overview},{key:'creator',label:'Creator',panel:creator},{key:'holder',label:'Holder',panel:holder},{key:'x',label:'X partner',panel:x}],'Reward type');
  $$('[data-reward-open]',root).forEach(button=>button.addEventListener('click',()=>select(button.dataset.rewardOpen,true)));
  $$('a[href="#payments"]',personal || creator).forEach(link=>link.addEventListener('click',()=>select('x',true)));
  const syncIdentity=()=>{const prompt=$('.reward-wallet-prompt'); if(prompt)prompt.hidden=Boolean(document.documentElement.dataset.connectedWallet);};
  window.addEventListener('funded:reward-identity-change',syncIdentity); syncIdentity();
  text('.x-claim-heading h2','X partner claims');
  text('.x-claim-heading > div > p:last-child','Sign in with X, choose a reward, and review the destination wallet before approving.');
}

function secondaryPages() {
  text('#referral-command-title', 'Your referral activity');
  disclose($('.referral-toolkit'), 'Campaign links and sharing tools');
  const analytics = $('#analytics-detail');
  if(analytics){
    const details=node('details','ui-disclosure');
    details.innerHTML='<summary>Data source details</summary><p id="analytics-technical-source"></p>';
    details.querySelector('#analytics-technical-source').textContent=$('#analytics-range-status')?.textContent?.trim() || 'Source details unavailable.';
    analytics.append(details);
  }
  const receipts=$('.burn-receipts-panel');
  if(receipts)receipts.prepend(node('p','field-help','Supply reduction includes all on-chain burns; this ledger includes only verified receipts available to the app. Voluntary, promotion, and fee-funded burns are distinct.'));
  disclose($('.burn-policy-preview'), 'Fee-funded buyback policy · example calculator');
  const airdrops=$('#airdrops');
  if(airdrops){
    const group=(name,selectors,open=false)=>{const panel=node('section','airdrop-workspace');for(const selector of selectors){for(const item of $$(selector,airdrops))panel.append(item);} if(!panel.childElementCount)return; airdrops.append(panel);return disclose(panel,name,{open});};
    const heading=$(':scope > .section-heading',airdrops);
    const intro=$('.airdrop-intro',airdrops);
    const back=node('a','airdrop-back','← Back to home');back.href='#overview';
    heading?.before(back);
    const walletGate=node('section','airdrop-wallet-gate');
    walletGate.setAttribute('aria-label','Wallet eligibility');
    walletGate.innerHTML='<div class="airdrop-wallet-gate-top"><span>WALLET</span><strong>Not connected</strong></div><div class="airdrop-wallet-gate-body"><span class="airdrop-wallet-art" aria-hidden="true">◈</span><h3>Connect your wallet first</h3><p>Allocations are checked against your address. Connect to see eligibility when a verified snapshot and claim proof are available.</p><button type="button" class="primary-button">Connect wallet</button></div>';
    walletGate.querySelector('button').addEventListener('click',()=>$('#connect-button')?.click());
    const heroLayout=node('div','airdrop-hero-layout');
    const heroArt=node('figure','airdrop-hero-art');
    heroArt.innerHTML=`<img src="${airdropWolfDropUrl}" alt="A black wolf watching a descending community supply parcel" loading="lazy" />`;
    intro?.after(heroLayout);
    heroLayout.append(walletGate,heroArt);
    const syncAirdropWallet=()=>{const address=document.documentElement.dataset.connectedWallet;heroLayout.hidden=Boolean(address);walletGate.querySelector('.airdrop-wallet-gate-top strong').textContent=address?`${address.slice(0,4)}…${address.slice(-4)}`:'Not connected';};
    window.addEventListener('funded:reward-identity-change',syncAirdropWallet);syncAirdropWallet();
    const publicPrograms=node('section','airdrop-public-programs');
    publicPrograms.innerHTML='<div class="airdrop-public-rule"><span>LAUNCH AIRDROPS</span></div><div class="airdrop-reference-tabs" role="tablist" aria-label="Launch airdrop status"><button type="button" role="tab" aria-selected="true" data-public-airdrop-tab="upcoming">Upcoming <span>—</span></button><button type="button" role="tab" aria-selected="false" data-public-airdrop-tab="claiming">Claims open <span>—</span></button><button type="button" role="tab" aria-selected="false" data-public-airdrop-tab="closed">Closed <span>—</span></button></div>';
    for(const selector of ['.airdrop-directory-head','.airdrop-directory','#airdrop-directory-pagination','#airdrop-selected-program']){const item=$(selector,airdrops);if(item)publicPrograms.append(item);}
    heroLayout.after(publicPrograms);
    text('.airdrop-directory-head h2','Launch airdrops');
    const directory=$('#airdrop-directory',publicPrograms);
    directory?.setAttribute('role','tabpanel');
    for(const button of $$('[data-public-airdrop-tab]',publicPrograms)){button.id=`airdrop-${button.dataset.publicAirdropTab}-tab`;button.setAttribute('aria-controls','airdrop-directory');}
    let selectedPublicTab='upcoming';
    const syncPublicPrograms=()=>{
      const pending=Number(directory?.dataset.upcomingCount||0);
      const claiming=Number(directory?.dataset.claimingCount||0);
      const closed=Number(directory?.dataset.closedCount||0);
      for(const button of $$('[data-public-airdrop-tab]',publicPrograms)){
        const active=button.dataset.publicAirdropTab===selectedPublicTab;
        button.setAttribute('aria-selected',String(active));button.tabIndex=active?0:-1;
        button.querySelector('span').textContent=directory?.dataset.indexStatus==='ready'?String(button.dataset.publicAirdropTab==='upcoming'?pending:button.dataset.publicAirdropTab==='claiming'?claiming:closed):'—';
      }
      directory?.setAttribute('aria-labelledby',`airdrop-${selectedPublicTab}-tab`);
    };
    const selectPublicTab=status=>{selectedPublicTab=status;syncPublicPrograms();document.dispatchEvent(new CustomEvent('funded:airdrop-directory-status',{detail:{status}}));};
    publicPrograms.addEventListener('click',event=>{const button=event.target.closest('[data-public-airdrop-tab]');if(!button)return;selectPublicTab(button.dataset.publicAirdropTab);});
    publicPrograms.addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight'].includes(event.key)||!event.target.matches('[data-public-airdrop-tab]'))return;event.preventDefault();const buttons=$$('[data-public-airdrop-tab]',publicPrograms);const next=buttons[(buttons.indexOf(event.target)+(event.key==='ArrowRight'?1:buttons.length-1))%buttons.length];selectPublicTab(next.dataset.publicAirdropTab);next.focus();});
    if(directory)new MutationObserver(syncPublicPrograms).observe(directory,{childList:true});
    syncPublicPrograms();
    const evidence=node('details','airdrop-evidence');evidence.innerHTML='<summary>Allocation and verification status</summary>';
    for(const selector of ['#airdrop-summary-kpis','.community-airdrop-callout']){const item=$(selector,airdrops);if(item)evidence.append(item);}
    publicPrograms.after(evidence);
    const flow=$('.claim-flow',airdrops);
    if(flow){flow.classList.add('airdrop-reference-flow');const heading=node('div','airdrop-allocation-heading');heading.innerHTML='<p class="eyebrow">HOW ALLOCATION WORKS</p><h2>From holding to claiming</h2>';evidence.after(heading);heading.after(flow);}
    group('Creator management and distribution evidence',['.airdrop-detail-grid','.airdrop-wallets-card','.airdrop-enhancement-grid']);
  }
  const leaderboard=$('#leaderboard');
  if(leaderboard){const note=node('p','source-note','Burner and project boards use verified BurnChecked receipts. Creator ranks use confirmed launches. Trader ranking awaits a verified activity index.');note.id='leaderboard-source-note';$('.leaderboard-hero',leaderboard)?.after(note);}
  const walletPage=$('#wallet-page');
  if(walletPage&&!$('.wallet-profile-kicker',walletPage))$('.wallet-detail-title',walletPage)?.before(node('p','wallet-profile-kicker','SOLANA DEVNET · WALLET PROFILE'));
  const docs=$('#docs');
  if(docs) mountDocsReference(docs);
  const account=$('#profile');
  if(account){const links=node('nav','workspace-shortcuts');links.setAttribute('aria-label','Account tools');links.innerHTML='<a href="#creator-settings"><strong>Linked X account</strong><span>Creator identity and preferences</span></a><a href="#payments"><strong>Rewards & receipts</strong><span>Review the connected wallet’s activity</span></a>';account.append(links);}
}

function protocolPage() {
  const root = $('#paid');
  if (!root || $('.paid-reference-hero', root)) return;
  const policyContent = [...root.children];
  const hero = node('div', 'paid-reference-hero');
  hero.innerHTML = '<span class="paid-hero-mark" aria-hidden="true">ƒ</span><div><p class="eyebrow">$FUNDED · THE NETWORK TOKEN</p><h1>ONE TOKEN BEHIND EVERY LAUNCH.</h1><p>$FUNDED connects launch tiers, community allocations, and the published burn policy. Teams can burn it for promotion, while the platform tracks holder rewards and fee flows through verifiable records.</p><div class="paid-hero-actions"><a class="primary-button" href="#buybacks">BUY OR BURN $FUNDED ↗</a><a class="secondary-button" id="funded-token-chart" href="#explore" hidden>VIEW ON SOLANA ↗</a><a class="secondary-button" href="#explore">EXPLORE LAUNCHES</a><a class="secondary-button" href="#launch">BURN FOR A TIER</a></div></div>';
  const facts = node('div', 'paid-reference-metrics');
  facts.setAttribute('aria-label', '$FUNDED token and tier metrics');
  facts.innerHTML = '<div><span>PRICE</span><strong id="funded-token-price">$—</strong><small id="funded-token-price-note">Verified quote unavailable</small></div><div><span>MARKET CAP</span><strong id="funded-token-market-cap">$—</strong><small id="funded-token-market-cap-note">Verified market unavailable</small></div><div><span>$FUNDED BURNED</span><strong id="funded-token-burned">—</strong><small id="funded-token-burned-note">Checking on-chain supply</small></div><div><span>BOOST TIER</span><strong id="funded-token-boost">—</strong><small id="funded-token-boost-note">$FUNDED burn per launch</small></div><div><span>PRO TIER</span><strong id="funded-token-pro">—</strong><small id="funded-token-pro-note">$FUNDED burn per launch</small></div><div><span>PREMIER TIER</span><strong id="funded-token-premier">—</strong><small id="funded-token-premier-note">$FUNDED burn per launch</small></div>';
  const story = node('div', 'funded-token-story');
  story.innerHTML = '<article><h2>What it does here</h2><p>Teams can choose a paid launch tier by burning $FUNDED. The tier and amount are recorded with the launch, and the badge only appears after verification.</p><p>The burn receipt can be checked on-chain; a tier is a promotion signal, not a promise of liquidity or returns. The free Standard tier remains available.</p></article><article><h2>Why holding it matters</h2><p>Funded launches reserve community tokens for eligible $FUNDED holders. Eligibility, funding, and delivery are shown through their own records.</p><p>A policy allocation alone is not a completed airdrop. <a href="#airdrops">Review airdrops →</a></p></article><article><h2>The story</h2><p>Funded.vip links launches, creator fee routes, community rewards, and token burns in one place.</p><p>The published fee policy assigns a protocol share to operations, referrals, community, and a $FUNDED buyback and burn program. <a href="#capital-flow">Follow the fee route →</a></p></article>';
  const contract = node('div', 'funded-token-contract');
  contract.innerHTML = '<span>CONTRACT · <span id="funded-token-network">SOLANA DEVNET</span></span><code id="funded-token-mint">Mint not configured</code><button type="button" id="funded-token-copy" class="secondary-button" disabled>COPY</button>';
  const policy = node('details', 'funded-policy-details');
  const policySummary = node('summary', '', 'Read the full fee route policy');
  policy.append(policySummary, ...policyContent);
  const footer = node('footer', 'funded-token-footer');
  footer.innerHTML = '<div><a class="funded-token-footer-brand" href="#overview"><span aria-hidden="true">ƒ</span> funded.vip</a><p>Launches, rewards, and market activity on Solana with a route you can inspect.</p></div><nav aria-label="Funded protocol"><strong>PROTOCOL</strong><a href="#launch">Launch</a><a href="/funded" aria-current="page">$FUNDED</a><a href="#buybacks">Burn $FUNDED</a><a href="#explore">Explore</a><a href="#airdrops">Airdrops</a><a href="#docs">Docs</a></nav><nav aria-label="Legal"><strong>LEGAL</strong><a href="#privacy">Privacy</a><a href="#terms" data-info="terms">Terms</a><a href="#disclosures" data-info="disclosures">Disclosures</a><a href="#opt-out" data-info="opt-out">Opt out</a></nav><small>© 2026 FUNDED.VIP · POWERED BY $FUNDED</small>';
  root.append(hero, facts, story, contract, policy, footer);
  const tape = node('aside', 'funded-token-tape');
  tape.setAttribute('aria-label', 'Verified Devnet token figures');
  tape.innerHTML = '<div id="funded-token-tape-items"><span>Checking verified Devnet figures…</span></div><span class="funded-token-tape-network">SOLANA · DEVNET</span>';
  document.body.append(tape);
  $('#funded-token-copy')?.addEventListener('click', async () => {
    const mint = $('#funded-token-copy')?.dataset.mint;
    if (!mint) return;
    try { await navigator.clipboard.writeText(mint); $('#funded-token-copy').textContent = 'COPIED'; }
    catch { $('#funded-token-copy').textContent = 'COPY FAILED'; }
  });
  const detailKicker = $(':scope > .eyebrow', policy);
  if (detailKicker) detailKicker.textContent = 'Fee route details · published policy';
  const detailTitle = $(':scope > h2', policy);
  if (detailTitle) detailTitle.textContent = 'How the fee route works';
  window.dispatchEvent(new Event('funded:token-page-ready'));
}

function mergePurposePages() {
  const groups = [
    { host: '#my-launches', child: '#community', after: ':scope > .section-heading', childAtEnd: true, label: 'Portfolio sections', links: [['my-launches', 'Portfolio'], ['community', 'Watchlist']] },
    { host: '#analytics-detail', child: '#capital-flow', after: ':scope > .section-heading', childAtEnd: true, label: 'Analytics sections', links: [['analytics-detail', 'Activity'], ['capital-flow', 'Capital flow']] },
    { host: '#paid', child: '#buybacks', after: ':scope > .paid-reference-metrics', label: '$FUNDED sections', links: [['paid', 'Token overview'], ['buybacks', 'Buy & burn']] },
  ];
  for (const group of groups) {
    const host = $(group.host);
    const child = $(group.child);
    if (!host || !child || host.contains(child)) continue;
    const anchor = $(group.after, host);
    if (!anchor) continue;
    const nav = node('nav', 'purpose-page-nav');
    nav.setAttribute('aria-label', group.label);
    for (const [route, label] of group.links) {
      const link = node('a', '', label);
      link.href = `#${route}`;
      link.dataset.purposeRoute = route;
      nav.append(link);
    }
    anchor.after(nav);
    if (group.childAtEnd) host.append(child);
    else nav.after(child);
  }
}

function tokenPage() {
  const root=$('#coin-page');if(!root)return;
  const layout=$('.coin-layout',root);
  const chart=$('.coin-chart-panel',root);const column=chart?.parentElement;
  if(column)column.prepend(chart);
  const hero=$('.coin-hero-card',root);
  const stats=$('.coin-stat-strip',root);
  if(hero&&stats)hero.append(stats);
  if(layout&&hero)hero.after(layout);
  const description=$('#coin-description',root);
  let heroAside;
  if(hero&&description){
    const artwork=node('div','coin-artwork');
    artwork.setAttribute('aria-hidden','true');
    const packageLabel=node('span','coin-artwork-package');packageLabel.id='coin-artwork-package';packageLabel.hidden=true;
    const artworkSymbol=node('span','coin-artwork-symbol','TOKEN');artworkSymbol.id='coin-artwork-symbol';
    artwork.append(node('span','coin-artwork-network',EXPLORE_CLUSTER === 'mainnet-beta' ? 'SOLANA · MAINNET' : 'SOLANA · DEVNET'),packageLabel,artworkSymbol);
    hero.prepend(artwork);
    const symbolLabel=$('#coin-symbol',hero);
    const avatar=$('#coin-avatar',hero);
    const syncArtwork=()=>{
      artworkSymbol.textContent=symbolLabel?.textContent?.trim()||'TOKEN';
      const image=avatar?.style.backgroundImage;
      if(image&&image!=='none'){
        artwork.style.backgroundImage=`linear-gradient(0deg, #07130dc9, #07130d66), ${image}`;
        artwork.classList.add('has-image');
      }else{
        artwork.style.backgroundImage='';
        artwork.classList.remove('has-image');
      }
    };
    syncArtwork();
    if(symbolLabel)new MutationObserver(syncArtwork).observe(symbolLabel,{childList:true,characterData:true,subtree:true});
    if(avatar)new MutationObserver(syncArtwork).observe(avatar,{attributes:true,attributeFilter:['style']});
    const about=node('div','coin-hero-about');about.id='coin-profile';
    const aboutPanel=node('div','coin-profile-panel');
    const tagline=node('p','coin-profile-tagline');tagline.id='coin-profile-tagline';tagline.hidden=true;
    aboutPanel.append(tagline,description);
    const factRibbon=$('.coin-fact-ribbon',hero);
    if(factRibbon)aboutPanel.append(factRibbon);
    const updatesPanel=node('div','coin-profile-panel coin-profile-updates');
    updatesPanel.append(node('strong','','No signed updates available'),node('p','','Project updates are not indexed for this token. Confirmed trades and on-chain records appear below.'));
    const roadmapPanel=node('section','coin-profile-roadmap-section');roadmapPanel.id='coin-profile-roadmap-section';
    roadmapPanel.append(node('h3','','Project roadmap'));
    const roadmap=node('p','coin-profile-roadmap','No signed roadmap was provided for this token.');roadmap.id='coin-profile-roadmap';
    roadmapPanel.append(roadmap);
    const linksPanel=node('section','coin-profile-links');linksPanel.id='coin-profile-links';
    linksPanel.append(node('p','coin-profile-links-note','Project links come from signed launch metadata. Check the destination before connecting a wallet.'));
    const linksList=node('ul','coin-profile-links-list');linksList.id='coin-profile-links-list';linksPanel.append(linksList);
    about.append(aboutPanel,updatesPanel,roadmapPanel,linksPanel);
    const selectProfile=tabs(about,[{key:'about',label:'About',panel:aboutPanel},{key:'updates',label:'Updates',panel:updatesPanel},{key:'roadmap',label:'Roadmap',panel:roadmapPanel},{key:'links',label:'Links',panel:linksPanel}],'Token profile');
    window.fundedSetCoinProfileMetadata=details=>{
      const text=typeof details?.roadmap==='string'?details.roadmap.trim():'';
      roadmap.textContent=text;
      selectProfile.setAvailable('roadmap',Boolean(text));
      linksList.replaceChildren();
      for(const [label,href] of [['Website',details?.website],['X',details?.twitter],['Telegram',details?.telegram],['Discord',details?.discord]]){
        if(typeof href!=='string'||!href.startsWith('https://'))continue;
        let host;
        try{host=new URL(href).hostname;}catch{continue;}
        const item=node('li');const link=node('a','',`${label} ↗`);
        link.href=href;link.target='_blank';link.rel='noopener noreferrer';
        item.append(link,node('small','',host));linksList.append(item);
      }
      selectProfile.setAvailable('links',linksList.childElementCount>0);
    };
    window.fundedSetCoinProfileMetadata({});
    heroAside=node('div','coin-hero-aside');
    heroAside.append(about);
    hero.append(heroAside);
    window.fundedRenderCoinPromotionBadge?.();
  }
  const chartPanel=$('.coin-chart-panel',root);
  const chartPath=$('#coin-price-path',chartPanel);
  if(chartPath){
    const toolbar=node('div','coin-chart-toolbar');
    chartPath.before(toolbar);
    const controls=node('div','coin-chart-metric-controls');
    const range=node('div','coin-chart-metric-group coin-chart-period-group');range.setAttribute('role','group');range.setAttribute('aria-label','Observed trade range');
    range.append(node('span','coin-chart-range-label','RANGE'));
    for(const value of ['5m','1h','6h','24h']){const button=node('button','',value);button.type='button';button.dataset.coinChartPeriod=value;button.setAttribute('aria-pressed',String(value==='24h'));range.append(button);}
    controls.append(range);
    for(const [label,attribute,choices,selected] of [
      ['Chart measure','coinChartMetric',[['mcap','Market cap'],['price','Price']],'mcap'],
      ['Chart currency','coinChartUnit',[['usd','USD'],['sol','SOL']],'usd']
    ]){
      const group=node('div','coin-chart-metric-group');group.setAttribute('role','group');group.setAttribute('aria-label',label);
      for(const [value,text] of choices){const button=node('button','',text);button.type='button';button.dataset[attribute]=value;button.setAttribute('aria-pressed',String(value===selected));group.append(button);}
      controls.append(group);
    }
    toolbar.append(controls);
  }
  const metrics=$('#coin-summary-dashboard',root);
  if(layout&&metrics)layout.after(metrics);
  const trade=$('#trade-panel',root);
  const pulse=$('.coin-pulse-panel',root);
  const side=$('.coin-side-column',root);
  const curve=$('.coin-curve-track',root);
  const flow=$('.coin-flow',root);
  flow?.remove();
  if(trade&&curve){
    const market=node('section','panel coin-market-aside');
    market.append(node('h2','coin-market-aside-title','Bonding curve'),curve);
    trade.after(market);
  }
  if(pulse&&trade)trade.after(pulse);
  const policy=$('.coin-policy-card',root);
  const distribution=$('#coin-account-distribution',root);
  if(side&&policy&&distribution){
    const holders=node('section','panel coin-holders-aside');
    holders.setAttribute('aria-labelledby','coin-holders-aside-title');
    const heading=node('div','coin-holders-aside-head');
    const title=node('h2','','Holder distribution');title.id='coin-holders-aside-title';
    const view=node('button','coin-holders-aside-link','View holders →');view.type='button';
    view.addEventListener('click',()=>{
      $('#coin-page [data-coin-tab="holders"]')?.click();
      $('.coin-tabs-panel',root)?.scrollIntoView({behavior:'smooth',block:'start'});
    });
    heading.append(title,view);
    const status=node('p','coin-holders-aside-status','Checking verified holder wallets…');status.id='coin-holder-distribution-status';
    status.hidden=!distribution.hidden;
    holders.append(heading,distribution,status);
    policy.before(holders);
  }
  policy?.remove();
  const slippage=$('#trade-slippage')?.closest('label');disclose(slippage,'Trade settings · slippage');
  const button=node('button','mobile-trade-open','Trade token');button.type='button';
  const sheetBackground = new Map();
  const setSheet = open => {
    root.classList.toggle('trade-sheet-open',open);button.setAttribute('aria-expanded',String(open));
    if(open){
      for(let branch=trade;branch?.parentElement;branch=branch.parentElement){for(const sibling of branch.parentElement.children){if(sibling!==branch&&sibling.tagName!=='DIALOG'&&!sheetBackground.has(sibling)){sheetBackground.set(sibling,sibling.inert);sibling.inert=true;}}if(branch.parentElement===document.body)break;}
      trade?.setAttribute('role','dialog');trade?.setAttribute('aria-modal','true');trade?.setAttribute('aria-label','Trade token');trade?.setAttribute('tabindex','-1');trade?.focus();
    }
    else {for(const [element,inert] of sheetBackground)element.inert=inert;sheetBackground.clear();trade?.removeAttribute('role');trade?.removeAttribute('aria-modal');trade?.removeAttribute('aria-label');}
  };
  button.addEventListener('click',()=>setSheet(!root.classList.contains('trade-sheet-open')));
  button.setAttribute('aria-controls','trade-panel');button.setAttribute('aria-expanded','false');
  const tradeActionAnchor=$('.coin-stat-strip',root);
  if(tradeActionAnchor)tradeActionAnchor.after(button);else root.append(button);
  const close=node('button','mobile-trade-close','Close trade');close.type='button';close.addEventListener('click',()=>{setSheet(false);button.focus();});trade?.prepend(close);
  window.addEventListener('hashchange',()=>setSheet(false));
  matchMedia('(max-width:700px)').addEventListener('change',()=>setSheet(false));
  trade?.addEventListener('keydown',event=>{
    if(!root.classList.contains('trade-sheet-open')||!matchMedia('(max-width:700px)').matches)return;
    if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close.click();return;}
    if(event.key==='Tab'){const controls=$$('button,a,input,select,summary',trade).filter(el=>!el.disabled&&el.getClientRects().length);const first=controls[0],last=controls.at(-1);if(event.shiftKey&&(document.activeElement===first||document.activeElement===trade)){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}}
  });
}

let lastSyncedRoute = null;
function syncRoute() {
  const route=location.hash.slice(1)||(/^\/funded\/?$/.test(location.pathname)?'paid':/^\/list\/?$/.test(location.pathname)?'list':/^\/pilot\/?$/.test(location.pathname)?'pilot':/^\/explore\/?$/.test(location.pathname)?'explore':'overview');
  const mergedRoutes={community:'my-launches','capital-flow':'analytics-detail',buybacks:'paid'};
  const pageRoute=mergedRoutes[route]|| (route==='funded-holder-token-rewards'?'payments':route.startsWith('docs/')?'docs':route);
  const tokenOrWallet = /^\/(token|wallet|launch\/coin)\//.test(location.pathname) && !location.hash || route.startsWith('coin/');
  $$('[data-workspace-route]').forEach(element => { element.hidden = tokenOrWallet || element.dataset.workspaceRoute !== pageRoute; });
  const mobileRoute = tokenOrWallet
    ? (/^\/wallet\//.test(location.pathname) ? 'my-launches' : /^\/launch\/coin\//.test(location.pathname) ? 'launch' : 'explore')
    : ({ community: 'my-launches', leaderboard: 'explore', airdrops: 'payments', referrals: 'payments', profile: 'my-launches', list: 'launch', paid: 'payments' }[pageRoute] || pageRoute);
  $$('.mobile-workspace-nav a').forEach(link=>{if(link.hash===`#${mobileRoute}`)link.setAttribute('aria-current','page');else link.removeAttribute('aria-current');});
  $$('[data-purpose-route]').forEach(link=>{const active=link.dataset.purposeRoute===route||(!location.hash&&link.dataset.purposeRoute===pageRoute);if(active)link.setAttribute('aria-current','location');else link.removeAttribute('aria-current');});
  const more=$('.nav-more');if(more)more.open=!matchMedia('(min-width:1180px)').matches && Boolean($('a[aria-current="page"]',more));
  const target=$('#route-guide');if(target&&['payments','my-launches','community','profile'].includes(route))target.hidden=true;
  if(route==='community'){text('#community h2','Watchlist');}
  if(route==='funded-holder-token-rewards'){
    $('#rewards-holder-tab')?.click();
    requestAnimationFrame(()=>{
      const target=$('#funded-holder-token-rewards');
      if(!target?.getClientRects().length)return;
      target.tabIndex=-1;
      target.scrollIntoView({block:'start',behavior:'auto'});
      target.focus({preventScroll:true});
    });
  }
  if(pageRoute==='payments')document.title='Rewards · funded.vip';
  else if(route==='launch')document.title='Create a coin · funded.vip';
  else document.title=`${$('[data-route-label]')?.textContent||'funded.vip'} · funded.vip`;
  if(route!==lastSyncedRoute && !route.includes('/') && route!=='funded-holder-token-rewards') {
    // Each workspace route begins with its own header. Native fragment scrolling
    // can otherwise leave the shared header partly offscreen after layout changes.
    requestAnimationFrame(()=>requestAnimationFrame(()=>window.scrollTo({top:0,behavior:'instant'})));
  }
  lastSyncedRoute=route;
}

navigation(); home(); explore(); launch(); rewards(); secondaryPages(); protocolPage(); mergePurposePages(); tokenPage();
document.body.classList.add('workspace-ready');
window.addEventListener('funded:route-change',syncRoute);
window.addEventListener('hashchange',syncRoute);
matchMedia('(min-width:1180px)').addEventListener('change',syncRoute);
syncRoute();
