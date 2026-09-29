import { distributionClock, countdownText, selectDisplaySchedule } from './automatic-rewards.js';
import { EXPLORE_CLUSTER } from './app-config.js';
import './automatic-rewards.css';

const panels = document.querySelectorAll('[data-automatic-rewards]');
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
      <article class="auto-reward-card"><div class="auto-reward-card-top"><span class="auto-reward-icon" aria-hidden="true">✦</span><span class="auto-reward-type">$FUNDED HOLDERS</span></div><h3>New coin tokens</h3><p>Published policies target $FUNDED holders at each launch’s migration snapshot. Vault funding and eligibility remain unverified.</p><div class="auto-airdrop-note"><strong>Timing depends on each launch</strong><span>There is no fixed airdrop date before migration.</span></div><a class="auto-reward-link" href="#funded-holder-token-rewards">Explore reward tokens <span aria-hidden="true">→</span></a></article>
    </div><p class="auto-rewards-fineprint">A recorded time is a target, not a confirmed payment. Eligibility and funding are checked for each cycle.</p><section class="personal-rewards" data-personal-rewards hidden aria-label="Your creator and X rewards"><article class="personal-reward-card" data-creator-rewards hidden><div class="personal-reward-heading"><span class="auto-reward-type">Creator rewards</span><strong data-creator-identity></strong></div><div class="personal-reward-values"><div><small>Unclaimed</small><strong data-creator-unclaimed>—</strong></div><div><small>Claimed</small><strong data-creator-claimed>—</strong></div></div><p data-creator-note>Checking verified creator fees…</p></article><article class="personal-reward-card" data-x-rewards hidden><div class="personal-reward-heading"><span class="auto-reward-type">X rewards</span><strong data-x-identity></strong></div><div class="personal-reward-values"><div><small>Unclaimed</small><strong data-x-unclaimed>—</strong></div><div><small>Claimed</small><strong data-x-claimed>—</strong></div></div><p data-x-note>Checking rewards for your X account…</p><a href="#payments">View X rewards →</a></article></section><section class="funded-holder-token-rewards" id="funded-holder-token-rewards" aria-labelledby="funded-holder-token-rewards-title"><header><div><span class="auto-reward-type">$FUNDED holder allocations</span><h3 id="funded-holder-token-rewards-title">Tokens rewarding $FUNDED holders</h3><p>Published token allocations for the migration snapshot.</p></div><strong data-funded-token-count>Checking launches…</strong></header><ul data-funded-token-list aria-live="polite"><li class="funded-token-empty">Checking verified launches…</li></ul><small>Policy allocations only; vault funding and token payouts are unverified.</small></section><p class="auto-reward-status" data-auto-status role="status">Checking distribution availability…</p>`;
}
async function refreshFundedHolderTokens() {
  try {
    const response = await fetch('/api/launches', { signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error('Unavailable');
    const launches = await response.json();
    if (!Array.isArray(launches)) throw new Error('Invalid launch list');
    launchNames = new Map(launches.filter(launch => launch.onchainVerified === true && launch.cluster === EXPLORE_CLUSTER && launch.mint)
      .map(launch => [launch.mint, launch.symbol || launch.name || 'Coin']));
    renderClocks();
    const tokens = launches.filter(launch => launch.onchainVerified === true && launch.cluster === EXPLORE_CLUSTER
      && launch.mint && launch.communityAirdrop?.eligibility?.asset === '$FUNDED'
      && Number.isSafeInteger(Number(launch.communityAirdrop?.reservedTokens))
      && Number(launch.communityAirdrop.reservedTokens) > 0
      && Number.isFinite(Number(launch.communityAirdrop?.allocationPercent))
      && Number(launch.communityAirdrop.allocationPercent) > 0)
      .sort((a, b) => Number(b.createdTimestamp || 0) - Number(a.createdTimestamp || 0));
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
        symbol.textContent = `${launch.symbol || 'TOKEN'} · ${launch.communityAirdrop.snapshot?.status === 'pending-migration' ? 'Migration pending' : 'Snapshot unverified'}`;
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
  } catch {
    for (const panel of panels) {
      panel.querySelector('[data-funded-token-count]').textContent = 'Unavailable';
      panel.querySelector('[data-funded-token-list]').innerHTML = '<li class="funded-token-empty">Verified token allocations are unavailable right now.</li>';
    }
  }
}
let schedule = null, offset = 0;
const utcMoment = value => {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? `${new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(date)} UTC`
    : '—';
};
function renderClocks() {
  const clock = distributionClock(schedule, Date.now() + offset);
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
async function refreshSchedules() {
  try {
    const response = await fetch('/api/rewards/automatic', { signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error('Unavailable');
    const data = await response.json();
    const time = Date.parse(data.serverTime);
    if (Number.isFinite(time)) offset = time - Date.now();
    const mint = location.pathname.match(/^\/token\/([^/]+)$/)?.[1];
    schedule = ['active', 'degraded'].includes(data.status) ? selectDisplaySchedule(data.schedules, mint, Number.isFinite(time) ? time : Date.now()) : null;
    for (const panel of panels) {
      panel.querySelector('.preview-chip').textContent = data.status === 'active' ? 'Schedules live' : data.status === 'degraded' ? 'Schedules need attention' : 'Schedules unavailable';
      panel.querySelector('.preview-chip').dataset.state = data.status === 'active' ? 'active' : 'unavailable';
      const status = panel.querySelector('[data-auto-status]');
      status.hidden = data.status === 'active';
      status.textContent = data.reason || 'Reward schedules are temporarily unavailable.';
    }
  } catch {
    schedule = null;
    for (const panel of panels) {
      panel.querySelector('.preview-chip').textContent = 'Schedules unavailable';
      panel.querySelector('.preview-chip').dataset.state = 'unavailable';
      const status = panel.querySelector('[data-auto-status]');
      status.hidden = false;
      status.textContent = 'Reward schedules are temporarily unavailable.';
    }
  }
  renderClocks();
}
if (panels.length) {
  await Promise.all([refreshSchedules(), refreshFundedHolderTokens()]);
  setInterval(() => { if (!document.hidden) void refreshSchedules(); }, 30000);
  setInterval(() => { if (!document.hidden) void refreshFundedHolderTokens(); }, 60000);
  setInterval(() => { if (!document.hidden) renderClocks(); }, 1000);
}
