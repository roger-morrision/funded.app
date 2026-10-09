import { activeBoostMultiplier, activeBoostPackages } from '../../../boost-offer.js';
import { coinDetailPackage } from '../../../promotion-badge.js';
import { verifiedCoinRewardsPolicy, formatPolicyPercent } from '../../../coin-rewards-policy.js';

// Receive current state on every render; the application owns data and wallet lifecycles.
export function renderCoinPromotionBadge(
  {
    verifiedBoosts,
    verifiedBoostsAvailable,
  },
  {
    getCoinMintAddress,
    exploreBoostAmountMarkup,
    verifiedLaunchPolicyForMint,
    renderCoinRegistryIdentity,
    renderCoinRewardsPolicy,
    exploreExplorer,
    document = globalThis.document,
  } = {}
) {
  const identity = document.querySelector('#coin-page .coin-identity');
  if (!identity) return;
  const main = identity.querySelector(':scope > div:last-of-type');
  main?.classList.add('coin-identity-main');
  let rail = identity.querySelector('.coin-package-rail');
  if (!rail) {
    rail = document.createElement('aside');
    rail.className = 'coin-package-rail';
    rail.setAttribute('aria-label', 'Favorite, boost and launch package');
    const watch = document.querySelector('#coin-watch');
    const boost = document.querySelector('#coin-boost');
    if (watch) rail.append(watch);
    if (boost) {
      boost.className = 'coin-package-chip coin-package-chip--boost';
      boost.innerHTML = `<span class="coin-package-bag" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><path d="M4 9h16l-1.3 11H5.3L4 9Z"/><path d="M9 10V7a3 3 0 0 1 6 0v3"/></svg><span>⚡</span></span><span class="coin-package-copy"><small>Paid boost</small><strong id="coin-boost-total">—</strong></span>`;
      rail.append(boost);
    }
    identity.append(rail);
  }
  const mint = getCoinMintAddress();
  const active = verifiedBoosts[mint];
  const activeMultiplier = activeBoostMultiplier(active);
  let packageBadges = identity.querySelector('#coin-boost-packages');
  if (!packageBadges) {
    packageBadges = document.createElement('span');
    packageBadges.id = 'coin-boost-packages';
    identity.querySelector('#coin-symbol')?.after(packageBadges);
  }
  packageBadges.innerHTML = exploreBoostAmountMarkup(mint);
  document.querySelector('#coin-page-title')?.classList.toggle('golden-ticker', verifiedBoostsAvailable && activeMultiplier >= 500);
  const boostTotal = rail.querySelector('#coin-boost-total');
  if (boostTotal) boostTotal.textContent = verifiedBoostsAvailable
    ? (activeMultiplier ? `${activeMultiplier.toLocaleString()}x total` : 'No active boost')
    : 'Status unavailable';
  const boostButton = rail.querySelector('#coin-boost');
  if (boostButton) {
    boostButton.classList.toggle('is-active', verifiedBoostsAvailable && Boolean(activeMultiplier));
    boostButton.title = verifiedBoostsAvailable
      ? (activeMultiplier ? `${activeBoostPackages(active).length} verified boost payment${activeBoostPackages(active).length === 1 ? '' : 's'} · active total ${activeMultiplier}x` : 'No active verified boost · view packages')
      : 'Boost status unavailable · view packages';
    boostButton.setAttribute('aria-label', `View boost packages · ${boostTotal?.textContent || 'status unavailable'}`);
  }
  let holder = document.querySelector('#coin-promotion-badge');
  if (!holder) {
    holder = document.createElement('span');
    holder.id = 'coin-promotion-badge';
    rail.append(holder);
  }
  holder.replaceChildren();
  const presentation = coinDetailPackage(verifiedLaunchPolicyForMint(mint));
  const badge = presentation.badge;
  const hero = document.querySelector('#coin-page .coin-hero-card');
  if (hero) hero.dataset.launchTier = presentation.tier;
  const profile = document.querySelector('#coin-profile');
  const heroAside = hero?.querySelector('.coin-hero-aside');
  const side = document.querySelector('#coin-page .coin-side-column');
  if (profile && heroAside && side) {
    if (presentation.tier === 'standard' || presentation.tier === 'unknown') {
      const market = side.querySelector('.coin-market-aside');
      if (market) market.after(profile);
      else side.append(profile);
    } else {
      heroAside.prepend(profile);
    }
  }
  const artworkLabel = document.querySelector('#coin-artwork-package');
  if (artworkLabel) {
    artworkLabel.hidden = !badge;
    artworkLabel.textContent = badge ? `${presentation.label} launch · ${Number(badge.amountTokens).toLocaleString()} $FUNDED burned` : '';
  }
  const packageElement = document.createElement(badge ? 'a' : 'span');
  packageElement.className = `coin-package-chip coin-package-chip--promotion is-${presentation.tier}`;
  if (badge) {
    packageElement.href = exploreExplorer(`tx/${encodeURIComponent(badge.signature)}`);
    packageElement.target = '_blank';
    packageElement.rel = 'noopener noreferrer';
    packageElement.title = `${badge.amountTokens.toLocaleString()} $FUNDED burned in the verified launch · view receipt`;
    packageElement.setAttribute('aria-label', `${badge.tier} launch promotion · view verified burn receipt`);
  } else {
    packageElement.title = presentation.tier === 'standard' ? 'Verified standard launch; no paid promotion burn' : 'Launch package cannot be verified yet';
  }
  const symbol = badge?.tier === 'premier' ? '★' : badge?.tier === 'pro' ? '◆' : '✦';
  packageElement.innerHTML = `<span class="coin-package-bag" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><path d="M4 9h16l-1.3 11H5.3L4 9Z"/><path d="M9 10V7a3 3 0 0 1 6 0v3"/></svg><span>${symbol}</span></span><span class="coin-package-copy"><small>Launch package</small><strong>${presentation.label}</strong></span>`;
  holder.append(packageElement);
  renderCoinRegistryIdentity(mint);
  renderCoinRewardsPolicy(verifiedLaunchPolicyForMint(mint), mint);
}

