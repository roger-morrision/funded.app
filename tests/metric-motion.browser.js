// Run in a Vite-served browser page: await runMetricMotionChecks(). No API or wallet access.
import { mountMetricMotion } from '../src/features/experience/metric-motion.js';

export async function runMetricMotionChecks() {
  const root = document.createElement('section');
  root.id = 'metric-motion-fixture';
  root.style.cssText = 'position:fixed;top:20px;left:20px;background:#fff;color:#111;padding:20px;z-index:99999';
  root.innerHTML = '<strong id="metric-test-value" data-metric-value>$100.00</strong><div id="metric-test-cards"></div>';
  document.body.append(root);
  const results = [], wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const check = (name, pass) => { if (!pass) throw Error(name); results.push(name); };
  const dispose = mountMetricMotion(root);
  const value = root.querySelector('strong');
  try {
    check('first observation is exact without counting from zero', !value.dataset.metricFrame);
    value.textContent = '$200.00'; await wait(80);
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      check('reduced motion displays target immediately', !value.dataset.metricFrame && value.textContent === '$200.00');
      return results;
    }
    check('increase animates between old and new values', Number(value.dataset.metricFrame?.slice(1)) > 100 && Number(value.dataset.metricFrame?.slice(1)) < 200);
    check('canonical DOM value stays exact throughout animation', value.textContent === '$200.00');
    check('visual frame has empty accessible alternative', getComputedStyle(value, '::after').content.endsWith('/ ""'));
    const current = Number(value.dataset.metricFrame.slice(1));
    value.textContent = '$50.00'; await wait(80);
    check('interrupted update reverses from the current display', Number(value.dataset.metricFrame?.slice(1)) < current + 15 && Number(value.dataset.metricFrame?.slice(1)) > 50);
    await wait(700);
    check('finishes with exact target and no remaining overlay', !value.dataset.metricFrame && value.textContent === '$50.00');
    value.textContent = 'Unavailable'; await wait(25);
    check('unknown values clear animation', !value.dataset.metricFrame);
    value.textContent = '$90.00'; await wait(25);
    check('unavailable to known snaps without fabricated baseline', !value.dataset.metricFrame);
    value.textContent = '1 SOL'; await wait(25);
    check('unit changes snap', !value.dataset.metricFrame);
    value.innerHTML = '$0.0<sub>7</sub>3415'; await wait(25);
    value.innerHTML = '$0.0<sub>7</sub>6415'; await wait(50);
    check('tiny prices with real subscript markup animate', value.dataset.metricFrame?.includes('₇') && value.querySelector('sub').textContent === '7');
    const cards = root.querySelector('#metric-test-cards');
    const card = (mint,count) => `<article data-mint="${mint}"><strong data-metric-value>${count}</strong></article>`;
    cards.innerHTML = card('A',10) + card('B',100); await wait(25);
    cards.innerHTML = card('B',110) + card('A',20); await wait(50);
    check('rebuilt sorted cards retain token identity', Number(cards.firstChild.firstChild.dataset.metricFrame) >= 100 && Number(cards.lastChild.firstChild.dataset.metricFrame) < 20);
    root.style.top = '-10000px'; value.textContent = '$200'; await wait(50);
    check('offscreen metrics do not animate', !value.dataset.metricFrame);
    return results;
  } finally { dispose?.(); root.remove(); }
}
