import { metricSelector } from './metric-selectors.js';

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
