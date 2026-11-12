// A plain-language estimate alongside the existing trade and slippage controls.
import { el } from './format.js';

export function mountTradeSummary(document = globalThis.document) {
  const submit = document.getElementById('trade-submit');
  const slippage = document.getElementById('trade-slippage');
  if (!submit || !slippage || document.getElementById('trade-plain-summary')) return Boolean(submit);
  const summary = el(document, 'p', 'trade-plain-summary'); summary.id = 'trade-plain-summary'; summary.setAttribute('aria-live', 'polite');
  (submit.closest('.trade-actions') || submit).before(summary);
  const side = document.getElementById('trade-side'), amount = document.getElementById('trade-amount');
  const symbol = document.getElementById('trade-asset-symbol'), estimate = document.getElementById('trade-live-amount');
  function sync() {
    const value = Number(amount?.value);
    if (!Number.isFinite(value) || value <= 0) { summary.textContent = ''; summary.hidden = true; return; }
    const buying = side?.value !== 'sell', token = symbol?.textContent.trim() || 'tokens';
    const out = (estimate?.textContent.trim() || '').replace(/^≈\s*/, '');
    const outText = /\d/.test(out) ? out : 'the quoted amount';
    summary.hidden = false;
    summary.textContent = buying
      ? `You send ${value} SOL and receive about ${outText}. Max slippage ${slippage.value}%.`
      : `You sell ${value} ${token} and receive about ${outText}. Max slippage ${slippage.value}%.`;
  }
  for (const node of [side, amount, slippage]) node?.addEventListener('input', sync);
  side?.addEventListener('change', sync);
  if (estimate) new MutationObserver(sync).observe(estimate, { childList: true, characterData: true, subtree: true });
  sync();
  return true;
}
