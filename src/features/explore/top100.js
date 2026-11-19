import {top100Template} from './top100-template.js';
import {top100Records, rankTop100} from './top100-model.js';
import {readTop100Url, top100Search} from './top100-url.js';
import {loadTokenArtwork} from '../shared/token-artwork.js';
import {exploreTableMarkup} from './explore-table-view.js';
import {withMarketWindow, enrichMarketRecord} from '../../../market-intelligence.js';

export function initializeTop100(appState) {
  const root = document.querySelector('#top100');
  if (!root) return;
  root.innerHTML = top100Template;
  const find = selector => root.querySelector(selector), esc = appState.escapeHtml;
  const filters = {sort:'featured', query:'', stage:'all', tier:'all', minCap:0, maxAge:0};
  let expiryTimer, community=null;
  let page = 0, busy = false, checked = false, failure = false, lastRows = '';
  const active = () => appState.requestedPageRoute() === 'top100';
  // Restore a shared view, then mirror later changes into the address bar.
  const allowed = {sort:[...root.querySelectorAll('[data-top-sort]')].map(button => button.dataset.topSort)};
  for (const control of root.querySelectorAll('select[data-top-filter]')) allowed[control.dataset.topFilter] = [...control.options].map(option => option.value);
  Object.assign(filters, readTop100Url(location.search, allowed));
  for (const control of root.querySelectorAll('[data-top-filter]')) control.value = String(filters[control.dataset.topFilter] ?? '');
  root.querySelectorAll('[data-top-sort]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.topSort === filters.sort)));
  // Phones collapse search and filters behind one toggle; an active filter keeps them open.
  const toolbar = root.querySelector('.top100-toolbar'), filterToggle = root.querySelector('[data-top-filter-toggle]');
  const setFiltersOpen = open => { toolbar?.classList.toggle('is-filters-open', open); filterToggle?.setAttribute('aria-expanded', String(open)); };
  setFiltersOpen(Boolean(filters.query || filters.stage !== 'all' || filters.tier !== 'all' || filters.minCap || filters.maxAge));
  filterToggle?.addEventListener('click', () => setFiltersOpen(!toolbar.classList.contains('is-filters-open')));
  const syncUrl = () => {
    if (!active()) return;
    const search = top100Search(location.search, filters);
    if (search !== location.search) history.replaceState(history.state, '', `${location.pathname}${search}${location.hash}`);
  };
  function render() {
    clearTimeout(expiryTimer);
    if (!active()) return;
    const records = top100Records((appState.assets || []).map(asset => ({...asset, launchAgeVerified:Boolean(appState.verifiedLaunchPolicyForMint(asset.address))})),
      {boosts:appState.verifiedBoosts || {}, solUsd:appState.coinSolUsdPrice, policies:appState.verifiedLaunchPolicies || [], cluster:appState.EXPLORE_CLUSTER, community});
    const nextExpiry=Math.min(...records.map(row=>row.boostNextExpiry).filter(Number.isFinite));
    if(Number.isFinite(nextExpiry))expiryTimer=setTimeout(render,Math.min(nextExpiry-Date.now()+20,2147483647));
    const result = rankTop100(records, filters), pages = Math.max(1,Math.ceil(result.rows.length / 25));
    page = Math.min(page, pages - 1);
    // Status line only for loading, refresh and data problems; a normal load shows nothing.
    const status = busy ? 'Refreshing rankings…' : failure ? 'Refresh unavailable. Showing last loaded data; retry shortly.' : !checked ? 'Loading rankings…' : '';
    find('[data-top-status]').textContent = [status, checked && !appState.verifiedBoostsAvailable ? 'Boost data unavailable.' : '',
      checked && !community ? '24h ranking metrics unavailable; retry shortly.' : ''].filter(Boolean).join(' · ');
    const rows = result.rows.slice(page * 25, (page + 1) * 25);
    // Same row layout as Explore's table view, in Top 100 rank order.
    const byMint = new Map((appState.assets || []).map(asset => [asset.address, asset]));
    const benefits = appState.withVerifiedExploreBenefits || (item => item);
    const items = rows.map(row => {
      const asset = byMint.get(row.mint) || {address:row.mint, symbol:row.symbol, name:row.name, imageUri:row.imageUri};
      const base = {...asset, holders:asset.holders ?? row.holders ?? null, holderChange24hPercent:asset.holderChange24hPercent ?? null};
      const record = benefits(appState.EXPLORE_CLUSTER === 'devnet' ? withMarketWindow(base, '24h') : enrichMarketRecord(base));
      return {...record, top100Rank:row.rank};
    });
    const empty = busy || !checked ? 'Loading token data…' : failure ? 'Token rankings are temporarily unavailable. They retry automatically every minute.' : filters.sort === 'boosted' ? appState.verifiedBoostsAvailable ? 'No active boosts match these filters. Boost a token from Market cap or Explore.' : 'Boost data is temporarily unavailable. It retries automatically every minute.' : filters.sort === 'market-cap' && !records.some(row=>row.capGrowthUsd!=null) ? '24h market-cap growth is not available yet. Both opening and current valuations are required.' : 'No ranked tokens match these filters. Reset filters or browse Explore.';
    const html = items.length ? exploreTableMarkup(items, {
      cluster:appState.EXPLORE_CLUSTER, providerStatus:appState.exploreProviderStatus, windowLabel:'24h',
      volumeValue:item => appState.launchCardVolumeUsd(item, '24h'), formatAge:appState.formatOnchainAge, watchMarkup:appState.tokenCardWatchMarkup,
      boostMarkup:appState.exploreBoostAmountMarkup,
      paidListing:item => appState.verifiedPaidListingPayment?.(item) || (item.listingPayment?.verified === true && (item.listingPayment.admin === true || item.listingPayment.signature) ? item.listingPayment : null),
      rankOf:item => item.top100Rank,
    }) : `<p class="top100-empty">${esc(empty)}</p>`;
    // Keep keyboard focus and loaded logos intact when a refresh changes no rows.
    if (html !== lastRows) {
      const focused = document.activeElement?.dataset?.boostMint;
      find('[data-top-table]').innerHTML = html; lastRows = html;
      for (const row of root.querySelectorAll('tr[data-mint]')) {
        const avatar = row.querySelector('.home-token-avatar');
        if (!avatar || avatar.querySelector('img')) continue;
        loadTokenArtwork(avatar, row.dataset.mint, appState.verifiedLaunchPolicyForMint(row.dataset.mint)?.imageUri);
      }
      if (focused) root.querySelector(`[data-boost-mint="${CSS.escape(focused)}"]`)?.focus({preventScroll:true});
    }
    find('[data-top-page]').textContent = `Page ${page + 1} of ${pages} · ${result.rows.length} tokens`;
    find('[data-top-prev]').disabled = page === 0;
    find('[data-top-next]').disabled = page + 1 >= pages;
  }
  async function refresh(signal) {
    if (busy) return;
    busy = true; render();
    try {
      await Promise.all([appState.loadVerifiedLaunchPolicies(signal), appState.loadVerifiedBoosts(signal), appState.loadOnchainExploreData(signal),
        appState.apiRequest('/api/top100/metrics',{signal}).then(response=>{community=response?.available?response.data:null;}).catch(()=>{community=null;})]);
      // A route transition may have joined an earlier 40-token Explore request.
      if (active() && !appState.top100FeedChecked) await appState.loadOnchainExploreData(signal);
      signal?.throwIfAborted();
      checked = true; failure = !appState.exploreFeedAvailable || !appState.top100FeedChecked || appState.top100VerificationFailed;
    } catch { if (!signal?.aborted) {checked = true; failure = true;} }
    finally {busy = false; render();}
  }
  root.addEventListener('click', event => {
    const sort = event.target.closest('[data-top-sort]');
    if (sort) {filters.sort = sort.dataset.topSort;page = 0;root.querySelectorAll('[data-top-sort]').forEach(button => button.setAttribute('aria-pressed',String(button === sort)));render();syncUrl();}
    const boost = event.target.closest('[data-boost-mint]');
    if (boost) appState.openExploreBoost(boost.dataset.boostMint);
    if (event.target.closest('[data-top-prev]')) {page--;render();}
    if (event.target.closest('[data-top-next]')) {page++;render();}
    if (event.target.closest('[data-top-reset]')) {
      for (const control of root.querySelectorAll('[data-top-filter]')) {
        control.value = control.tagName === 'SELECT' ? control.options[0].value : '';
        filters[control.dataset.topFilter] = ['minCap','maxAge'].includes(control.dataset.topFilter) ? Number(control.value) : control.value;
      }
      page = 0;render();syncUrl();
    }
  });
  root.addEventListener('input', event => {
    const key = event.target.dataset.topFilter;if (!key) return;
    filters[key] = ['minCap','maxAge'].includes(key) ? Number(event.target.value) : event.target.value;
    page = 0;render();syncUrl();
  });
  for (const name of ['funded:verified-search-index','funded:rankings-updated','funded:holders-updated']) document.addEventListener(name,render);
  appState.createRoutePoller({run:refresh, active, intervalMs:60_000});
  if (active()) void refresh();
}
