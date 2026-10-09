// Read the published policy supplied by the application; this preview never moves funds.
export function createFeeFlowView(APP_ECONOMICS) {
  function formatFlowAmount(value){
    const amount = Number(value || 0);
    if (amount > 0 && amount < 0.000000001) return '<0.000000001 SOL';
    return `${amount.toLocaleString(undefined, { minimumFractionDigits: amount > 0 && amount < 1 ? 3 : 0, maximumFractionDigits: 9 })} SOL`;
  }

  function renderPublishedFeeRates(){
    const effective = [APP_ECONOMICS.operationsEffectivePercent, APP_ECONOMICS.appReferralEffectivePercent, APP_ECONOMICS.communityEffectivePercent, APP_ECONOMICS.buybackEffectivePercent];
    const levels = APP_ECONOMICS.appReferralLevels;
    const percent = value => `${value}%`;
    const set = (selector, value) => { const node = document.querySelector(selector); if (node) node.textContent = value; };
    const setAll = (selector, values) => document.querySelectorAll(selector).forEach((node, index) => { if (index < values.length) node.textContent = values[index]; });
    const setWidths = (selector, values) => document.querySelectorAll(selector).forEach((node, index) => { if (index < values.length) node.style.width = percent(values[index]); });
    const levelGross = levels.map(level => level.effectivePercentOfCreatorFees);
    setWidths('.home-receipt-card .receipt-bars span', [80, ...effective]);
    setWidths('.fee-route-bar i', [80, ...effective]);
    setAll('.home-receipt-card .receipt-rows span', [
      '80 SOL Creator-directed', `${effective[0]} SOL Operations`, `${effective[1]} SOL Referral network`,
      `${effective[2]} SOL Community reserve`, `${effective[3]} SOL $FUNDED burn`,
    ]);
    setAll('.audience-referrer li', levelGross.map((rate, index) => `${percent(rate)} ${['direct', 'second', 'third'][index]} level`));
    setAll('.home-referral-levels article strong', levelGross.map(percent));
    setAll('.referral-tier-strip > span b', levelGross.map(percent));
    setAll('.app-revenue-grid > span b', [APP_ECONOMICS.operationsRateOfFundedRevenue, APP_ECONOMICS.appReferralRateOfFundedRevenue, APP_ECONOMICS.communityRateOfFundedRevenue, APP_ECONOMICS.buybackRateOfFundedRevenue].map(percent));
    setAll('.allocation-chips span b', effective.map(percent));
    setAll('.app-revenue-grid > span small', [
      `${percent(effective[0])} of gross fees`, levels.map(level => `L${level.level} ${percent(level.percentOfFundedRevenue)}`).join(' · '),
      `${percent(effective[2])} of gross fees`, `${percent(effective[3])} of gross fees`,
    ]);
    setAll('.fee-output-grid > div small', [
      '80% of gross', `${percent(effective[0])} of gross`,
      `L1 ${percent(levelGross[0])} · L2 ${percent(levelGross[1])} · L3 ${percent(levelGross[2])}`,
      `${percent(effective[2])} of gross`, `${percent(effective[3])} of gross`,
    ]);
    setAll('.referral-level-results span small', levelGross.map((rate, index) => `Level ${index + 1} · ${percent(rate)} of gross`));
    set('.referral-growth-hero p', `A direct creator can earn you ${percent(levelGross[0])} of their gross creator fees, with additional rewards from the next two levels.`);
    set('#referrals .referral-calculator + .field-help', `Example only: the three levels total ${percent(APP_ECONOMICS.appReferralEffectivePercent)} of gross collected fees when all levels qualify. Rewards require collected fees.`);
    set('.home-referral-guide .data-badge', `${percent(APP_ECONOMICS.appReferralEffectivePercent)} total policy`);
    set('#paid .revenue-model > .field-help', `Levels 1–3 receive ${levelGross.map(percent).join(', ')} of gross creator fees. Missing upline levels move to the community reserve. Existing coins keep their recorded split.`);
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
