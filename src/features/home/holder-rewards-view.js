import { escapeHtml } from '../shared/display.js';

// Receive current state on every render; the application owns data and wallet lifecycles.
export function renderHomeHolderRewardCoins(
  {
    verifiedLaunchPoliciesStatus,
    verifiedLaunchPolicies,
  },
  {
    verifiedPolicyPercent,
    loadVerifiedTokenLogos,
    document = globalThis.document,
  } = {}
) {
  const list = document.querySelector('#home-holder-rewards-list');
  const count = document.querySelector('#home-holder-rewards-count');
  if (!list || !count) return;
  if (verifiedLaunchPoliciesStatus !== 'ready') {
    count.textContent = 'Unavailable';
    list.innerHTML = '<li class="home-holder-rewards-empty">Verified launch policies are unavailable right now.</li>';
    return;
  }
  const coins = verifiedLaunchPolicies
    .map(launch => ({ launch, share:verifiedPolicyPercent(launch.feeDistribution?.creatorDirected?.shares?.holderAirdropPercent) }))
    .filter(({ launch, share }) => share > 0 && share <= 80 && launch.mint
      && launch.pumpFeeRoute?.scope === 'per-mint-v2' && launch.pumpFeeRoute?.verified === true
      && launch.pumpFeeRoute.router === launch.creator)
    .sort((a, b) => Number(b.launch.createdTimestamp || 0) - Number(a.launch.createdTimestamp || 0));
  count.textContent = `${coins.length} verified coin${coins.length === 1 ? '' : 's'}`;
  if (!coins.length) {
    list.innerHTML = '<li class="home-holder-rewards-empty">No verified coins currently allocate creator fees to coin holders.</li>';
    return;
  }
  list.innerHTML = coins.map(({ launch, share }) => `<li>
    <a class="home-holder-reward-coin" data-logo-mint="${escapeHtml(launch.mint)}" href="/token/${encodeURIComponent(launch.mint)}">
      <span class="home-holder-reward-avatar" aria-hidden="true">${escapeHtml(String(launch.symbol || launch.name || 'C').slice(0, 1).toUpperCase())}</span>
      <span class="home-holder-reward-identity"><strong>${escapeHtml(launch.name || launch.symbol || 'Unnamed coin')}</strong><small>${escapeHtml(launch.symbol || 'TOKEN')}</small></span>
      <span class="home-holder-reward-share"><strong>${escapeHtml(share.toLocaleString(undefined, { maximumFractionDigits: 2 }))}%</strong><small>of collected creator fees</small></span>
      <span class="home-holder-reward-link">View coin →</span>
    </a>
  </li>`).join('');
  loadVerifiedTokenLogos(list);
}
