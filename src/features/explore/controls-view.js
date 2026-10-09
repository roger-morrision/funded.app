import { activeBoostMultiplier } from '../../../boost-offer.js';
import { sortMarketRecords } from '../../../market-intelligence.js';
import { shortAddress, escapeHtml } from '../shared/display.js';

// Receive current state on every render; the application owns data and wallet lifecycles.
export function renderExploreControls(
  {
    exploreView,
    exploreTab,
    exploreWindow,
    exploreSort,
    verifiedBoostsAvailable,
    assets,
    verifiedBoosts,
    exploreRisk,
    exploreStage,
    exploreAuthority,
    explorePromotion,
    exploreReward,
    exploreMaxAgeHours,
    exploreMinVolumeUsd,
    exploreMinMarketCapUsd,
    exploreMinTrades,
    exploreMinTraders,
    exploreUpdatedAt,
    EXPLORE_CLUSTER,
  },
  {
    document = globalThis.document,
  } = {}
) {
  const page = document.querySelector('#explore');
  if (page) { page.dataset.exploreView = exploreView; page.dataset.cluster = EXPLORE_CLUSTER; page.dataset.exploreTab = exploreTab; }
  document.querySelectorAll('.explore-tabs [data-explore-tab]').forEach(button => { const active = button.dataset.exploreTab === exploreTab; button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active)); });
  document.querySelectorAll('[data-explore-window]').forEach(button => {
    const active = button.dataset.exploreWindow === exploreWindow;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  document.querySelectorAll('[data-explore-sort]').forEach(button => {
    const active = button.dataset.exploreSort === exploreSort;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  const boostCount = document.querySelector('#explore-boost-sort-count');
  if (boostCount) boostCount.textContent = verifiedBoostsAvailable
    ? String(assets.filter(item => activeBoostMultiplier(verifiedBoosts[item.address]) > 0).length)
    : '—';
  const volumeSortButton = document.querySelector('[data-explore-sort="volume"]');
  if (volumeSortButton) volumeSortButton.textContent = `${exploreWindow} volume`;
  const hasExploreFilters = exploreRisk !== 'all' || exploreStage !== 'all' || exploreAuthority !== 'all'
    || explorePromotion !== 'all' || exploreReward !== 'all'
    || exploreMaxAgeHours != null || exploreMinVolumeUsd != null || exploreMinMarketCapUsd != null
    || exploreMinTrades != null || exploreMinTraders != null;
  document.querySelector('#explore-filter-toggle')?.classList.toggle('has-filters', hasExploreFilters);
  for (const [selector, label] of [
    ['#explore-sort option[value="market-cap"]', 'Market cap'],
    ['#explore-sort option[value="volume"]', `${exploreWindow} volume`],
    ['#explore-sort option[value="trades"]', `${exploreWindow} trades`],
    ['#explore-sort option[value="liquidity"]', 'SOL reserve'],
    ['#explore-min-volume-label', `Minimum ${exploreWindow} volume · USD`],
    ['#explore-min-trades-label', `Minimum ${exploreWindow} trades`],
    ['#explore-min-traders-label', `Minimum ${exploreWindow} trading wallets`],
    ['.scanner-head span:nth-child(4)', 'Market cap'],
    ['#scanner-volume-heading', `${exploreWindow} volume`],
    ['#scanner-trades-heading', `${exploreWindow} trades`],
  ]) { const node = document.querySelector(selector); if (node) node.textContent = label; }
  document.querySelectorAll('[data-explore-view]').forEach(button => {
    const active = button.dataset.exploreView === exploreView;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  const checked = document.querySelector('#explore-last-updated');
  if (checked) checked.textContent = exploreUpdatedAt ? `Checked ${new Date(exploreUpdatedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : 'Waiting for first check';
}

export function renderExploreBenefitLeaders(
  records,
  {
    exploreWindow,
    exploreSort,
  },
  {
    formatVerifiedPercent,
    formatExploreUsd,
    document = globalThis.document,
  } = {}
) {
  const container = document.querySelector('#explore-benefit-leaders');
  if (!container) return;
  const definitions = [
    { sort: 'volume', label: `Top ${exploreWindow} volume`, field: 'windowVolumeSol', policy: false },
    { sort: 'airdrop', label: 'Top token airdrop', field: 'communityAirdropPercent', policy: true, suffix: 'of supply' },
    { sort: 'holder-fee', label: 'Top fee to holders', field: 'holderFeePercent', policy: true, suffix: 'of creator fees' },
    { sort: 'x-fee', label: 'Top fee to X account', field: 'xFeePercent', policy: true, suffix: 'of creator fees' },
  ];
  const cards = definitions.map(definition => {
    const candidates = records.filter(record => definition.policy
      ? record.benefitPolicyVerified && record[definition.field] > 0
      : record[definition.field] != null && Number.isFinite(Number(record[definition.field])));
    const leader = candidates.length ? sortMarketRecords(candidates, definition.sort)[0] : null;
    const hasVerifiedField = records.some(record => definition.policy
      ? record.benefitPolicyVerified && record[definition.field] != null
      : record[definition.field] != null);
    if (!leader && !hasVerifiedField) return '';
    const value = leader
      ? definition.policy ? formatVerifiedPercent(leader[definition.field]) : formatExploreUsd(leader[definition.field], { partial: leader.windowCoverage === 'partial' })
      : hasVerifiedField && definition.policy ? '0%' : 'Unavailable';
    const detail = leader
      ? `${leader.symbol || shortAddress(leader.address)}${definition.suffix ? ` · ${definition.suffix}` : leader.windowCoverage === 'partial' ? ' · partial history' : ' · scanned'}`
      : hasVerifiedField && definition.policy ? 'No matching launch yet' : definition.policy ? 'Details unavailable' : 'Activity unavailable';
    const canRank = leader && !document.querySelector(`#explore-sort option[value="${definition.sort}"]`)?.disabled;
    return `<button type="button" class="${definition.sort === exploreSort ? 'active' : ''}" data-explore-leader-sort="${definition.sort}" data-state="${leader ? 'ready' : hasVerifiedField ? 'empty' : 'unavailable'}" aria-pressed="${definition.sort === exploreSort}" ${canRank ? '' : 'disabled'} ${leader && !canRank ? 'title="Ranking needs more verified data"' : ''}><span>${escapeHtml(definition.label)}</span><strong>${escapeHtml(value)}</strong><small>${escapeHtml(detail)}</small></button>`;
  }).filter(Boolean);
  container.innerHTML = cards.length ? cards.join('') : '<p class="explore-ranking-empty">No verified rankings match the current filters.</p>';
}

export function renderExplorePayoutStats(
  {
    analyticsSummary,
    EXPLORE_CLUSTER,
  },
  {
    formatPayoutSol,
    document = globalThis.document,
  } = {}
) {
  const container = document.querySelector('#explore-payout-stats');
  if (!container) return;
  const stats = analyticsSummary?.feePayoutStats;
  const ready = stats?.cluster === EXPLORE_CLUSTER && stats.commitment === 'finalized';
  const cards = [
    { label:'Total fee paid to X accounts', kind:'x' },
    { label:'Total fee paid to creators', kind:'creator' },
    { label:'Total fee paid to coin holders', kind:'holder' },
    { label:'Top X account paid', kind:'x', top:true },
    { label:'Top coin holder paid', kind:'holder', top:true },
    { label:'Top $FUNDED holder paid', kind:'fundedHolder', top:true },
    { label:'Top creator paid', kind:'creator', top:true },
  ];
  container.innerHTML = cards.map(card => {
    const group = ready ? stats[card.kind] : null;
    const available = ['verified', 'partial'].includes(group?.status);
    const leader = available && card.top ? group.top : null;
    if (card.kind === 'fundedHolder') {
      const value = available && leader ? `${leader.claimCount} token claim${leader.claimCount === 1 ? '' : 's'}` : '—';
      const detail = group?.status === 'unavailable' ? group.reason || 'Finalized community claims unavailable'
        : !available ? 'Checking finalized community claims'
          : leader ? `${shortAddress(leader.recipient)} · ${leader.launchCount} launch${leader.launchCount === 1 ? '' : 'es'}`
            : 'No finalized community claims yet';
      return `<article data-state="${group?.status || 'loading'}"><span>${escapeHtml(card.label)}</span><strong>${escapeHtml(value)}</strong><small>${escapeHtml(detail)}</small></article>`;
    }
    const amount = card.top ? leader?.paidLamports : group?.paidLamports;
    const count = card.top ? leader?.payoutCount : group?.payoutCount;
    const value = available && (group.status !== 'partial' || count > 0)
      ? `${group.status === 'partial' ? '≥' : ''}${formatPayoutSol(amount)}` : '—';
    const name = leader ? card.kind === 'x'
      ? leader.handle || `X ID ${leader.recipient}` : shortAddress(leader.recipient) : null;
    const profile = card.kind === 'x' && /^@[A-Za-z0-9_]{1,15}$/.test(String(leader?.handle || ''))
      ? `https://x.com/${leader.handle.slice(1)}` : null;
    const detail = group?.status === 'unavailable'
      ? group.reason || 'Finalized payout data unavailable'
      : !available ? 'Checking finalized payout records'
        : group.status === 'partial' && !count ? group.reason || 'Payout verification incomplete'
        : leader ? `${name} · ${leader.payoutCount} payment${leader.payoutCount === 1 ? '' : 's'}`
          : card.top ? 'No verified fee payout yet'
            : `${group.payoutCount} finalized payment${group.payoutCount === 1 ? '' : 's'}`;
    const detailMarkup = profile
      ? `<a href="${escapeHtml(profile)}" target="_blank" rel="noopener noreferrer">${escapeHtml(detail)} ↗</a>`
      : `<small>${escapeHtml(detail)}</small>`;
    return `<article data-state="${group?.status || 'loading'}"><span>${escapeHtml(card.label)}</span><strong>${escapeHtml(value)}</strong>${detailMarkup}${group?.status === 'partial' ? `<em${group.reason ? ` title="${escapeHtml(group.reason)}"` : ''}>Partial coverage</em>` : ''}</article>`;
  }).join('');
}
