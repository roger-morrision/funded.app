import { metricSelector } from './metric-selectors.js';

// Color carries meaning only: up/down, unavailable, and a few semantic values set below.
// Plain numbers use the text color instead of rotating hues by card position.
const colors = { neutral:'var(--fv-text)', info:'var(--fv-info)', success:'var(--fv-success)', accent:'var(--fv-accent)',
  violet:'var(--fv-violet)', danger:'var(--fv-danger)', muted:'var(--fv-text-muted)',
  cap:'#8fb2f0', liquidity:'#5fd4e8', holders:'#b79cf2', volume:'#f1c873', trades:'#9ad97a', burn:'#f59e6b' };

// Figure kind → colour role. Green/red stay reserved for signed changes.
const ROLES = [
  ['cap', '#coin-strip-market-cap, #coin-market-cap, .home-new-token-market strong, .home-launch-cap strong, .home-featured-stats .is-cap strong'],
  ['liquidity', '#coin-liquidity, .home-launch-liquidity strong'],
  ['holders', '#coin-holder-count, .home-new-token-holders strong, .home-launch-holders strong'],
  ['volume', '#coin-strip-volume, #coin-volume, .home-launch-volume strong'],
  ['trades', '#coin-strip-trades, #coin-trade-count'],
  ['burn', '#coin-strip-burned'],
];
// Elsewhere the figure's own label decides: the label before it, its group's
// first child, or its table column header.
const ROLE_WORDS = [['cap', /market cap|\bmc\b|mcap/i], ['liquidity', /liquidity/i], ['holders', /holder/i],
  ['volume', /volume|\bvol\b/i], ['trades', /trades?\b|txns?\b/i], ['burn', /burn/i]];
function metricLabel(value) {
  const column = value.closest?.('td');
  if (column) {
    const index = [...column.parentElement.children].indexOf(column);
    return column.closest('table')?.querySelector(`thead th:nth-child(${index + 1})`)?.textContent || '';
  }
  const previous = value.previousElementSibling;
  if (previous && !/\d/.test(previous.textContent)) return previous.textContent;
  const first = value.parentElement?.firstElementChild;
  if (first && first !== value && !first.contains(value) && !/\d/.test(first.textContent)) return first.textContent;
  return '';
}
export function metricRole(value) {
  for (const [role, selector] of ROLES) if (value.matches?.(selector)) return role;
  const label = metricLabel(value).slice(0, 40);
  return ROLE_WORDS.find(([, words]) => words.test(label))?.[0] || '';
}

export function metricTone(text, position = 0, trend = '') {
  const value = String(text).trim();
  if (!/\d/.test(value) || /unavailable|checking|pending|loading|none yet|not reported|—/i.test(value)) return 'muted';
  if (trend === 'negative' || /^[−-]\s*[$€£]?\s*\d/.test(value)) return 'danger';
  if (trend === 'positive' || /^\+\s*[$€£]?\s*\d/.test(value)) return 'success';
  return 'neutral';
}

export function mountMetricAccents(root = document.querySelector('#main-content')) {
  if (!root || root.dataset.metricAccentsReady) return;
  root.dataset.metricAccentsReady = 'true';
  const update = value => {
    const group = value.closest('article, .home-kpi-card, .your-home-stat, .scanner-metric, .proof-total') || value.parentElement;
    const position = Array.prototype.indexOf.call(group.parentElement?.children || [], group);
    const trend = value.closest('.is-negative,.negative') ? 'negative' : value.closest('.is-positive,.positive') ? 'positive' : '';
    let tone = metricTone(value.textContent, Math.max(0, position), trend);
    // Each kind of figure keeps one colour everywhere, so a row of stats reads at a glance.
    if (tone === 'neutral') tone = metricRole(value) || tone;
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
