// Restrict accents to metric values, never token names, addresses or headings.
const metricSelector = [
  '.home-kpi-value > strong', '.your-home-stat strong', '.home-signal-stat b',
  '.home-proof-metrics strong', '.home-community-metrics dd',
  '.home-new-token-market strong', '.home-new-token-market > span:last-child',
  '.home-new-token-holders strong', '.home-new-token-progress strong',
  '.home-launch-card-stats strong', '.home-launch-progress-heading strong',
  '#explore-benefit-leaders strong', '.explore-market-kpis strong',
  '.explore-payout-grid article > strong', '.scanner-metric strong',
  '.coin-stat-strip strong', '.coin-summary-value strong', '.coin-burn-metrics strong', '#coin-price',
  '.coin-my-rewards-stats strong', '.holder-rewards-grid strong',
  '.analytics-kpis strong', '.proof-total strong', '.verified-metrics strong',
  '.fee-distribution-categories > article > strong', '.support-metrics article strong',
  '.reward-dashboard-value', '.reward-portfolio-summary strong', '.reward-buyback-stats strong',
  '.reward-history-amount strong', '.personal-reward-values strong', '.x-claim-dashboard article > strong',
  '.payment-amount strong', '.funded-token-amount strong', '.airdrop-funded-balance strong',
  '.airdrop-program-detail-stats strong', '.portfolio-summary strong', '.saved-token-metrics strong',
  '.wallet-detail-stats strong', '.referral-kpi-grid strong', '.bonus-countdown-pool strong',
  '.bonus-countdown-prizes b', '.role-stats strong', '.strip-stat strong', '.workspace-metrics b',
  '.launch-summary-specs strong', '.launch-pay-summary .cost-row > b', '[data-metric-value]',
  '.wallet-popover-balance strong', '.scanner-airdrop strong', '.home-holder-reward-share strong',
  '.receipt-total strong', '.receipt-rows b', '[id^="fee-output-"]',
  '#home-buyback-balance', '#cost-community-tokens', '.community-airdrop-highlight strong',
  '.airdrop-kpis strong', '.holder-airdrop-amount strong', '.directory-facts strong',
  '.paid-reference-metrics strong', '.burn-position-list strong', '.home-buyback-live-head strong',
  '.buyback-ledger-row strong', '.burn-tier-row b', '.allocation-chips b', '.role-stats b',
  '.referral-level-results strong', '.referral-tier-strip b', '.signal-list b',
  '.leaderboard-row > span > b', '.money-flow-stat b', '.revenue-flow b', '.app-revenue-grid b',
].join(',');

const tones = ['info', 'success', 'accent', 'violet'];
const colors = { info:'var(--fv-info)', success:'var(--fv-success)', accent:'var(--fv-accent)',
  violet:'var(--fv-violet)', danger:'var(--fv-danger)', muted:'var(--fv-text-muted)' };

export function metricTone(text, position = 0, trend = '') {
  const value = String(text).trim();
  if (!/\d/.test(value) || /unavailable|checking|pending|loading|none yet|not reported|—/i.test(value)) return 'muted';
  if (trend === 'negative' || /^[−-]\s*[$€£]?\s*\d/.test(value)) return 'danger';
  if (trend === 'positive' || /^\+\s*[$€£]?\s*\d/.test(value)) return 'success';
  return tones[position % tones.length];
}

export function mountMetricAccents(root = document.querySelector('#main-content')) {
  if (!root || root.dataset.metricAccentsReady) return;
  root.dataset.metricAccentsReady = 'true';
  const update = value => {
    const group = value.closest('article, .home-kpi-card, .your-home-stat, .scanner-metric, .proof-total') || value.parentElement;
    const position = Array.prototype.indexOf.call(group.parentElement?.children || [], group);
    const trend = value.closest('.is-negative,.negative') ? 'negative' : value.closest('.is-positive,.positive') ? 'positive' : '';
    let tone = metricTone(value.textContent, Math.max(0, position), trend);
    if (tone !== 'muted' && !trend && !/^[+−-]/.test(value.textContent.trim())) {
      if (value.matches('.home-new-token-market strong,.payment-amount strong,.reward-history-amount strong,#coin-price')) tone = 'success';
      if (value.matches('.home-new-token-holders strong')) tone = 'info';
      if (value.matches('.home-new-token-progress strong,.home-launch-progress-heading strong,.scanner-airdrop strong')) tone = 'accent';
      if (value.matches('.home-new-token-market > span:last-child')) tone = 'violet';
    }
    const ranking = value.closest('[data-explore-leader-sort]')?.dataset.exploreLeaderSort;
    if (tone !== 'muted' && ranking) tone = ({volume:'success',airdrop:'accent','holder-fee':'info','x-fee':'violet'})[ranking] || tone;
    if (value.dataset.metricAccent !== tone) {
      value.dataset.metricAccent = tone;
      // Inline color bridges legacy page-specific selectors without more !important rules.
      value.style.color = colors[tone];
    }
  };
  const scan = node => {
    if (node.nodeType !== 1 || !root.contains(node)) return;
    const value = node.closest(metricSelector);
    if (value) update(value);
    node.querySelectorAll(metricSelector).forEach(update);
  };
  root.querySelectorAll(metricSelector).forEach(update);
  // Only inspect changed subtrees; no polling or whole-page scans on live price updates.
  new MutationObserver(records => {
    const changed = new Set();
    for (const record of records) {
      if (record.type === 'childList') {
        changed.add(record.target);
      } else changed.add(record.target.nodeType === 3 ? record.target.parentElement : record.target);
    }
    for (const node of changed) {
      if (node && ![...changed].some(parent => parent !== node && parent?.contains(node))) scan(node);
    }
  }).observe(root, {subtree:true, childList:true, characterData:true, attributes:true, attributeFilter:['class','data-state']});
}
