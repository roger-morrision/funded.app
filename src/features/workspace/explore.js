import { $, node, text, $$ } from './dom.js';
import { readExploreFilterUrl } from '../../../explore-filter-url.js';
import { sanitizeExploreFilters } from '../../../explore-filter-url.js';

export function explore() {
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
  if (stage) text('[data-explore-stage="near"]', 'Near migration');
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
