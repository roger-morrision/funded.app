import { paginateExploreRows, explorePageNumbers } from '../../../explore-pagination.js';
import { escapeHtml, formatCompactUsd } from '../shared/display.js';
import { activeBoostMultiplier } from '../../../boost-offer.js';
import { icon } from '../../../ui-icons.js';
import { createExploreEmptyAction } from './empty-action.js';

// Measure the complete outline against the real viewport and clipping ancestors.
// These helpers never change focus, row identity, data order or application state.
function registryPrimaryBox(anchor, document) {
  const view = document.defaultView, rect = anchor.getBoundingClientRect(), css = view.getComputedStyle(anchor);
  const edge = Math.max(0, parseFloat(css.outlineWidth) || 0) + Math.max(0, parseFloat(css.outlineOffset) || 0);
  const bounds = { left:0, right:view.innerWidth, top:0, bottom:view.innerHeight };
  const root = view.getComputedStyle(document.documentElement);
  for (const chrome of document.querySelectorAll('.topbar,.mobile-workspace-nav')) {
    if (!chrome.getClientRects().length || chrome.contains(anchor)) continue;
    const style = view.getComputedStyle(chrome), box = chrome.getBoundingClientRect();
    if (!['fixed','sticky'].includes(style.position)) continue;
    if (chrome.matches('.topbar')) bounds.top = Math.max(bounds.top, box.bottom);
    else bounds.bottom = Math.min(bounds.bottom, box.top);
  }
  for (let parent = anchor.parentElement; parent; parent = parent.parentElement) {
    const style = view.getComputedStyle(parent);
    const viewport = parent === document.documentElement || (parent === document.body
      && root.overflowX === 'visible' && root.overflowY === 'visible' && root.contain === 'none' && style.contain === 'none');
    if (viewport) continue;
    const clipX = /^(hidden|clip|auto|scroll)$/.test(style.overflowX), clipY = /^(hidden|clip|auto|scroll)$/.test(style.overflowY);
    if (!clipX && !clipY) continue;
    const box = parent.getBoundingClientRect(), left = box.left + parent.clientLeft, top = box.top + parent.clientTop;
    const right = left + parent.clientWidth, bottom = top + parent.clientHeight;
    if (clipX) { bounds.left = Math.max(bounds.left,left); bounds.right = Math.min(bounds.right,right); }
    if (clipY) { bounds.top = Math.max(bounds.top,top); bounds.bottom = Math.min(bounds.bottom,bottom); }
    if (clipX && clipY) {
      const radii = ['borderTopLeftRadius','borderTopRightRadius','borderBottomRightRadius','borderBottomLeftRadius']
        .map(key => Math.max(0,(parseFloat(style[key]) || 0) - parent.clientLeft));
      // At the outline's current coordinates, inset each rounded clip boundary
      // by its exact circular arc. Subsequent ancestor moves remeasure it.
      const arc = (radius,distance) => radius && distance < radius
        ? radius - Math.sqrt(Math.max(0,radius * radius - (radius - Math.max(0,distance)) ** 2)) : 0;
      bounds.top = Math.max(bounds.top,top + arc(radii[0],rect.left-edge-left),top + arc(radii[1],right-rect.right-edge));
      bounds.bottom = Math.min(bounds.bottom,bottom - arc(radii[3],rect.left-edge-left),bottom - arc(radii[2],right-rect.right-edge));
      bounds.left = Math.max(bounds.left,left + arc(radii[0],rect.top-edge-top),left + arc(radii[3],bottom-rect.bottom-edge));
      bounds.right = Math.min(bounds.right,right - arc(radii[1],rect.top-edge-top),right - arc(radii[2],bottom-rect.bottom-edge));
    }
  }
  const x = rect.left-edge < bounds.left ? rect.left-edge-bounds.left : rect.right+edge > bounds.right ? rect.right+edge-bounds.right : 0;
  const y = rect.top-edge < bounds.top ? rect.top-edge-bounds.top : rect.bottom+edge > bounds.bottom ? rect.bottom+edge-bounds.bottom : 0;
  return { clear:x === 0 && y === 0, x, y };
}

