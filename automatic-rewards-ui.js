import { distributionClock, countdownText, selectDisplaySchedule } from './automatic-rewards.js';
import { EXPLORE_CLUSTER } from './app-config.js';
import { verifiedCurveProgress } from './verified-curve-state.js';
import { createTokenCardActions } from './token-card-controls.js';
import { airdropClaimState } from './airdrop-directory-model.js';
import './automatic-rewards.css';

const panels = document.querySelectorAll('[data-automatic-rewards]');
let fundedFetchRevision = 0;
const homeHero = document.querySelector('.hero-section');
const homeSpotlight = homeHero ? document.createElement('div') : null;
if (homeSpotlight) {
  homeSpotlight.className = 'home-rewards-stack';
  homeSpotlight.innerHTML = `<section class="home-rewards-spotlight" aria-labelledby="home-funded-rewards-title" data-home-reward-section="funded"><header class="home-rewards-heading"><h2 id="home-funded-rewards-title">$FUNDED holders</h2><a href="#airdrops">Explore Airdrops →</a></header><div class="home-rewards-grid" data-home-reward-grid="funded" role="region" aria-label="$FUNDED holder airdrops" tabindex="0"><p class="home-rewards-empty">Checking token airdrops…</p></div></section><section class="home-rewards-spotlight home-rewards-spotlight-coin" aria-labelledby="home-coin-rewards-title" data-home-reward-section="coin"><header class="home-rewards-heading"><h2 id="home-coin-rewards-title">Coin holders</h2><a href="#payments">Explore Rewards →</a></header><div class="home-rewards-grid" data-home-reward-grid="coin" role="region" aria-label="Coin holder SOL rewards" tabindex="0"><p class="home-rewards-empty">Checking coin rewards…</p></div></section><section class="home-rewards-spotlight home-rewards-spotlight-x" aria-labelledby="home-x-rewards-title" data-home-reward-section="x"><header class="home-rewards-heading"><h2 id="home-x-rewards-title">X accounts</h2><a href="#payments">Explore X rewards →</a></header><div class="home-rewards-grid" data-home-reward-grid="x" role="region" aria-label="X account rewards" tabindex="0"><p class="home-rewards-empty">Checking X reward routes…</p></div></section>`;
  homeHero.after(homeSpotlight);
}
let homeVerifiedLaunches = [];
let homeFundedTokens = [];
let homeReserves = null;
let homeReceiverEstimate = null;
let homeXRouteReady = false;
let homePaidSummary = null;
const formatTokens = value => Number(value).toLocaleString(undefined, { maximumFractionDigits:0 });
const safeLamports = value => /^(?:0|[1-9]\d*)$/.test(String(value));
const solAmount = value => {
  const amount = BigInt(value);
  return `${amount / 1_000_000_000n}.${String(amount % 1_000_000_000n).padStart(9, '0').replace(/0+$/, '') || '0'} SOL`;
};
const claimedTokenAmount = (reserve, launch) => {
  if (!safeLamports(reserve.claimedBaseUnits) || !safeLamports(reserve.totalBaseUnits)) return null;
  const planned = BigInt(launch.communityAirdrop.reservedTokens);
  const total = BigInt(reserve.totalBaseUnits), claimed = BigInt(reserve.claimedBaseUnits);
  if (planned <= 0n || total <= 0n || total % planned !== 0n || claimed > total) return null;
  const scale = total / planned;
  if (scale > 1_000_000_000n || !/^10*$/.test(String(scale))) return null;
  const whole = (claimed / scale).toLocaleString();
  const fraction = scale === 1n ? '' : String(claimed % scale).padStart(String(scale).length - 1, '0').replace(/0+$/, '');
  return `${whole}${fraction ? '.' + fraction : ''} ${launch.symbol || 'tokens'}`;
};
const airdropFinished = (reserve, nowSeconds) => {
  if (airdropClaimState(reserve, nowSeconds).status === 'closed') return true;
  return reserve?.status === 'drop-active'
    && safeLamports(reserve.totalBaseUnits) && safeLamports(reserve.claimedBaseUnits)
    && BigInt(reserve.totalBaseUnits) > 0n
    && BigInt(reserve.claimedBaseUnits) === BigInt(reserve.totalBaseUnits);
};
function renderHomeRewardCards() {
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
    empty.textContent = !homeFundedTokens.length ? 'No $FUNDED holder airdrops are available.'
      : homeReserves === null ? 'Checking funded vaults…'
      : !reservesAvailable ? 'Vault verification is unavailable.'
      : 'No active vault-funded $FUNDED airdrops.';
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
    proof.textContent = active ? 'Claims open' : reserve.status === 'drop-closed' ? 'Claims closed' : 'Vault funded';
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
function renderSimpleRewardCards(kind) {
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
    empty.textContent = kind === 'coin' ? 'No verified coin holder reward policies.' : 'No verified X account reward policies.';
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
      detail.textContent = homeXRouteReady ? 'X claim after fee collection' : 'X payouts unavailable';
      if (handle) { const line = document.createElement('span'); line.textContent = handle; snapshot.append(line); }
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
let launchNames = new Map();
function loadFundedTokenLogo(avatar, launch) {
  const mint = String(launch?.mint || '');
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint)
    || launch.imageUri !== `https://metadata.funded.vip/devnet-images/${mint}`) return;
  const sources = [`/devnet-images/${encodeURIComponent(mint)}`, launch.imageUri];
  let next = 0;
  const trySource = () => {
    if (!avatar.isConnected || next >= sources.length) return;
    const image = new Image();
    image.alt = '';
    image.decoding = 'async';
    image.onload = () => { if (avatar.isConnected) avatar.replaceChildren(image); };
    image.onerror = trySource;
    image.src = sources[next++];
  };
  trySource();
}
for (const panel of panels) {
  panel.innerHTML = `<div class="auto-rewards-heading"><div><p class="eyebrow">REWARD TIMING</p><h2>When rewards arrive</h2><p class="auto-rewards-intro">See the next recorded holder cycle and how $FUNDED token airdrops work.</p></div><span class="preview-chip">Checking service…</span></div>
    <div class="auto-rewards-grid">
      <article class="auto-reward-card"><div class="auto-reward-card-top"><span class="auto-reward-icon" aria-hidden="true">◎</span><span class="auto-reward-type">COIN HOLDERS</span></div><h3>Daily SOL rewards</h3><p>Hold a coin with holder rewards enabled. Eligible wallets receive SOL automatically after a verified daily snapshot.</p><div class="auto-schedule"><span class="auto-schedule-label" data-clock-label>Checking schedule…</span><strong class="auto-countdown" data-clock>—</strong><a data-clock-coin hidden></a><div class="auto-schedule-dates" data-clock-dates hidden><span>Snapshot cutoff <strong data-clock-cutoff>—</strong></span><span>Target payout <strong data-clock-payout>—</strong></span></div></div><small>Rewards below 0.01 SOL roll into a later cycle.</small></article>
      <article class="auto-reward-card"><div class="auto-reward-card-top"><span class="auto-reward-icon" aria-hidden="true">✦</span><span class="auto-reward-type">$FUNDED HOLDERS</span></div><h3>New coin tokens</h3><p>Published policies target $FUNDED holders at each launch’s migration snapshot. Vault funding, snapshot eligibility, and claim availability are verified separately.</p><div class="auto-airdrop-note"><strong>Timing depends on each launch</strong><span>There is no fixed airdrop date before migration.</span></div><a class="auto-reward-link" href="#funded-holder-token-rewards">Explore reward tokens <span aria-hidden="true">→</span></a></article>
    </div><p class="auto-rewards-fineprint">A recorded time is a target, not a confirmed payment. Eligibility and funding are checked for each cycle.</p><section class="personal-rewards" data-personal-rewards hidden aria-label="Your creator and X rewards"><article class="personal-reward-card" data-creator-rewards hidden><div class="personal-reward-heading"><span class="auto-reward-type">Creator rewards</span><strong data-creator-identity></strong></div><div class="personal-reward-values"><div><small>Unclaimed</small><strong data-creator-unclaimed>—</strong></div><div><small>Claimed</small><strong data-creator-claimed>—</strong></div></div><p data-creator-note>Checking verified creator fees…</p></article><article class="personal-reward-card" data-x-rewards hidden><div class="personal-reward-heading"><span class="auto-reward-type">X rewards</span><strong data-x-identity></strong></div><div class="personal-reward-values"><div><small>Unclaimed</small><strong data-x-unclaimed>—</strong></div><div><small>Claimed</small><strong data-x-claimed>—</strong></div></div><p data-x-note>Checking rewards for your X account…</p><a href="#payments">View X rewards →</a></article></section><section class="funded-holder-token-rewards" id="funded-holder-token-rewards" aria-labelledby="funded-holder-token-rewards-title"><header><div><span class="auto-reward-type">$FUNDED holder allocations</span><h3 id="funded-holder-token-rewards-title">Tokens rewarding $FUNDED holders</h3><p>Published token allocations for the migration snapshot.</p></div><strong data-funded-token-count>Checking launches…</strong></header><ul data-funded-token-list aria-live="polite"><li class="funded-token-empty">Checking verified launches…</li></ul><small>These are policy allocations. Check Airdrops for verified vault funding and claim availability.</small></section><p class="auto-reward-status" data-auto-status role="status">Checking distribution availability…</p>`;
  panel.querySelector('.auto-rewards-heading').after(panel.querySelector('[data-auto-status]'));
}
async function refreshFundedHolderTokens() {
  try {
    const response = await fetch('/api/launches', { signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error('Unavailable');
    const launches = await response.json();
    if (!Array.isArray(launches)) throw new Error('Invalid launch list');
    homeVerifiedLaunches = launches.filter(launch => launch.onchainVerified === true && launch.cluster === EXPLORE_CLUSTER && launch.mint);
    launchNames = new Map(homeVerifiedLaunches
      .map(launch => [launch.mint, launch.symbol || launch.name || 'Coin']));
    schedule = selectPublishedSchedule();
    renderClocks();
    const tokens = homeVerifiedLaunches.filter(launch => launch.communityAirdrop?.eligibility?.asset === '$FUNDED'
      && Number.isSafeInteger(Number(launch.communityAirdrop?.reservedTokens))
      && Number(launch.communityAirdrop.reservedTokens) > 0
      && Number.isFinite(Number(launch.communityAirdrop?.allocationPercent))
      && Number(launch.communityAirdrop.allocationPercent) > 0)
      .sort((a, b) => Number(b.createdTimestamp || 0) - Number(a.createdTimestamp || 0));
    homeFundedTokens = tokens;
    homeReserves = null;
    renderHomeRewardCards();
    for (const panel of panels) {
      panel.querySelector('[data-funded-token-count]').textContent = `${tokens.length} published ${tokens.length === 1 ? 'allocation' : 'allocations'}`;
      const list = panel.querySelector('[data-funded-token-list]');
      list.replaceChildren();
      if (!tokens.length) {
        const empty = document.createElement('li');
        empty.className = 'funded-token-empty';
        empty.textContent = 'No verified $FUNDED holder token allocations are published yet.';
        list.append(empty);
        continue;
      }
      for (const launch of tokens) {
        const item = document.createElement('li');
        const link = document.createElement('a');
        link.href = `/token/${encodeURIComponent(launch.mint)}`;
        link.className = 'funded-token-row';
        const avatar = document.createElement('span');
        avatar.className = 'funded-token-avatar';
        avatar.setAttribute('aria-hidden', 'true');
        avatar.textContent = String(launch.symbol || launch.name || 'T').slice(0, 1).toUpperCase();
        const identity = document.createElement('span');
        identity.className = 'funded-token-identity';
        const name = document.createElement('strong');
        name.textContent = launch.name || launch.symbol || 'Unnamed token';
        const symbol = document.createElement('small');
        symbol.textContent = `${launch.symbol || 'TOKEN'} · ${launch.communityAirdrop.snapshot?.status === 'pending-migration' ? 'Migration snapshot unverified' : 'Snapshot unverified'}`;
        identity.append(name, symbol);
        const amount = document.createElement('span');
        amount.className = 'funded-token-amount';
        const reserved = document.createElement('strong');
        reserved.textContent = `${Number(launch.communityAirdrop.reservedTokens).toLocaleString()} ${launch.symbol || 'tokens'}`;
        const share = document.createElement('small');
        share.textContent = `${Number(launch.communityAirdrop.allocationPercent).toLocaleString(undefined, { maximumFractionDigits: 2 })}% of supply`;
        amount.append(reserved, share);
        const arrow = document.createElement('span');
        arrow.className = 'funded-token-arrow';
        arrow.textContent = 'View coin →';
        link.append(avatar, identity, amount, arrow);
        item.append(link);
        list.append(item);
        loadFundedTokenLogo(avatar, launch);
      }
    }
    const revision = ++fundedFetchRevision;
    if (!tokens.length || !homeSpotlight) return;
    void refreshCurrentFundedReceivers(revision);
    void fetch('/api/airdrops/reserves', { signal:AbortSignal.timeout(30000) })
      .then(response => response.ok ? response.json() : null)
      .then(reserves => { if (revision === fundedFetchRevision) { homeReserves = reserves; renderHomeRewardCards(); } })
      .catch(() => { if (revision === fundedFetchRevision) { homeReserves = { status: 'unavailable' }; renderHomeRewardCards(); } });
  } catch {
    fundedFetchRevision += 1;
    homeVerifiedLaunches = [];
    homeFundedTokens = [];
    homeReserves = null;
    launchNames = new Map();
    schedule = null;
    renderClocks();
    renderHomeRewardCards();
    if (homeSpotlight) for (const empty of homeSpotlight.querySelectorAll('.home-rewards-empty')) empty.textContent = 'Verified reward data is unavailable.';
    for (const panel of panels) {
      panel.querySelector('[data-funded-token-count]').textContent = 'Unavailable';
      panel.querySelector('[data-funded-token-list]').innerHTML = '<li class="funded-token-empty">Verified token allocations are unavailable right now.</li>';
    }
  }
}
async function refreshCurrentFundedReceivers(revision) {
  let result = { status:'unavailable' };
  try {
    const configResponse = await fetch('/api/listings/config', { signal:AbortSignal.timeout(8000) });
    if (!configResponse.ok) throw new Error('Mint config unavailable');
    const config = await configResponse.json();
    if (config.cluster !== EXPLORE_CLUSTER || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(config.fundedMint || '')) throw new Error('Mint unavailable');
    const response = await fetch(`/api/tokens/${encodeURIComponent(config.fundedMint)}/token-accounts`, { signal:AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error('Wallets unavailable');
    const data = await response.json();
    if (data.cluster !== EXPLORE_CLUSTER || data.mint !== config.fundedMint
      || data.coverage !== 'complete-account-list' || !Array.isArray(data.accounts)) throw new Error('Complete wallet list unavailable');
    const wallets = new Set();
    for (const row of data.accounts) {
      if (!/^\d+$/.test(String(row?.amount)) || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(row?.wallet || ''))
        throw new Error('Unverified wallet owner');
      if (BigInt(row.amount) > 0n) wallets.add(row.wallet);
    }
    result = { wallets };
  } catch { /* Do not present a partial account sample as an estimated recipient count. */ }
  if (revision === fundedFetchRevision) { homeReceiverEstimate = result; renderHomeRewardCards(); }
}
let schedule = null, offset = 0, scheduleRows = [];
function selectPublishedSchedule() {
  if (!launchNames.size) return null;
  const mint = location.pathname.match(/^\/token\/([^/]+)$/)?.[1];
  return selectDisplaySchedule(scheduleRows.filter(row => launchNames.has(row?.mint)), mint, Date.now() + offset);
}
const utcMoment = value => {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? `${new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(date)} UTC`
    : '—';
};
function renderHomeClocks() {
  if (!homeSpotlight) return;
  const now = Date.now() + offset;
  for (const card of homeSpotlight.querySelectorAll('.home-reward-token-card')) {
    const timing = card.querySelector('.home-rewards-timing');
    const label = card.querySelector('.home-reward-clock-label');
    const value = card.querySelector('.home-reward-clock');
    const progressTrack = card.querySelector('.home-reward-curve-track');
    progressTrack.hidden = true;
    timing.hidden = false;
    label.removeAttribute('title');
    const expiresAt = Number(card.dataset.claimExpiresAt);
    if (expiresAt > 0 && expiresAt <= now) {
      renderHomeRewardCards();
      return;
    }
    if (expiresAt > now) {
      label.textContent = 'Claim window closes in';
      value.textContent = countdownText(Math.ceil((expiresAt - now) / 1000));
      continue;
    }
    if (expiresAt > 0) card.querySelector('.home-reward-token-proof').textContent = 'Claim window ended';
    const mint = card.dataset.scheduleMint;
    const row = mint ? selectDisplaySchedule(scheduleRows.filter(item => item?.mint === mint && item.asset === 'SOL'), mint, now) : null;
    const clock = distributionClock(row, now);
    const progress = verifiedCurveProgress(card.dataset.rewardMint);
    if (!row && !(expiresAt > 0) && card.dataset.airdropStatus !== 'drop-closed'
      && card.dataset.hasAirdropPolicy === 'true' && progress != null) {
      label.textContent = 'Curve progress';
      label.title = 'The verified Pump bonding curve fill is a step toward migration, not a migration countdown.';
      value.textContent = `${Math.round(progress)}%`;
      progressTrack.hidden = false;
      progressTrack.querySelector('i').style.width = `${progress}%`;
      continue;
    }
    if (!row || clock.remaining == null) {
      timing.hidden = true;
      continue;
    }
    label.textContent = clock.label;
    value.textContent = countdownText(clock.remaining);
  }
}
document.addEventListener('funded:verified-curves', renderHomeClocks);
function renderClocks() {
  const clock = distributionClock(schedule, Date.now() + offset);
  renderHomeClocks();
  for (const panel of panels) {
    panel.querySelector('[data-clock-label]').textContent = clock.label;
    const countdown = panel.querySelector('[data-clock]');
    countdown.hidden = clock.remaining == null;
    if (clock.remaining != null) countdown.textContent = countdownText(clock.remaining);
    const coin = panel.querySelector('[data-clock-coin]');
    coin.hidden = !schedule?.mint;
    if (schedule?.mint) {
      coin.href = `/token/${encodeURIComponent(schedule.mint)}`;
      coin.textContent = `${launchNames.get(schedule.mint) || `${schedule.mint.slice(0, 4)}…${schedule.mint.slice(-4)}`} · view coin →`;
    }
    const dates = panel.querySelector('[data-clock-dates]');
    dates.hidden = !schedule?.cutoffAt || !schedule?.payoutAt;
    if (!dates.hidden) {
      panel.querySelector('[data-clock-cutoff]').textContent = utcMoment(schedule.cutoffAt);
      panel.querySelector('[data-clock-payout]').textContent = utcMoment(schedule.payoutAt);
    }
  }
}
async function refreshSchedules({ retry = true } = {}) {
  try {
    const response = await fetch('/api/rewards/automatic', { signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error('Unavailable');
    const data = await response.json();
    const time = Date.parse(data.serverTime);
    if (Number.isFinite(time)) offset = time - Date.now();
    scheduleRows = ['active', 'degraded'].includes(data.status) && Array.isArray(data.schedules) ? data.schedules : [];
    schedule = selectPublishedSchedule();
    renderHomeRewardCards();
    for (const panel of panels) {
      panel.querySelector('.preview-chip').textContent = data.status === 'active' ? 'Schedules live' : data.status === 'degraded' ? 'Schedules need attention' : 'Schedules unavailable';
      panel.querySelector('.preview-chip').dataset.state = data.status === 'active' ? 'active' : 'unavailable';
      const status = panel.querySelector('[data-auto-status]');
      status.hidden = data.status === 'active';
      status.textContent = data.reason || 'Reward schedules are temporarily unavailable.';
    }
  } catch {
    schedule = null;
    scheduleRows = [];
    renderHomeRewardCards();
    for (const panel of panels) {
      panel.querySelector('.preview-chip').textContent = 'Schedules unavailable';
      panel.querySelector('.preview-chip').dataset.state = 'unavailable';
      const status = panel.querySelector('[data-auto-status]');
      status.hidden = false;
      status.textContent = 'Reward schedules are temporarily unavailable.';
    }
    if (retry) setTimeout(() => { if (!document.hidden) void refreshSchedules({ retry:false }); }, 1500);
  }
  renderClocks();
}
async function refreshXRoute() {
  try {
    const response = await fetch('/api/x-fee/status', { signal:AbortSignal.timeout(8000) });
    homeXRouteReady = response.ok && (await response.json()).ready === true;
  } catch { homeXRouteReady = false; }
  renderSimpleRewardCards('x');
}
async function refreshHomePaidSummary() {
  let result = { status:'unavailable', tokens:new Map() };
  try {
    const response = await fetch('/api/rewards/experience', { signal:AbortSignal.timeout(18000) });
    if (!response.ok) throw new Error('Reward receipts unavailable');
    const data = await response.json();
    if (data.cluster !== EXPLORE_CLUSTER || !['onchain-indexed', 'partial', 'no-records'].includes(data.evidence?.status)
      || !Array.isArray(data.tokens)) throw new Error('Verified reward coverage unavailable');
    result = { status:data.evidence.status, tokens:new Map(data.tokens.filter(row => row?.mint).map(row => [row.mint, row])) };
  } catch { /* Do not present missing receipt coverage as zero paid. */ }
  homePaidSummary = result;
  renderSimpleRewardCards('coin');
  renderSimpleRewardCards('x');
}
if (panels.length) {
  await Promise.all([refreshSchedules(), refreshFundedHolderTokens(), refreshXRoute(), refreshHomePaidSummary()]);
  setInterval(() => { if (!document.hidden) void refreshSchedules(); }, 30000);
  setInterval(() => { if (!document.hidden) void refreshFundedHolderTokens(); }, 60000);
  setInterval(() => { if (!document.hidden) void refreshXRoute(); }, 60000);
  setInterval(() => { if (!document.hidden) void refreshHomePaidSummary(); }, 60000);
  setInterval(() => { if (!document.hidden) renderClocks(); }, 1000);
}
