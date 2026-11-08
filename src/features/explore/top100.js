import {icon} from '../../../ui-icons.js';
import {top100Template} from './top100-template.js';
import {top100Records, rankTop100} from './top100-model.js';
import {loadTokenArtwork} from '../shared/token-artwork.js';

export function initializeTop100(appState) {
  const root = document.querySelector('#top100');
  if (!root) return;
  root.innerHTML = top100Template;
  const find = selector => root.querySelector(selector), esc = appState.escapeHtml;
  const filters = {sort:'market-cap', query:'', stage:'all', tier:'all', minCap:0, maxAge:0};
  let page = 0, busy = false, checked = false, failure = false, lastRows = '';
  const active = () => appState.requestedPageRoute() === 'top100';
  const money = value => value == null ? '—' : new Intl.NumberFormat('en-US', {style:'currency', currency:'USD', maximumFractionDigits:2, notation:value >= 10000 ? 'compact' : 'standard'}).format(value);
  const age = hours => hours == null ? '—' : hours < 1 ? `${Math.floor(hours * 60)}m` : hours < 24 ? `${Math.floor(hours)}h` : `${Math.floor(hours / 24)}d`;
  function render() {
    if (!active()) return;
    const records = top100Records((appState.assets || []).map(asset => ({...asset, launchAgeVerified:Boolean(appState.verifiedLaunchPolicyForMint(asset.address))})), {boosts:appState.verifiedBoosts || {}, solUsd:appState.coinSolUsdPrice})
      .map(row => ({...row, tier:appState.promotionForMint(row.mint)?.tier || (appState.verifiedLaunchPolicyForMint(row.mint) ? 'standard' : 'external')}));
    const result = rankTop100(records, filters), pages = Math.max(1,Math.ceil(result.rows.length / 25));
    page = Math.min(page, pages - 1);
    const priced = records.filter(row => row.capUsd != null).length;
    const coverage = checked && appState.top100DirectoryComplete ? 'Directory checked' : 'Directory coverage incomplete';
    const status = busy ? 'Refreshing verified rankings…' : failure ? 'Refresh unavailable. Showing last loaded data; retry shortly.' : !checked ? 'Loading verified rankings…' : `${coverage} · ${result.rows.length} of ${result.total} ranked tokens · ${records.length - priced} without market cap`;
    find('[data-top-status]').textContent = status + (checked && !appState.verifiedBoostsAvailable ? ' · Boost data unavailable.' : '');
    find('[data-top-refresh]').disabled = busy;
    const rows = result.rows.slice(page * 25, (page + 1) * 25);
    const html = rows.map(row => `<tr${row.boost >= 500 ? ' class="top100-golden"' : ''}>
      <td class="top100-rank">${row.rank}</td><th scope="row"><a class="top100-token" href="/token/${esc(row.mint)}"><span class="top100-logo" data-top-logo="${esc(row.mint)}" aria-hidden="true">${esc((row.symbol || 'T').slice(0,1))}</span><span><strong>${esc(row.name || row.symbol || row.mint)}</strong><small>$${esc(row.symbol || '—')}</small></span></a></th>
      <td><span class="top100-tier">${esc(row.tier.charAt(0).toUpperCase()+row.tier.slice(1))}</span></td>
      <td class="top100-cap">${money(row.capUsd)}</td><td class="top100-volume">${row.volumeUsd != null && row.partial ? '≥' : ''}${money(row.volumeUsd)}</td>
      <td>${row.trades == null ? '—' : `${row.partial ? '≥' : ''}${row.trades.toLocaleString()}`}</td><td class="${row.change == null ? '' : row.change < 0 ? 'top100-negative' : 'top100-positive'}">${row.change == null ? '—' : `${row.change > 0 ? '+' : ''}${row.change.toFixed(2)}%`}</td>
      <td>${age(row.ageHours)}</td><td>${row.stage === 'curve' ? 'On curve' : row.stage === 'migrated' ? 'Migrated' : 'Unverified'}</td>
      <td class="top100-boost">${appState.verifiedBoostsAvailable ? row.boost > 0 ? `${row.boost.toLocaleString()}× <small>Sponsored</small>` : '—' : 'Unavailable'}</td>
      <td><button type="button" class="secondary-button" data-top-boost="${esc(row.mint)}" aria-label="Boost ${esc(row.symbol || row.name || row.mint)}"><span class="boost-leading-icon">${icon('boost')}</span>Boost</button></td></tr>`).join('') || `<tr><td colspan="11" class="top100-empty">${busy || !checked ? 'Loading token data…' : failure ? 'Token rankings are temporarily unavailable. Use Refresh to retry.' : filters.sort === 'boosted' ? appState.verifiedBoostsAvailable ? 'No active boosts match these filters. Boost a token from Market cap or Explore.' : 'Boost data is temporarily unavailable. Use Refresh to retry.' : 'No ranked tokens match these filters. Reset filters or browse Explore.'}</td></tr>`;
    // Keep keyboard focus and loaded logos intact when a refresh changes no rows.
    if (html !== lastRows) {
      const focused = document.activeElement?.dataset?.topBoost;
      find('[data-top-rows]').innerHTML = html; lastRows = html;
      for (const node of root.querySelectorAll('[data-top-logo]')) {
        const row = rows.find(item => item.mint === node.dataset.topLogo);
        const policy = appState.verifiedLaunchPolicyForMint(row.mint);
        loadTokenArtwork(node,row.mint,row.imageUri || policy?.imageUri);
      }
      if (focused) (root.querySelector(`[data-top-boost="${CSS.escape(focused)}"]`) || find('[data-top-refresh]')).focus({preventScroll:true});
    }
    find('[data-top-page]').textContent = `Page ${page + 1} of ${pages} · ${result.rows.length} tokens`;
    find('[data-top-prev]').disabled = page === 0;
    find('[data-top-next]').disabled = page + 1 >= pages;
  }
  async function refresh(signal) {
    if (busy) return;
    busy = true; render();
    try {
      await Promise.all([appState.loadVerifiedLaunchPolicies(signal), appState.loadVerifiedBoosts(signal), appState.loadOnchainExploreData(signal)]);
      // A route transition may have joined an earlier 40-token Explore request.
      if (active() && !appState.top100FeedChecked) await appState.loadOnchainExploreData(signal);
      signal?.throwIfAborted();
      checked = true; failure = !appState.exploreFeedAvailable || !appState.top100FeedChecked || appState.top100VerificationFailed;
    } catch { if (!signal?.aborted) {checked = true; failure = true;} }
    finally {busy = false; render();}
  }
  root.addEventListener('click', event => {
    const sort = event.target.closest('[data-top-sort]');
    if (sort) {filters.sort = sort.dataset.topSort;page = 0;root.querySelectorAll('[data-top-sort]').forEach(button => button.setAttribute('aria-pressed',String(button === sort)));render();}
    const boost = event.target.closest('[data-top-boost]');
    if (boost) appState.openExploreBoost(boost.dataset.topBoost);
    if (event.target.closest('[data-top-refresh]')) void refresh();
    if (event.target.closest('[data-top-prev]')) {page--;render();}
    if (event.target.closest('[data-top-next]')) {page++;render();}
    if (event.target.closest('[data-top-reset]')) {
      for (const control of root.querySelectorAll('[data-top-filter]')) {
        control.value = control.tagName === 'SELECT' ? control.options[0].value : '';
        filters[control.dataset.topFilter] = ['minCap','maxAge'].includes(control.dataset.topFilter) ? Number(control.value) : control.value;
      }
      page = 0;render();
    }
  });
  root.addEventListener('input', event => {
    const key = event.target.dataset.topFilter;if (!key) return;
    filters[key] = ['minCap','maxAge'].includes(key) ? Number(event.target.value) : event.target.value;
    page = 0;render();
  });
  for (const name of ['funded:verified-search-index','funded:rankings-updated']) document.addEventListener(name,render);
  appState.createRoutePoller({run:refresh, active, intervalMs:60_000});
  if (active()) void refresh();
}
