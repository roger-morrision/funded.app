import { distributionClock, countdownText } from './automatic-rewards.js';
import './automatic-rewards.css';

const panels = document.querySelectorAll('[data-automatic-rewards]');
const ruleSummary = `<div class="reward-rule-summary"><strong>The funded.vip rules</strong><p>Every collected creator-fee claim goes through the funded.vip router: <b>80% creator-directed + 20% protocol.</b> These percentages apply to collected creator fees, not trading volume or token supply.</p><p>Your wallet + coin-holder rewards + X-partner rewards must total <b>80%</b>. Example: a 100 SOL claim with 60% for your wallet and 20% for holders allocates 60 SOL to you, 20 SOL to holders, and 20 SOL to the protocol.</p><details><summary>Protocol split, airdrops, and launch promotion</summary><p>The protocol share is 14% operations, 3% referrals, 2% community programs, and 1% $FUNDED buyback and burn, all measured against gross creator fees. Referral levels receive 2%, 0.6%, and 0.4%; missing levels go to the community growth reserve.</p><p>Separately, creators select <b>3%–50% of the launched coin’s supply</b> for eligible $FUNDED holders. This token reserve is separate from both SOL holder rewards and the protocol’s 2% community allocation.</p><p>Standard requires no $FUNDED burn; network and account costs still apply. Optional Boost, Pro, and Premier tiers add badges and visibility benefits. Higher-tier review eligibility does not guarantee placement. Tier burns are separate from fee-funded buyback and burn.</p></details></div>`;
for (const target of document.querySelectorAll('[data-launch-reward-rules]')) {
  target.innerHTML = `${ruleSummary}<details class="reward-delivery-guide"><summary>How recipients get their rewards</summary><p><b>Creator wallet:</b> allocated SOL goes to the launch wallet through a verified reward cycle when automation is active.</p><p><b>Coin holders:</b> hold this coin in your own wallet. If its holder share is above 0%, daily finalized snapshots weight the amount and time held. When the distribution service is active and the cycle is verified, eligible SOL or coin tokens are transferred automatically; no reward claim or wallet connection is needed to receive them.</p><p><b>$FUNDED holders:</b> hold $FUNDED at the migration snapshot to qualify under that launch’s rules. The reward is the launched token. Delivery requires a finalized snapshot, funded reserve, and verified on-chain cycle.</p><p><b>X partners:</b> verify the matching X account and link a Solana wallet. Verified recipients can receive through an automatic reward cycle; the Rewards page remains the fallback while live automation is unavailable.</p><p><b>Referrers:</b> open Referrals, connect the eligible wallet, and claim available rewards manually. Referrals are never included in automatic payout cycles.</p></details>`;
}
for (const panel of panels) {
  panel.innerHTML = `<div class="auto-rewards-heading"><div><p class="eyebrow">Hold. Participate. Receive.</p><h2>Know when your next reward is due.</h2></div><span class="preview-chip">Devnet automation</span></div>
    ${ruleSummary}<div class="auto-rewards-grid">
      <article><span class="auto-reward-type">Coin holders · SOL or coin tokens</span><h3>Hold the coin to qualify.</h3><p>The creator must allocate a holder share above 0%. Daily cycles use finalized, time-weighted holder snapshots. Small SOL rewards carry forward until the pool reaches 0.01 SOL.</p><small>When the live status below is active, eligible wallets receive transfers automatically—no connection or claim is needed.</small><span data-clock-label>Not scheduled</span><strong class="auto-countdown" data-clock>—</strong><small data-clock-time>Default: cutoff 00:00 UTC · payout 01:00 UTC. Only recorded schedules appear.</small></article>
      <article><span class="auto-reward-type">$FUNDED holders · token airdrops</span><h3>Hold $FUNDED to qualify.</h3><p>Each launch’s rules determine eligibility at the migration snapshot. The reward is the launched coin’s tokens, transferred from its funded reward vault.</p><strong class="auto-event">Requires a verified schedule</strong><small>Migration has no guaranteed date. A finalized snapshot, funded reserve, and on-chain reward cycle are required; migration alone is not a payout.</small></article>
      <article><span class="auto-reward-type">Referrers · manual claims</span><h3>Your referral rewards. Your claim.</h3><p>Referral rewards remain manually claimed. Review available rewards, verify your wallet, and approve the claim.</p><a href="#referrals">View referral rewards →</a><small>Devnet creator and holder delivery requires verified funding and an active distribution service; check the live status below. X delivery also requires identity verification and a linked wallet.</small></article>
    </div><details class="reward-delivery-guide"><summary>Creator and X-partner payments</summary><p><b>Creators:</b> choose your receiving wallet during launch. On Devnet, verified collected SOL can be funded into the constrained vault and delivered automatically when the distribution service is active.</p><p><b>X partners:</b> verify the matching X account and link a wallet. Automatic delivery begins only after X identity verification is configured and enrollment is complete.</p><p>Receiving a transfer does not require a wallet connection. Creating a coin, proving wallet ownership, and manually claiming referral rewards still require wallet approval.</p></details><p class="auto-reward-status" data-auto-status role="status">Checking distribution availability…</p>`;
}
let schedule = null, offset = 0;
function renderClocks() {
  const clock = distributionClock(schedule, Date.now() + offset);
  for (const panel of panels) {
    panel.querySelector('[data-clock-label]').textContent = clock.label;
    panel.querySelector('[data-clock]').textContent = countdownText(clock.remaining);
    if (schedule?.cutoffAt && schedule?.payoutAt) panel.querySelector('[data-clock-time]').textContent = `Cutoff: ${schedule.cutoffAt} · Payout: ${schedule.payoutAt} (UTC)`;
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
    schedule = data.status === 'active' && mint ? data.schedules?.find(item => item.mint === mint && item.kind === 'holder') : null;
    for (const panel of panels) {
      panel.querySelector('.preview-chip').textContent = data.status === 'active' ? 'Automation active' : 'Automation unavailable';
      panel.querySelector('[data-auto-status]').textContent = data.reason || 'Worker and payout-contract readiness are current. Only persisted distribution schedules are shown.';
    }
  } catch {
    schedule = null;
    for (const panel of panels) panel.querySelector('[data-auto-status]').textContent = 'Distribution service unavailable. No payout time or earned balance is confirmed.';
  }
  renderClocks();
}
if (panels.length) {
  await refreshSchedules();
  setInterval(() => { if (!document.hidden) void refreshSchedules(); }, 30000);
  setInterval(() => { if (!document.hidden) renderClocks(); }, 1000);
}
