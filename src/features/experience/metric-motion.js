import { metricSelector } from './metric-selectors.js';
import { compatibleMetrics, formatMetricFrame, metricValueAt, parseMetric } from './metric-number.js';
import './metric-motion.css';

const excluded = 'input,textarea,select,button,[contenteditable],time,[role="timer"],[data-no-count],.transaction-review,.launch-pay-summary';

function metricText(node) {
  return [...node.childNodes].map(child => child.nodeType === 1 && child.tagName === 'SUB'
    ? [...child.textContent].map(digit => '₀₁₂₃₄₅₆₇₈₉'[Number(digit)] || digit).join('')
    : child.textContent).join('').trim();
}

// Stable token identities survive sorting and innerHTML refreshes. Never transfer
// an old value between rows that happen to occupy the same position in a list.
function metricKey(element, root) {
  const path = [];
  for (let node = element; node && node !== root; node = node.parentElement) {
    const mint = node.dataset.mint || node.dataset.logoMint;
    if (mint) return `mint:${mint}/${path.join('/')}`;
    if (node.matches('a[href^="/token/"]')) return `token:${node.getAttribute('href')}/${path.join('/')}`;
    if (node.id) return `id:${node.id}/${path.join('/')}`;
    if (node.matches('tr,[role="row"],li,article') && node !== element) return null;
    path.unshift(`${node.tagName}:${Array.prototype.indexOf.call(node.parentElement?.children || [], node)}`);
  }
  return null;
}

export function mountMetricMotion(root = document.body) {
  if (!root || root.dataset.metricMotionReady || !CSS.supports('content', 'attr(data-metric-frame) / ""')) return;
  root.dataset.metricMotionReady = 'true';
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let states = new WeakMap();
  const history = new Map(), active = new Map();
  let frame = 0, route = location.pathname + location.hash;
  const visible = node => {
    if (!node.isConnected || document.hidden || reduced.matches || !node.checkVisibility()) return false;
    const box = node.getBoundingClientRect();
    return box.bottom > 0 && box.top < innerHeight && box.right > 0 && box.left < innerWidth;
  };
  const stop = node => {
    active.delete(node);
    node.removeAttribute('data-metric-frame');
    node.style.removeProperty('--metric-motion-color');
  };
  const tick = now => {
    frame = 0;
    for (const [node, animation] of active) {
      // A source update can arrive before MutationObserver delivery.
      if (!visible(node) || metricText(node) !== animation.target.exact || now - animation.start >= 650) {
        stop(node); continue;
      }
      animation.current = metricValueAt(animation.from, animation.target.value, now - animation.start);
      node.dataset.metricFrame = formatMetricFrame(animation.current, animation.target);
    }
    if (active.size) frame = requestAnimationFrame(tick);
  };
  const update = node => {
    if (!root.contains(node) || [...node.children].some(child => child.tagName !== 'SUB') || node.closest(excluded)) return;
    const target = parseMetric(metricText(node));
    const key = metricKey(node, root);
    const old = states.get(node) || (key && history.get(key));
    if (old?.exact === target?.exact) return;
    const previous = active.get(node);
    const from = previous ? metricValueAt(previous.from, previous.target.value, performance.now() - previous.start) : old?.value;
    stop(node);
    states.set(node, target);
    if (key) {
      history.delete(key);
      if (target) history.set(key, target);
      if (history.size > 2000) history.delete(history.keys().next().value);
    }
    // First observations, unknown values and changed units snap to the real value.
    if (!compatibleMetrics(old, target) || from === target.value || !visible(node)) return;
    node.style.setProperty('--metric-motion-color', getComputedStyle(node).color);
    node.dataset.metricFrame = formatMetricFrame(from, target);
    active.set(node, { from, current:from, target, start:performance.now() });
    if (!frame) frame = requestAnimationFrame(tick);
  };
  const scan = node => {
    if (node?.nodeType !== 1) return;
    const owner = node.closest(metricSelector);
    if (owner) update(owner);
    node.querySelectorAll(metricSelector).forEach(update);
  };
  scan(root);
  const observer = new MutationObserver(records => {
    const nextRoute = location.pathname + location.hash;
    if (route !== nextRoute) {
      route = nextRoute; history.clear(); states = new WeakMap();
      for (const node of active.keys()) stop(node);
    }
    const changed = new Set();
    for (const record of records) {
      const node = record.target.nodeType === 3 ? record.target.parentElement : record.target;
      if (node) changed.add(node);
    }
    for (const node of changed) {
      if (![...changed].some(parent => parent !== node && parent.contains(node))) scan(node);
    }
  });
  // Frame attributes and style updates are intentionally not observed.
  observer.observe(root, {subtree:true, childList:true, characterData:true});
  const finish = () => {
    for (const node of active.keys()) stop(node);
    cancelAnimationFrame(frame); frame = 0;
  };
  const visibility = () => { if (document.hidden) finish(); };
  reduced.addEventListener('change', finish);
  document.addEventListener('visibilitychange', visibility);
  return () => {
    observer.disconnect(); finish();
    reduced.removeEventListener('change', finish);
    document.removeEventListener('visibilitychange', visibility);
    delete root.dataset.metricMotionReady;
  };
}