export function renderCoinRewardsPolicy(
  policy,
  mint,
  {
    coinSummaryLaunch,
    EXPLORE_CLUSTER,
  },
  {
    getCoinMintAddress,
    verifiedLaunchPolicyForMint,
    document = globalThis.document,
  } = {}
) {
  const summary = document.querySelector('#coin-fee-route');
  const value = document.querySelector('#coin-fee-route-value');
  if (!summary || !value) return;
  const verified = verifiedCoinRewardsPolicy(policy, mint, EXPLORE_CLUSTER)
    || verifiedCoinRewardsPolicy(coinSummaryLaunch, mint, EXPLORE_CLUSTER)
    || verifiedCoinRewardsPolicy(verifiedLaunchPolicyForMint(mint), mint, EXPLORE_CLUSTER);
  summary.hidden = !verified;
  summary.parentElement?.classList.toggle('has-fee-allocation', Boolean(verified));
  value.replaceChildren();
  if (!verified) return;
  const shares = [];
  if (verified.creator > 0) shares.push(document.createTextNode(`Creator ${formatPolicyPercent(verified.creator)}`));
  if (verified.holders > 0) shares.push(document.createTextNode(`Holders ${formatPolicyPercent(verified.holders)}`));
  if (verified.x > 0 && verified.xAccount) {
    const xShare = document.createElement('span');
    const xLink = document.createElement('a');
    xLink.href = `https://x.com/${verified.xAccount.slice(1)}`;
    xLink.target = '_blank';
    xLink.rel = 'noopener noreferrer';
    xLink.textContent = verified.xAccount;
    xLink.setAttribute('aria-label', `Open ${verified.xAccount} on X (opens in a new tab)`);
    xShare.append('X account ', xLink, ` ${formatPolicyPercent(verified.x)}`);
    shares.push(xShare);
  }
  shares.forEach((share, index) => {
    if (index) value.append(' · ');
    value.append(share);
  });
}
