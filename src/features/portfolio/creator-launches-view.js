import { paginateHistory } from '../../../history-pagination.js';
import { shortAddress } from '../shared/display.js';
import { withMarketWindow, enrichMarketRecord } from '../../../market-intelligence.js';

// Receive current state on every render; the application owns data and wallet lifecycles.
export function renderCreatorLaunches(
  {
    verifiedLaunchPoliciesStatus,
    connectedWalletAddress,
    assets,
    exploreWindow,
    EXPLORE_CLUSTER,
  },
  {
    getWalletLaunchPolicies,
    withVerifiedExploreBenefits,
    homeLaunchCardMarkup,
    launchCardVolumeUsd,
    decorateHomeLaunchCard,
    loadPortfolioLogo,
    setWatchButtonState,
    getWatchlist,
    document = globalThis.document,
  } = {}
) {
  const list = document.querySelector('#creator-launch-empty');
  if (!list) return;
  const sourceLabel = document.querySelector('.portfolio-launches-heading .section-state');
  if (sourceLabel) sourceLabel.textContent = verifiedLaunchPoliciesStatus === 'ready' ? 'Up to date' : verifiedLaunchPoliciesStatus === 'unavailable' ? 'Updates unavailable' : 'Updating…';
  const sourceBadge = list.closest('.role-panel')?.querySelector('.data-badge');
  if (sourceBadge) sourceBadge.textContent = !connectedWalletAddress ? 'Connect wallet' : verifiedLaunchPoliciesStatus === 'ready' ? 'Up to date' : verifiedLaunchPoliciesStatus === 'unavailable' ? 'Unavailable' : 'Updating…';
  const launches = getWalletLaunchPolicies();
  const projectSelect = document.querySelector('#funded-burn-project');
  if (projectSelect) {
    const selectedMint = projectSelect.value;
    projectSelect.replaceChildren(new Option('No project selected', ''));
    for (const launch of launches) projectSelect.add(new Option(`${launch.name || 'Solana coin'} (${launch.symbol || 'TOKEN'})`, launch.mint));
    projectSelect.value = launches.some(launch => launch.mint === selectedMint) ? selectedMint : '';
  }
  const stats = document.querySelector('#my-launches .projects-panel .role-stats');
  if (stats) {
    stats.hidden = !launches.length;
    const marketByMint = new Map(assets.map(asset => [asset.address, asset]));
    const stages = launches.map(launch => {
      const market = marketByMint.get(launch.mint);
      return market?.migrated === true ? 'migrated'
        : market?.complete === false || market?.migrated === false ? 'not-migrated'
          : 'unknown';
    });
    const statusKnown = stages.every(stage => stage !== 'unknown');
    const values = [
      launches.length,
      statusKnown ? stages.filter(stage => stage === 'not-migrated').length : '—',
      statusKnown ? stages.filter(stage => stage === 'migrated').length : '—',
    ];
    stats.querySelectorAll('b').forEach((value, index) => { value.textContent = String(values[index] ?? '—'); });
    stats.title = statusKnown ? 'Migration status verified on Solana' : 'Migration status awaiting on-chain verification';
  }
  list.replaceChildren();
  list.classList.toggle('empty-state', !launches.length);
  list.classList.toggle('compact-empty', !launches.length);
  list.classList.toggle('creator-launch-list', launches.length > 0);
  if (!launches.length) {
    paginateHistory(list, {label:'Created tokens', selector:'.project-token-card', key:connectedWalletAddress});
    const state = !connectedWalletAddress ? 'disconnected' : verifiedLaunchPoliciesStatus;
    const empty = document.createElement('div');
    empty.className = 'projects-empty-content';
    const icon = document.createElement('span');
    icon.className = 'projects-empty-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = state === 'ready' ? '◎' : '◫';
    const heading = document.createElement('h3');
    heading.textContent = state === 'disconnected' ? 'Connect your creator wallet' : state === 'ready' ? 'No projects for this wallet' : state === 'unavailable' ? 'Your tokens are unavailable right now' : 'Checking your projects';
    const explanation = document.createElement('p');
    explanation.textContent = state === 'disconnected'
      ? 'Connect the wallet you used to launch your tokens.'
      : state === 'ready'
        ? `No verified launches are associated with wallet ${shortAddress(connectedWalletAddress)}. Connect the wallet used to launch your coin to see its projects here.`
        : state === 'unavailable'
          ? `Verified launches for ${shortAddress(connectedWalletAddress)} cannot be checked right now.`
          : `Checking verified launches for ${shortAddress(connectedWalletAddress)}…`;
    const actions = document.createElement('div');
    actions.className = 'projects-empty-actions';
    const walletLink = document.createElement('a');
    walletLink.href = '#profile';
    walletLink.className = 'primary-button';
    walletLink.textContent = connectedWalletAddress ? 'Manage wallet' : 'Connect wallet';
    const exploreLink = document.createElement('a');
    exploreLink.href = '#explore';
    exploreLink.className = 'text-button';
    exploreLink.textContent = 'Explore launches →';
    actions.append(walletLink, exploreLink);
    empty.append(icon, heading, explanation, actions);
    list.append(empty);
    return;
  }
  for (const launch of launches) {
    const holder = document.createElement('div');
    const market = assets.find(item => item.address === launch.mint);
    const marketCard = market
      ? withVerifiedExploreBenefits(EXPLORE_CLUSTER === 'devnet' ? withMarketWindow(market, exploreWindow) : enrichMarketRecord(market))
      : withVerifiedExploreBenefits({
          address: launch.mint,
          name: launch.name || 'Solana coin',
          symbol: launch.symbol || 'TOKEN',
          icon: (launch.symbol || 'T').slice(0, 1).toUpperCase(),
          riskLevel: 'watch',
          change: '—',
          marketUnavailable: true,
        });
    holder.innerHTML = homeLaunchCardMarkup(marketCard, {
      volumeLabel: exploreWindow,
      volumeValue: launchCardVolumeUsd(marketCard, exploreWindow),
      extraClass: ' project-token-card',
    });
    const card = holder.firstElementChild;
    list.append(card);
    decorateHomeLaunchCard(card, launch.mint);
    loadPortfolioLogo(card, launch);
    setWatchButtonState(card.querySelector('.watch-button'), getWatchlist().includes(launch.mint));
  }
  paginateHistory(list, {label:'Created tokens', selector:'.project-token-card', key:connectedWalletAddress});
}