function revealRetainedRegistryPrimary(owner, list, document, state, criteriaKey, page) {
  const anchor = owner.anchor;
  if (!owner.wasFullyVisible || !anchor.isConnected || document.activeElement !== anchor || !anchor.matches(':focus-visible')
    || anchor.getAttribute('href') !== owner.href || owner.row.dataset.logoMint !== owner.mint || owner.row.parentElement !== list
    || owner.spine?.length !== 5 || !owner.spine.every((node,index) => node.isConnected && (index === 0 ? node === owner.row : node.parentElement === owner.spine[index-1]))
    || !document.body.classList.contains('page-route-explore') || document.location.hash !== owner.routeHash
    || document.querySelector('#explore')?.dataset.exploreView !== 'table' || state.registryCriteriaKey !== criteriaKey || state.registryPage !== page
    || [...document.querySelectorAll('dialog[open], [aria-modal="true"]')].some(modal => modal.getClientRects().length)) return;
  const view = document.defaultView, scrollers = [];
  for (let parent = anchor.parentElement; parent && parent !== document.body && parent !== document.documentElement; parent = parent.parentElement) scrollers.push(parent);
  scrollers.push(view);
  // One synchronous pass, nearest ancestor first. Each actual scroll moves only
  // the remaining hidden amount; clamped inner scrolling can fall through outward.
  for (const target of scrollers) {
    const box = registryPrimaryBox(anchor,document); if (box.clear) return;
    const style = target === view ? null : view.getComputedStyle(target);
    const canX = target === view || (/^(auto|scroll|hidden)$/.test(style.overflowX) && target.scrollWidth > target.clientWidth);
    const canY = target === view || (/^(auto|scroll|hidden)$/.test(style.overflowY) && target.scrollHeight > target.clientHeight);
    const round = value => value > 0 ? Math.ceil(value) : Math.floor(value);
    const left = canX ? round(box.x) : 0, top = canY ? round(box.y) : 0;
    if (left || top) target.scrollBy({ left, top, behavior:'instant' });
  }
}

// Keep only the currently owned primary-link branch connected. The rest of the
// row and list still come from the current renderer output, in current data order.
function updateFocusedRegistryRow(list, original, rowMarkup, rows, document) {
  const keys = rows.map(item => item.address);
  const trustedKeys = keys.every(key => typeof key === 'string' && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(key))
    && new Set(keys).size === keys.length;
  if (!trustedKeys) return 'invalid';
  if (!keys.includes(original.mint)) return 'removed';
  const template = document.createElement('template');
  template.innerHTML = rowMarkup;
  const nextRows = [...template.content.children];
  if (nextRows.length !== rows.length || nextRows.some((row, index) =>
    !row.matches('.scanner-row[role="row"]') || row.dataset.logoMint !== keys[index])) return 'invalid';
  const nextRow = nextRows.find(row => row.dataset.logoMint === original.mint);
  const links = nextRow.querySelectorAll('.scanner-token-link');
  const nextLink = links.length === 1 ? links[0] : null;
  if (!nextLink || nextLink.getAttribute('href') !== original.href) return 'invalid';
  const branch = (link, row) => {
    const nodes = [];
    for (let node = link; node; node = node.parentElement) {
      nodes.unshift(node);
      if (node === row) return nodes;
    }
    return [];
  };
  const current = branch(original.anchor, original.row), next = branch(nextLink, nextRow);
  // These five nodes are owned by the unchanged row template, not external DOM.
  const tags = ['DIV', 'DIV', 'SPAN', 'SPAN', 'A'];
  const classes = ['scanner-row', 'scanner-token', '', 'scanner-token-heading', 'scanner-token-link'];
  if (current.length !== tags.length || next.length !== tags.length || current.some((node, index) =>
    node.tagName !== tags[index] || next[index].tagName !== tags[index]
    || (classes[index] && (!node.classList.contains(classes[index]) || !next[index].classList.contains(classes[index]))))) return 'invalid';
  original.spine = current;
  const ownedAttributes = [['class', 'role', 'data-logo-mint'], ['class', 'role'], [], ['class'], ['class']];
  for (let index = current.length - 1; index >= 0; index--) {
    const target = current[index], fresh = next[index];
    for (const name of ownedAttributes[index]) {
      if (fresh.hasAttribute(name)) target.setAttribute(name, fresh.getAttribute(name));
      else target.removeAttribute(name);
    }
    if (index === current.length - 1) {
      target.replaceChildren(...fresh.childNodes);
      continue;
    }
    const retained = current[index + 1], placeholder = next[index + 1];
    for (const child of [...target.childNodes]) if (child !== retained) child.remove();
    let before = true;
    for (const child of [...fresh.childNodes]) {
      if (child === placeholder) { before = false; continue; }
      if (before) target.insertBefore(child, retained);
      else target.append(child);
    }
  }
  for (const child of [...list.childNodes]) if (child !== original.row) child.remove();
  let before = true;
  for (const row of nextRows) {
    if (row === nextRow) { before = false; continue; }
    if (before) list.insertBefore(row, original.row);
    else list.append(row);
  }
  return 'retained';
}

