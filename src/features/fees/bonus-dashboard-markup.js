import {bonusRankCopy} from './fee-policy-copy.js';

// Short outline instead of one long paragraph; static strings only (safe for innerHTML).
export function bonusRulesOutline(qa = false) {
  const ranks = bonusRankCopy().replace(/ of the category budget$/, '');
  return [
    ['Pool split', '⅓ each to creators, direct referrers and traders'],
    ['Per category', ranks],
    ['Snapshot', qa ? 'Devnet QA: every 5 minutes (selected test coins)' : 'Daily at 00:00 UTC'],
    ['Payout', 'Automatic after verification · no claim needed'],
  ].map(([term, text]) => `<li><b>${term}</b><span>${text}</span></li>`).join('');
}

export const HOME_BONUS_MARKUP = `
          <header class="bonus-section-heading"><div><p class="eyebrow">Daily bonus · SOL</p><h2 id="home-bonus-title">Create. Refer. Trade.</h2><p data-bonus-schedule>Three leaderboards. Top 3 in each. One snapshot every UTC day.</p></div><a class="text-button" href="#bonuses">Payout history &amp; top wallets →</a></header>
          <div class="bonus-clock"><span data-bonus-cutoff-label>Next snapshot · 00:00 UTC</span><strong data-bonus-countdown aria-label="Time until next bonus snapshot">—:—:—</strong></div>
          <div class="bonus-pool-grid">
            <article><span class="bonus-category-mark" aria-hidden="true">01</span><h3>Creator bonus</h3><strong data-bonus-pool="creators">— SOL</strong><p>Top creators by finalized settled fees</p><small>${bonusRankCopy()}</small><a href="#bonuses" data-bonus-category-link="creators">See creator payouts →</a></article>
            <article><span class="bonus-category-mark" aria-hidden="true">02</span><h3>Referral bonus</h3><strong data-bonus-pool="referrals">— SOL</strong><p>Top referrers by referred settled fees</p><small>${bonusRankCopy()}</small><a href="#bonuses" data-bonus-category-link="referrals">See referrer payouts →</a></article>
            <article><span class="bonus-category-mark" aria-hidden="true">03</span><h3>Trader bonus</h3><strong data-bonus-pool="traders">— SOL</strong><p>Top traders by verified SOL volume</p><small>${bonusRankCopy()}</small><a href="#bonuses" data-bonus-category-link="traders">See trader payouts →</a></article>
          </div>
          <p class="field-help"><strong>Allocations, not payments.</strong> Automatic payouts follow snapshot and funding verification. No claim needed.</p>
          <p class="field-help" data-bonus-verification role="status">Checking payout readiness…</p>
          <p class="field-help" data-bonus-pool-status role="status">Checking today's settled bonus pool…</p>
          <details class="ui-disclosure home-bonus-rules"><summary>How bonuses are split</summary><ul class="bonus-rules-list">${bonusRulesOutline()}<li><b>Note</b><span>Amounts shown are allocations, not paid rewards · unfilled ranks keep their share</span></li></ul></details>
        `;
export const BONUS_HISTORY_MARKUP = `
          <header class="bonus-section-heading bonus-hero"><div><p class="eyebrow">Hall of fame · Daily SOL rewards</p><h1 id="bonuses-title">Honoring today’s top contributors.</h1><p>Eligible creators, traders, and referrers can share funded bonus pools. Track confirmed payouts below.</p></div><button type="button" data-bonus-history-refresh>Refresh</button></header>
          <p data-bonus-history-status role="status">Checking finalized bonus receipts…</p>
          <section class="bonus-alltime" aria-labelledby="bonus-leaders-title"><div class="bonus-stage-head"><div><p class="eyebrow">Hall of fame</p><h2 id="bonus-leaders-title">All-time top recipients</h2><p class="field-help">Top 10 per category · confirmed payouts from all recorded snapshots.</p></div></div><div class="bonus-leaders-grid bonus-honor-grid" data-bonus-leaders></div></section>
          <section aria-labelledby="bonus-history-title"><div class="bonus-section-heading bonus-history-toolbar"><h2 id="bonus-history-title">Payout history</h2><label><span class="sr-only">Bonus category</span><select data-bonus-history-category><option value="all">All bonuses</option><option value="creators">Creators</option><option value="referrals">Referrers</option><option value="traders">Traders</option></select></label></div><details class="bonus-receipt-help ui-disclosure"><summary>How to read payouts</summary><p class="field-help">Wallet received is the full receipt. Category columns attribute that receipt across bonuses; they are not additional payments.</p><p class="field-help">Combined payments are attributed proportionally to category awards, after deductions; rounding is reconciled to the lamport.</p></details><div class="daily-bonus-table" data-bonus-history-rows></div><div class="bonus-pagination"><button type="button" data-bonus-previous disabled>Previous</button><span data-bonus-page></span><button type="button" data-bonus-next disabled>Next</button></div></section>
          <a class="text-button" href="#capital-flow">Review fee policy &amp; snapshot rankings →</a>
          <details class="bonus-policy-disclosure ui-disclosure"><summary>Ranking &amp; payout rules</summary><ul class="bonus-rules-list" data-bonus-delivery>${bonusRulesOutline()}</ul></details>`;
