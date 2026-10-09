import { createTokenCardActions } from '../../../token-card-controls.js';
import { formatTokens, claimedTokenAmount, airdropFinished, utcMoment } from './card-format.js';

export function renderHomeRewardCards({ homeSpotlight, homeFundedTokens, homeReserves, homeVerifiedLaunches, offset, homeLaunchPolicyStatus, homeReceiverEstimate, EXPLORE_CLUSTER }, { renderSimpleRewardCards, loadFundedTokenLogo, renderHomeClocks, document = globalThis.document } = {}) {
  if (!homeSpotlight) return;
  const track = homeSpotlight.querySelector('[data-home-reward-grid="funded"]');
  const previousMint = track.querySelector('article:first-of-type')?.dataset.rewardMint;
  const previousScroll = track.scrollLeft;
  const fundedMints = new Set(homeFundedTokens.map(launch => launch.mint));
  const reservesAvailable = Array.isArray(homeReserves?.reserves) && homeReserves.cluster === EXPLORE_CLUSTER;
  const matched = reservesAvailable
    ? new Map(homeReserves.reserves.filter(row => row?.mint).map(row => [row.mint, row])) : new Map();
  const launches = homeVerifiedLaunches.filter(launch => fundedMints.has(launch.mint))
    .filter(launch => {
      const reserve = matched.get(launch.mint);
      return reserve?.verified === true
        && Number(reserve.reservedTokens) === Number(launch.communityAirdrop.reservedTokens)
        && ['funded', 'drop-active'].includes(reserve.status)
        && !airdropFinished(reserve, Math.floor((Date.now() + offset) / 1000));
    })
    .sort((a, b) => Number(b.createdTimestamp || 0) - Number(a.createdTimestamp || 0));
  track.replaceChildren();
  if (!launches.length) {
    const empty = document.createElement('p'); empty.className = 'home-rewards-empty';
    empty.textContent = homeLaunchPolicyStatus === 'unavailable' ? 'Verified reward data is unavailable.'
      : homeLaunchPolicyStatus === 'loading' ? 'Checking verified reward policies…'
      : !homeFundedTokens.length ? 'No $FUNDED holder airdrops are available.'
      : homeReserves === null ? 'Checking funded vaults…'
      : !reservesAvailable ? 'Vault verification is unavailable.'
      : `${homeFundedTokens.length} published ${homeFundedTokens.length === 1 ? 'allocation' : 'allocations'}; no verified funded vaults yet.`;
    track.append(empty);
    renderSimpleRewardCards('coin');
    renderSimpleRewardCards('x');
    return;
  }
  for (const launch of launches) {
    const reserve = matched.get(launch.mint);
    const active = reserve.status === 'drop-active'
      && Number.isSafeInteger(reserve.expiresAt) && reserve.expiresAt > (Date.now() + offset) / 1000;
    const card = document.createElement('article'); card.className = 'home-reward-token-card'; card.dataset.rewardMint = launch.mint;
    const head = document.createElement('div'); head.className = 'home-reward-token-head';
    const avatar = document.createElement('span'); avatar.className = 'home-reward-token-logo'; avatar.setAttribute('aria-hidden', 'true');
    avatar.textContent = String(launch.symbol || launch.name || 'T').slice(0, 1).toUpperCase();
    const identity = document.createElement('span'); identity.className = 'home-reward-token-identity';
    const symbol = document.createElement('strong'); symbol.textContent = launch.symbol || 'TOKEN';
    const name = document.createElement('small'); name.textContent = launch.name || 'Verified launch';
    identity.append(symbol, name);
    head.append(avatar, identity);
    const values = document.createElement('div'); values.className = 'home-reward-token-values';
    const addValue = (label, value) => {
      const item = document.createElement('span'); const caption = document.createElement('small'); caption.textContent = label;
      const amount = document.createElement('strong'); amount.textContent = value;
      item.append(caption, amount); values.append(item);
      return item;
    };
    addValue('Airdrop', `${formatTokens(launch.communityAirdrop.reservedTokens)} ${launch.symbol || 'tokens'}`);
    const finalizedRecipients = Number(reserve.leafCount);
    if (['drop-active', 'drop-closed'].includes(reserve.status) && Number.isSafeInteger(finalizedRecipients) && finalizedRecipients > 0) {
      addValue('Recipients', `${finalizedRecipients.toLocaleString()} wallets`).title = 'Finalized recipient count from the migration snapshot.';
    } else if (homeReceiverEstimate?.wallets) {
      const excluded = new Set([homeReserves.claimPolicy?.unclaimedRecipient, reserve.vault, reserve.drop].filter(Boolean));
      const count = [...homeReceiverEstimate.wallets].filter(wallet => !excluded.has(wallet)).length;
      addValue('Est. receivers', `~${count.toLocaleString()} wallets`).title = 'Current distinct $FUNDED wallets with a positive balance, excluding known protocol addresses. The final count is determined at migration.';
    } else {
      addValue('Est. receivers', homeReceiverEstimate === null ? 'Checking…' : 'Unavailable').title = 'A complete current $FUNDED wallet list is required for this estimate.';
    }
    const dropOpened = ['drop-active', 'drop-closed'].includes(reserve.status);
    const claimedWallets = dropOpened ? reserve.claimedWalletCount : 0;
    const receivedTokens = dropOpened ? claimedTokenAmount(reserve, launch) : `0 ${launch.symbol || 'tokens'}`;
    addValue('Paid wallets', Number.isSafeInteger(claimedWallets) && claimedWallets >= 0
      ? `${claimedWallets.toLocaleString()} ${claimedWallets === 1 ? 'wallet' : 'wallets'}` : '—')
      .title = 'Distinct wallets with verified on-chain token claims.';
    addValue('Tokens received', receivedTokens || '—').title = 'Tokens claimed from the verified airdrop vault; unclaimed allocation is excluded.';
    const proof = document.createElement('small'); proof.className = 'home-reward-token-proof';
    proof.textContent = active ? 'Claims open' : reserve.status === 'drop-closed' ? 'Claims closed' : '';
    proof.hidden = !proof.textContent;
    const snapshot = document.createElement('div'); snapshot.className = 'home-reward-snapshot';
    const addSnapshot = value => { const line = document.createElement('span'); line.textContent = value; snapshot.append(line); };
    const migrationSlot = Number(reserve.migrationSlot);
    const migrationAt = Number(reserve.migrationAt);
    const when = Number.isSafeInteger(migrationSlot) && migrationSlot > 0
      ? `$FUNDED snapshot · ${Number.isSafeInteger(migrationAt) && migrationAt > 0 ? `${utcMoment(migrationAt * 1000)} · ` : ''}slot ${migrationSlot.toLocaleString()}`
      : '$FUNDED snapshot · at migration';
    addSnapshot(when);
    snapshot.hidden = !snapshot.childElementCount;
    const timing = document.createElement('div'); timing.className = 'home-rewards-timing';
    const timingLabel = document.createElement('span'); timingLabel.className = 'home-reward-clock-label';
    const timingValue = document.createElement('b'); timingValue.className = 'home-reward-clock';
    const progressTrack = document.createElement('span'); progressTrack.className = 'home-reward-curve-track'; progressTrack.hidden = true;
    const progressFill = document.createElement('i'); progressTrack.append(progressFill);
    card.dataset.hasAirdropPolicy = 'true';
    if (reserve?.status) card.dataset.airdropStatus = reserve.status;
    if (active) card.dataset.claimExpiresAt = String(reserve.expiresAt * 1000);
    timing.append(timingLabel, timingValue, progressTrack);
    const link = document.createElement('a'); link.className = 'home-reward-token-link';
    link.href = `/token/${encodeURIComponent(launch.mint)}`;
    link.setAttribute('aria-label', `Open ${launch.symbol || launch.name || 'token'} token details`);
    card.append(link, head, values, proof, snapshot, timing, createTokenCardActions({ mint: launch.mint, symbol: launch.symbol, name: launch.name, className: 'home-reward-token-actions' })); track.append(card);
    loadFundedTokenLogo(avatar, launch);
  }
  if (track.querySelector('article:first-of-type')?.dataset.rewardMint === previousMint) track.scrollLeft = previousScroll;
  renderSimpleRewardCards('coin');
  renderSimpleRewardCards('x');
  renderHomeClocks();
}
