import { createTokenCardActions } from '../../../token-card-controls.js';
import { selectDisplaySchedule } from '../../../automatic-rewards.js';
import { validateSolClaimRecipient } from '../../../sol-claim-policy.js';
import { safeLamports, solAmount, utcMoment } from './card-format.js';

export function renderSimpleRewardCards(kind, { homeSpotlight, homeVerifiedLaunches, homeLaunchPolicyStatus, homePaidSummary, scheduleRows, offset, homeXRouteReady }, { loadFundedTokenLogo, document = globalThis.document } = {}) {
  if (!homeSpotlight) return;
  const track = homeSpotlight.querySelector(`[data-home-reward-grid="${kind}"]`);
  const previousMint = track.querySelector('article:first-of-type')?.dataset.rewardMint;
  const previousScroll = track.scrollLeft;
  const shareKey = kind === 'coin' ? 'holderAirdropPercent' : 'solClaimPercent';
  const launches = homeVerifiedLaunches.filter(launch => Number(launch.feeDistribution?.creatorDirected?.shares?.[shareKey] || 0) > 0)
    .sort((a, b) => Number(b.createdTimestamp || 0) - Number(a.createdTimestamp || 0));
  track.replaceChildren();
  if (!launches.length) {
    const empty = document.createElement('p'); empty.className = 'home-rewards-empty';
    empty.textContent = homeLaunchPolicyStatus === 'unavailable' ? 'Verified reward data is unavailable.'
      : homeLaunchPolicyStatus === 'loading' ? 'Checking verified reward policies…'
      : kind === 'coin' ? 'No verified coin holder reward policies.' : 'No verified X account reward policies.';
    track.append(empty);
    return;
  }
  for (const launch of launches) {
    const share = Number(launch.feeDistribution.creatorDirected.shares[shareKey]);
    const card = document.createElement('article'); card.className = 'home-reward-token-card'; card.dataset.rewardMint = launch.mint;
    const head = document.createElement('div'); head.className = 'home-reward-token-head';
    const avatar = document.createElement('span'); avatar.className = 'home-reward-token-logo'; avatar.setAttribute('aria-hidden', 'true');
    avatar.textContent = String(launch.symbol || launch.name || 'T').slice(0, 1).toUpperCase();
    const identity = document.createElement('span'); identity.className = 'home-reward-token-identity';
    const symbol = document.createElement('strong'); symbol.textContent = launch.symbol || 'TOKEN';
    const name = document.createElement('small'); name.textContent = launch.name || 'Verified launch';
    identity.append(symbol, name); head.append(avatar, identity);
    const values = document.createElement('div'); values.className = 'home-reward-token-values';
    const addValue = (label, value) => {
      const row = document.createElement('span'), caption = document.createElement('small'), amount = document.createElement('strong');
      caption.textContent = label; amount.textContent = value; row.append(caption, amount); values.append(row);
      return row;
    };
    addValue('Creator fee share', `${share.toLocaleString(undefined, { maximumFractionDigits:1 })}%`);
    const paid = homePaidSummary?.tokens.get(launch.mint);
    const paidWallets = kind === 'coin' ? paid?.holderPaidWallets : paid?.xPaidWallets;
    const paidLamports = kind === 'coin' ? paid?.holderPaidLamports : paid?.xPaidLamports;
    const verifiedPaid = safeLamports(paidLamports)
      && (kind !== 'coin' || Number.isSafeInteger(paidWallets) && paidWallets >= 0);
    const partial = homePaidSummary?.status === 'partial';
    const amount = verifiedPaid ? `${partial ? '≥' : ''}${BigInt(paidLamports) === 0n ? '0 SOL' : solAmount(paidLamports)}`
      : homePaidSummary === null ? 'Checking…' : '—';
    if (kind === 'coin') {
      const count = verifiedPaid ? `${partial ? '≥' : ''}${paidWallets.toLocaleString()} ${paidWallets === 1 ? 'wallet' : 'wallets'}`
        : homePaidSummary === null ? 'Checking…' : '—';
      addValue('Paid wallets', count).title = 'Distinct wallets with finalized, verified SOL payments in the indexed receipt window.';
      addValue('SOL received', amount).title = 'Finalized, verified SOL payments in the indexed receipt window; unpaid fee allocations are excluded.';
    } else {
      const allocated = paid?.totals?.x;
      const exact = ['onchain-indexed', 'no-records'].includes(homePaidSummary?.status);
      const unclaimed = exact && safeLamports(allocated) && verifiedPaid
        && BigInt(allocated) >= BigInt(paidLamports)
        ? BigInt(allocated) - BigInt(paidLamports) : null;
      addValue('Unclaimed', unclaimed === null ? homePaidSummary === null ? 'Checking…' : '—'
        : unclaimed === 0n ? '0 SOL' : solAmount(unclaimed))
        .title = 'Verified X fee allocation not yet paid. X identity and wallet verification may still be required.';
      addValue('Claimed', amount).title = 'SOL paid to the X recipient with finalized, verified transaction evidence.';
    }
    const detail = document.createElement('small'); detail.className = 'home-reward-token-proof';
    const snapshot = document.createElement('div'); snapshot.className = 'home-reward-snapshot';
    if (kind === 'coin') {
      const schedule = selectDisplaySchedule(scheduleRows.filter(row => row?.mint === launch.mint && row.asset === 'SOL'), launch.mint, Date.now() + offset);
      const allocated = schedule && ['calculating', 'prepared', 'distributing'].includes(schedule.status)
        && safeLamports(schedule.totalAmount) && BigInt(schedule.totalAmount) > 0n;
      if (allocated) addValue('SOL allocated', solAmount(schedule.totalAmount));
      if (schedule) {
        const line = document.createElement('span'); line.textContent = `Holder cutoff · ${utcMoment(schedule.cutoffAt)}`; snapshot.append(line);
        card.dataset.scheduleMint = launch.mint;
      }
      detail.textContent = schedule?.status === 'paid' ? 'SOL paid' : allocated ? 'Payment pending' : '';
    } else {
      const handle = launch.feeDistribution.creatorDirected.recipients?.xAccount;
      detail.textContent = homeXRouteReady ? '' : 'X payouts unavailable';
      const recipient = validateSolClaimRecipient({ handle, percent: share });
      if (recipient.valid && recipient.handle) {
        const profile = document.createElement('a');
        profile.href = `https://x.com/${encodeURIComponent(recipient.handle.slice(1))}`;
        profile.target = '_blank';
        profile.rel = 'noopener noreferrer';
        profile.textContent = `${recipient.handle} ↗`;
        profile.setAttribute('aria-label', `Open ${recipient.handle} on X in a new tab`);
        snapshot.append(profile);
      }
    }
    detail.hidden = !detail.textContent; snapshot.hidden = !snapshot.childElementCount;
    const timing = document.createElement('div'); timing.className = 'home-rewards-timing'; timing.hidden = true;
    const timingLabel = document.createElement('span'); timingLabel.className = 'home-reward-clock-label';
    const timingValue = document.createElement('b'); timingValue.className = 'home-reward-clock';
    const progressTrack = document.createElement('span'); progressTrack.className = 'home-reward-curve-track'; progressTrack.hidden = true;
    progressTrack.append(document.createElement('i')); timing.append(timingLabel, timingValue, progressTrack);
    const link = document.createElement('a'); link.className = 'home-reward-token-link';
    link.href = `/token/${encodeURIComponent(launch.mint)}`;
    link.setAttribute('aria-label', `Open ${launch.symbol || launch.name || 'token'} details`);
    card.append(link, head, values, detail, snapshot, timing, createTokenCardActions({ mint:launch.mint, symbol:launch.symbol, name:launch.name, className:'home-reward-token-actions' }));
    track.append(card); loadFundedTokenLogo(avatar, launch);
  }
  if (track.querySelector('article:first-of-type')?.dataset.rewardMint === previousMint) track.scrollLeft = previousScroll;
}