// Render current data; the application owns pagination and paused-order state.
export function renderRegistry(query, state, {
  getWatchlist,
  getFollowingTokenSources,
  filterExploreTabRecords,
  exploreOutageCopy,
  exploreEmptyReason,
  exploreStageLabel,
  formatOnchainAge,
  explorePaidListingBagMarkup,
  exploreBoostAmountMarkup,
  exploreSocialLinksMarkup,
  exploreTierBadgeMarkup,
  exploreMarketCapUsd,
  formatExploreTradeCount,
  formatExploreUsd,
  exploreAirdropMarkup,
  loadVerifiedTokenLogos,
  renderWatchlist,
  document = globalThis.document,
}) {
  const {
    exploreSort,
    exploreRisk,
    exploreStage,
    exploreAuthority,
    explorePromotion,
    exploreReward,
    exploreTab,
    exploreNewLane,
    exploreWindow,
    exploreMaxAgeHours,
    exploreMinVolumeUsd,
    exploreMinMarketCapUsd,
    exploreMinTrades,
    exploreMinTraders,
    registryLaunches,
    exploreProviderStatus,
    exploreLastVerifiedAt,
    assets,
    exploreFeedAvailable,
    verifiedBoosts,
    EXPLORE_CLUSTER,
  } = state;
  const previousCriteriaKey = state.registryCriteriaKey, previousPage = state.registryPage;
  const followingSources = exploreTab === 'following' ? getFollowingTokenSources() : null;
  const criteriaKey = JSON.stringify([query, exploreSort, exploreRisk, exploreStage, exploreAuthority,
    explorePromotion, exploreReward, exploreTab, exploreNewLane, exploreWindow, exploreMaxAgeHours,
    exploreMinVolumeUsd, exploreMinMarketCapUsd, exploreMinTrades, exploreMinTraders, getWatchlist(),
    followingSources ? [...followingSources.keys()].sort() : null]);
  if (criteriaKey !== state.registryCriteriaKey) { state.registryPage = 1; state.registryCriteriaKey = criteriaKey; }
  const filtered = filterExploreTabRecords(registryLaunches, query);
  const page = paginateExploreRows(filtered, state.registryPage);
  state.registryPage = page.page;
  const registryLoading = exploreProviderStatus === 'On-chain only · loading' && !exploreLastVerifiedAt;
  const registryUnavailable = !registryLoading && !assets.length && ((!exploreFeedAvailable && !exploreLastVerifiedAt) || /RPC (?:rate limited|unavailable)/i.test(exploreProviderStatus));
  const outage = exploreOutageCopy();
  const count = document.querySelector('#scanner-count');
  if (count) count.textContent = registryLoading ? 'Checking launches' : registryUnavailable ? outage.title : `${filtered.length} of ${registryLaunches.length} shown`;
  const range = document.querySelector('#scanner-range');
  if (range) range.textContent = registryLoading ? 'Loading' : registryUnavailable ? 'Unavailable' : page.total ? `${page.start + 1}–${page.end} of ${page.total} launches` : '0 launches';
  const pageLabel = document.querySelector('#scanner-page-label');
  if (pageLabel) pageLabel.textContent = `Page ${page.page} of ${page.pages}`;
  const pagination = document.querySelector('#scanner-pagination');
  if (pagination) {
    pagination.hidden = page.pages <= 1;
    pagination.querySelector('[data-registry-page="prev"]').disabled = page.page <= 1;
    pagination.querySelector('[data-registry-page="next"]').disabled = page.page >= page.pages;
    const numbers = pagination.querySelector('#scanner-page-numbers');
    if (numbers) numbers.innerHTML = explorePageNumbers(page.page, page.pages).map(number => `<button type="button" data-registry-page="${number}" aria-label="Page ${number}" ${number === page.page ? 'aria-current="page"' : ''}>${number}</button>`).join('');
  }
  const list = document.querySelector('#launch-list');
  if (!list) return;
  const activePrimary = document.activeElement;
  const primaryRow = activePrimary?.closest?.('.scanner-row');
  const primaryMint = primaryRow?.dataset.logoMint;
  const primaryHref = typeof primaryMint === 'string' ? `/token/${encodeURIComponent(primaryMint)}` : null;
  const primaryOwner = document.body?.classList.contains('page-route-explore')
    && document.querySelector('#explore')?.dataset.exploreView === 'table'
    && previousCriteriaKey === criteriaKey && previousPage === page.page
    && activePrimary?.isConnected && activePrimary.matches?.('a.scanner-token-link')
    && activePrimary.getClientRects().length && primaryRow?.parentElement === list
    && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(primaryMint || '')
    && [...list.children].filter(row => row.dataset.logoMint === primaryMint).length === 1
    && primaryRow.querySelectorAll('.scanner-token-link').length === 1
    && activePrimary.getAttribute('href') === primaryHref
    ? { anchor:activePrimary, row:primaryRow, mint:primaryMint, href:primaryHref, routeHash:document.location.hash,
      wasFullyVisible:activePrimary.matches(':focus-visible') && registryPrimaryBox(activePrimary,document).clear } : null;
  const restoreRemovedPrimary = removed => {
    if (!removed || !primaryOwner || !document.body?.classList.contains('page-route-explore')
      || [...document.querySelectorAll('dialog[open], [aria-modal="true"]')].some(modal => modal.getClientRects().length)
      || (document.activeElement !== primaryOwner.anchor && document.activeElement !== document.body)) return;
    const search = document.querySelector('#explore-search');
    if (!search || search.disabled || !search.getClientRects().length) return;
    search.focus({ preventScroll:true });
    const rect = search.getBoundingClientRect(), css = getComputedStyle(search);
    const edge = Math.max(0, parseFloat(css.outlineWidth) || 0) + Math.max(0, parseFloat(css.outlineOffset) || 0);
    const header = document.querySelector('.topbar'), nav = document.querySelector('.mobile-workspace-nav');
    const top = header?.getClientRects().length && ['fixed', 'sticky'].includes(getComputedStyle(header).position)
      ? Math.max(0, header.getBoundingClientRect().bottom) : 0;
    const bottom = nav?.getClientRects().length && getComputedStyle(nav).position === 'fixed'
      ? Math.min(globalThis.innerHeight, nav.getBoundingClientRect().top) : globalThis.innerHeight;
    const hiddenY = rect.top - edge < top ? rect.top - edge - top
      : rect.bottom + edge > bottom ? rect.bottom + edge - bottom : 0;
    const hiddenX = rect.left - edge < 0 ? rect.left - edge
      : rect.right + edge > globalThis.innerWidth ? rect.right + edge - globalThis.innerWidth : 0;
    // Search is outside the Table scroller. Move the viewport by its remaining
    // covered outline instead of centering through hidden overflow ancestors.
    const round = value => value > 0 ? Math.ceil(value) : Math.floor(value);
    if (hiddenX || hiddenY) document.defaultView.scrollBy({ left:round(hiddenX), top:round(hiddenY), behavior:'instant' });
  };
  // Replacing Table rows during a background refresh also replaces the focused
  // tier button. Keep the user's current keyboard position across that render.
  const activeTier = document.activeElement;
  const focusedMint = document.body?.classList.contains('page-route-explore')
    && list.contains(activeTier) && activeTier.matches?.('[data-tier-info-mint]')
    ? activeTier.dataset.tierInfoMint : null;
  const restoreTierFocus = () => {
    if (!focusedMint || (document.activeElement !== document.body && document.activeElement !== activeTier)) return;
    const visible = element => element && !element.disabled && element.getClientRects().length;
    const current = [...list.querySelectorAll('[data-tier-info-mint]')]
      .find(button => button.dataset.tierInfoMint === focusedMint && visible(button));
    const target = current || document.querySelector('#explore-search');
    if (!visible(target)) return;
    target.focus({ preventScroll: true });
    const rect = target.getBoundingClientRect();
    const header = document.querySelector('.topbar');
    const top = header?.getClientRects().length && ['fixed', 'sticky'].includes(getComputedStyle(header).position)
      ? header.getBoundingClientRect().bottom : 0;
    const nav = document.querySelector('.mobile-workspace-nav');
    const bottom = nav?.getClientRects().length && getComputedStyle(nav).position === 'fixed'
      ? nav.getBoundingClientRect().top : globalThis.innerHeight;
    if (rect.top < top || rect.bottom > bottom || rect.left < 0 || rect.right > globalThis.innerWidth) {
      target.scrollIntoView({ behavior: 'instant', block: 'center', inline: 'nearest' });
    }
  };
  if (!filtered.length) {
    const reason = exploreEmptyReason();
    list.innerHTML = registryLoading
      ? '<div class="empty-state">Checking the verified launch feed…</div>'
      : registryUnavailable
      ? `<div class="empty-state"><strong>${escapeHtml(outage.title)}</strong><span>${escapeHtml(outage.detail)}</span><button type="button" class="secondary-button" data-verified-feed-retry>Try again</button><a class="explore-policy-link" href="#airdrops">Browse recorded airdrop policies →</a></div>`
      : `<div class="empty-state"><strong>${escapeHtml(reason?.[0] || (assets.length ? 'No verified launches match these filters.' : 'No tokens to show yet.'))}</strong><span>${escapeHtml(reason?.[1] || (assets.length ? 'Try All stages or clear the search.' : 'Confirmed launches will appear here when available.'))}</span>${reason?.[2] ? `<small class="explore-empty-criteria">${escapeHtml(reason[2])}</small>` : ''}</div>`;
    if (!registryLoading && !registryUnavailable) {
      list.querySelector('.empty-state')?.append(createExploreEmptyAction(document, { hasAssets: assets.length, exploreTab }));
    }
    restoreRemovedPrimary(true);
    restoreTierFocus();
    return;
  }
  const rowMarkup = page.rows.map((item, index) => {
    const mint = escapeHtml(item.address);
    const symbol = escapeHtml(item.symbol);
    const stage = exploreStageLabel(item);
    const age = item.createdTimestamp ? escapeHtml(formatOnchainAge(Number(item.createdTimestamp) * 1000)) : 'Age unavailable';
    const change = item.priceChange24hPercent == null ? '—' : `${item.priceChange24hPercent >= 0 ? '+' : ''}${Number(item.priceChange24hPercent).toFixed(2)}%`;
    const source = followingSources?.get(item.address);
    const followingLabel = source ? `<span class="explore-following-source" aria-label="Followed wallet activity">${source.heldBy.size ? `<span>Held by ${source.heldBy.size} followed wallet${source.heldBy.size === 1 ? '' : 's'}</span>` : ''}${source.tradedBy.size ? `<span>Traded by ${source.tradedBy.size} followed wallet${source.tradedBy.size === 1 ? '' : 's'}</span>` : ''}</span>` : '';
    return `<div class="scanner-row" role="row" data-logo-mint="${mint}">
      <span class="scanner-rank" role="cell">${page.start + index + 1}</span>
      <div class="scanner-token" role="cell"><span class="asset-icon">${escapeHtml(item.icon)}</span><span><span class="scanner-token-heading"><a class="scanner-token-link" href="/token/${encodeURIComponent(item.address)}"><strong class="${activeBoostMultiplier(verifiedBoosts[item.address]) >= 500 ? 'golden-ticker' : ''}">${symbol} <small>${escapeHtml(item.name)}</small></strong></a>${explorePaidListingBagMarkup(item)}${exploreBoostAmountMarkup(item.address)}</span>${followingLabel}<span class="scanner-actions"><button type="button" class="copy-row scanner-contract" data-mint="${mint}" aria-label="Copy ${symbol} token contract address" title="Copy full contract address: ${mint}"><span>${escapeHtml(`${item.address.slice(0, 4)}…${item.address.slice(-4)}`)}</span>${icon('copy')}</button>${exploreSocialLinksMarkup(item)}<button type="button" class="watch-button scanner-watch" data-mint="${mint}" aria-label="Add ${symbol} to favorites" aria-pressed="false" title="Add to favorites">${icon('star')}</button></span></span></div>
      <div class="scanner-tier" role="cell">${exploreTierBadgeMarkup(item.address)}</div>
      <span class="scanner-metric" role="cell">${escapeHtml(exploreMarketCapUsd(item))}</span>
      <span class="scanner-age" role="cell">${age}</span>
      <span class="scanner-metric" role="cell" title="${item.windowCoverage === 'partial' ? 'Partial confirmed trade-history scan; shown as a lower bound' : 'Confirmed trade history'}">${formatExploreTradeCount(item.windowTradeCount, item.windowCoverage)}</span>
      <span class="scanner-metric" role="cell" title="${item.windowCoverage === 'partial' ? 'Partial confirmed trade-history scan; shown as a lower bound' : 'Confirmed trade history'}">${escapeHtml(EXPLORE_CLUSTER === 'devnet' ? formatExploreUsd(item.windowVolumeSol, { partial: item.windowCoverage === 'partial' }) : formatCompactUsd(item.volume24hUsd))}</span>
      <span class="scanner-metric ${Number(item.priceChange24hPercent) < 0 ? 'negative' : ''}" role="cell" title="Observed 24-hour price change when available">${change}</span>
      <div class="scanner-airdrop-cell" role="cell">${exploreAirdropMarkup(item)}</div>
      <div class="scanner-stage" role="cell"><strong>${stage}</strong><small>${item.complete === false && item.curveProgressPercent != null && Number.isFinite(Number(item.curveProgressPercent)) ? `${Number(item.curveProgressPercent).toFixed(0)}% curve` : ''}</small></div>
      <div class="scanner-boost" role="cell"><button type="button" class="explore-boost-button" data-boost-mint="${mint}" aria-label="Boost options for ${escapeHtml(item.name)}">${icon('boost')}<span>Boost</span></button></div>
    </div>`;
  }).join('');
  const primaryUpdate = primaryOwner ? updateFocusedRegistryRow(list, primaryOwner, rowMarkup, page.rows, document) : 'ineligible';
  // Invalid keys/hrefs/spines are not a genuine removal: publish the ordinary
  // fresh renderer output, but never falsely restore Search for those states.
  if (primaryUpdate !== 'retained') list.innerHTML = rowMarkup;
  restoreRemovedPrimary(primaryUpdate === 'removed');
  loadVerifiedTokenLogos(list);
  renderWatchlist();
  if (primaryUpdate === 'retained') revealRetainedRegistryPrimary(primaryOwner,list,document,state,criteriaKey,page.page);
  restoreTierFocus();
}
