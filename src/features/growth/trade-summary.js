// Trade panel: slippage presets and one plain sentence of what the wallet will sign.
import { el } from './format.js';

export function mountTradeSummary(document = globalThis.document) {
  const submit = document.getElementById('trade-submit');
  const slippage = document.getElementById('trade-slippage');
  if (!submit || !slippage || document.getElementById('trade-plain-summary')) return Boolean(submit);
  const presets = el(document, 'div', 'trade-slippage-presets'); presets.setAttribute('role', 'group'); presets.setAttribute('aria-label', 'Slippage presets');
  for (const value of ['0.5', '1', '3']) {
    const button = el(document, 'button', null, `${value}%`); button.type = 'button';
    button.addEventListener('click', () => {
      slippage.value = value;
      slippage.dispatchEvent(new Event('input', { bubbles: true })); slippage.dispatchEvent(new Event('change', { bubbles: true }));
      sync();
    });
    presets.append(button);
  }
  slippage.insertAdjacentElement('afterend', presets);
  const summary = el(document, 'p', 'trade-plain-summary'); summary.id = 'trade-plain-summary'; summary.setAttribute('aria-live', 'polite');
  submit.before(summary);
  const side = document.getElementById('trade-side'), amount = document.getElementById('trade-amount');
  const symbol = document.getElementById('trade-asset-symbol'), estimate = document.getElementById('trade-live-amount');
  function sync() {
    for (const button of presets.querySelectorAll('button')) button.setAttribute('aria-pressed', String(Number(button.textContent.replace('%', '')) === Number(slippage.value)));
    const value = Number(amount?.value);
    if (!Number.isFinite(value) || value <= 0) { summary.textContent = ''; summary.hidden = true; return; }
    const buying = side?.value !== 'sell', token = symbol?.textContent.trim() || 'tokens';
    const out = estimate?.textContent.trim() || '';
    const outText = /\d/.test(out) ? out : 'the quoted amount';
    summary.hidden = false;
    summary.textContent = buying
      ? `You send ${value} SOL and receive about ${outText}. Max slippage ${slippage.value}%. Your wallet shows the final transaction before you sign.`
      : `You sell ${value} ${token} and receive about ${outText}. Max slippage ${slippage.value}%. Your wallet shows the final transaction before you sign.`;
  }
  for (const node of [side, amount, slippage]) node?.addEventListener('input', sync);
  side?.addEventListener('change', sync);
  if (estimate) new MutationObserver(sync).observe(estimate, { childList: true, characterData: true, subtree: true });
  sync();
  return true;
}
