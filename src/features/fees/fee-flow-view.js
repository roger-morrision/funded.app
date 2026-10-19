// Read the published policy supplied by the application; this preview never moves funds.
import { currentFeePolicyCopy } from './fee-policy-copy.js';
import { initDailyBonusView } from './daily-bonus-view.js';
import { initBonusDashboard } from './bonus-dashboard-view.js';
import { renderProductFaqs } from '../help/product-guidance.js';
import { initMarketingAgency } from '../marketing/agency-view.js';
import { initServiceFeeCopy } from './service-fees-client.js';
export function createFeeFlowView(APP_ECONOMICS) {
  if (typeof window !== 'undefined') {
    initMarketingAgency();
    initServiceFeeCopy();
    window.addEventListener('funded:service-fees', () => renderProductFaqs());
  }
  initDailyBonusView();
  initBonusDashboard();
  renderProductFaqs();
  function formatFlowAmount(value){
    const amount = Number(value || 0);
    if (amount > 0 && amount < 0.000000001) return '<0.000000001 SOL';
    return `${amount.toLocaleString(undefined, { minimumFractionDigits: amount > 0 && amount < 1 ? 3 : 0, maximumFractionDigits: 9 })} SOL`;
  }

  function renderPublishedFeeRates(){
    renderProductFaqs();
    const copy = currentFeePolicyCopy();
    const effective = [APP_ECONOMICS.operationsEffectivePercent, APP_ECONOMICS.appReferralEffectivePercent, APP_ECONOMICS.communityEffectivePercent, APP_ECONOMICS.buybackEffectivePercent];
    const levels = APP_ECONOMICS.appReferralLevels;
    const percent = value => `${value}%`;
    const set = (selector, value) => { const node = document.querySelector(selector); if (node) node.textContent = value; };
    const setAll = (selector, values) => document.querySelectorAll(selector).forEach((node, index) => { if (index < values.length) node.textContent = values[index]; });
    const setWidths = (selector, values) => document.querySelectorAll(selector).forEach((node, index) => { if (index < values.length) node.style.width = percent(values[index]); });
    const levelGross = levels.map(level => level.effectivePercentOfCreatorFees);
    setWidths('.home-receipt-card .receipt-bars span', [APP_ECONOMICS.creatorSharePercent, ...effective]);
    setWidths('.fee-route-bar i', [APP_ECONOMICS.creatorSharePercent, ...effective]);
    setAll('.home-receipt-card .receipt-rows span', [
      `${APP_ECONOMICS.creatorSharePercent} SOL Creator-directed`, `${effective[0]} SOL Operations & marketing`, `${effective[1]} SOL Referral network`,
      `${effective[2]} SOL Daily bonus`, `${effective[3]} SOL Buyback allocation`,
    ]);
    setAll('.audience-referrer li', levelGross.map((rate, index) => `${percent(rate)} ${['direct', 'second', 'third'][index]} level`));
    setAll('.home-referral-levels article strong', levelGross.map(percent));
    setAll('.referral-tier-strip > span b', levelGross.map(percent));
    setAll('.app-revenue-grid > span b', [APP_ECONOMICS.operationsRateOfFundedRevenue, APP_ECONOMICS.appReferralRateOfFundedRevenue, APP_ECONOMICS.communityRateOfFundedRevenue, APP_ECONOMICS.buybackRateOfFundedRevenue].map(percent));
    setAll('.app-revenue-grid > span em', ['Operations & marketing', 'Referral network', 'Daily bonus', '$FUNDED burn']);
    setAll('.allocation-chips span b', effective.map(percent));
    setAll('.allocation-chips span small', ['Operations & marketing', 'Referral network', 'Daily bonus', 'Buyback allocation']);
    setAll('.app-revenue-grid > span small', [
      `${percent(effective[0])} of gross fees`, levels.map(level => `L${level.level} ${percent(level.percentOfFundedRevenue)}`).join(' · '),
      `${percent(effective[2])} of gross fees`, `${percent(effective[3])} of gross fees`,
    ]);
    setAll('.fee-output-grid > div small', [
      `${percent(APP_ECONOMICS.creatorSharePercent)} of gross`, `${percent(effective[0])} of gross`,
      `L1 ${percent(levelGross[0])} · L2 ${percent(levelGross[1])} · L3 ${percent(levelGross[2])}`,
      `${percent(effective[2])} of gross`, `${percent(effective[3])} of gross`,
    ]);
    setAll('.referral-level-results span small', levelGross.map((rate, index) => `Level ${index + 1} · ${percent(rate)} of gross`));
    set('.referral-growth-hero p', `A direct creator can earn you ${percent(levelGross[0])} of their gross creator fees, with additional rewards from the next two levels.`);
    set('#referrals .referral-calculator + .field-help', `Example only: the three levels total ${percent(APP_ECONOMICS.appReferralEffectivePercent)} of gross collected fees when all levels qualify. Rewards require collected fees.`);
    set('.home-referral-guide .data-badge', `${percent(APP_ECONOMICS.appReferralEffectivePercent)} total policy`);
    set('#paid .revenue-model > .field-help', `Levels 1–3 receive ${levelGross.map(percent).join(', ')} of gross creator fees. ${copy.reserve} Existing coins keep their recorded split.`);
    set('#fee-policy-faq', `For each finalized collection, ${percent(APP_ECONOMICS.creatorSharePercent)} follows the creator's launch-time split between their wallet, coin holders, and an eligible X account. The other ${percent(APP_ECONOMICS.fundedSharePercent)} funds Operations & marketing (${percent(effective[0])}), referrals (${percent(effective[1])}), Daily bonus (${percent(effective[2])}), and the $FUNDED buyback allocation (${percent(effective[3])}). Daily bonus uses the top three creators, referrers, and traders from each completed UTC day. Existing coins keep their saved policy.`);
    set('#capital-flow > .section-heading .panel-explainer', copy.scope);
    set('#capital-flow .route-timeline li:nth-child(2) small', 'The keeper collects verified fees into the coin’s V3 router.');
    set('#capital-flow .route-timeline li:nth-child(3) small', 'The creator signs settlement under the coin’s saved fee policy.');
    set('#capital-flow .route-timeline li:nth-child(4) small', 'Fund allocations, then verify each eligible recipient’s payment.');
    set('#buyback-policy-heading', `Preview the ${percent(effective[3])} policy`);
    set('#buyback-policy-note', `A 5 SOL claim allocates ${formatFlowAmount(5 * effective[3] / 100)} to the buyback allocation. Local calculation only; no claim recorded.`);
  }

  function renderFeeFlowCalculator(){
    const input = document.querySelector('#fee-flow-input');
    if (!input) return;
    const note = document.querySelector('#fee-flow-note');
    const gross = Number(input.value);
    if (input.value.trim() === '' || !Number.isFinite(gross) || gross < 0) {
      ['creator', 'operations', 'referrals', 'community', 'buyback'].forEach(key => {
        const node = document.querySelector(`#fee-output-${key}`);
        if (node) node.textContent = '—';
      });
      if (note) note.textContent = 'Enter a non-negative gross creator-fee amount to preview the policy split.';
      return;
    }
    const allocations = {
      creator: gross * APP_ECONOMICS.creatorSharePercent / 100,
      operations: gross * APP_ECONOMICS.operationsEffectivePercent / 100,
      referrals: gross * APP_ECONOMICS.appReferralEffectivePercent / 100,
      community: gross * APP_ECONOMICS.communityEffectivePercent / 100,
      buyback: gross * APP_ECONOMICS.buybackEffectivePercent / 100,
    };
    Object.entries(allocations).forEach(([key, amount]) => {
      const node = document.querySelector(`#fee-output-${key}`);
      if (node) node.textContent = formatFlowAmount(amount);
    });
    const allocated = Object.values(allocations).reduce((sum, amount) => sum + amount, 0);
    if (note) note.textContent = `A ${formatFlowAmount(gross)} claim allocates exactly ${formatFlowAmount(allocated)} under the published policy.`;
  }
  return { renderPublishedFeeRates, renderFeeFlowCalculator };
}
