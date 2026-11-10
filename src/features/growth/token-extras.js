// Token page: a rewards strip (holder share + next payout), a holder-share calculator,
// The existing mobile navigation owns the Buy/Sell dialog controls.
import { savedFeeDistributionRows } from '../fees/saved-distribution-chart.js';
import { el, nextUtcHour, countdown } from './format.js';

export function holderPoolShare(tokens, supply) {
  const held = Number(tokens), total = Number(supply);
  if (!Number.isFinite(held) || !Number.isFinite(total) || held <= 0 || total <= 0) return null;
  return Math.min(100, held / total * 100);
}

export function mountTokenExtras(app, document = globalThis.document) {
  const coin = document.getElementById('coin-page');
  const column = coin?.querySelector('.coin-main-column');
  if (!coin || !column || document.getElementById('coin-rewards-strip')) return Boolean(coin);
  const strip = el(document, 'section', 'coin-rewards-strip'); strip.id = 'coin-rewards-strip'; strip.hidden = true;
  strip.setAttribute('aria-label', 'Holder rewards for this coin');
  column.prepend(strip);
  let state = null;

  function render() {
    if (!state) { strip.hidden = true; return; }
    const { holders, supply } = state;
    strip.hidden = false;
    const head = el(document, 'div', 'coin-rewards-head');
    if (holders > 0) {
      head.append(el(document, 'strong', null, `Holders share ${holders}% of this coin's creator fees`),
        el(document, 'span', null, `Paid automatically each UTC hour · next in ${countdown(nextUtcHour())}`));
    } else {
      head.append(el(document, 'strong', null, 'This coin does not share creator fees with holders'),
        el(document, 'span', null, 'Its creator kept the holder share at 0%.'));
    }
    const history = el(document, 'a', 'text-button', 'Payout history →'); history.href = '#payments/history';
    head.append(history);
    strip.replaceChildren(head);
    if (holders > 0 && supply > 0) {
      const calc = el(document, 'label', 'coin-rewards-calc');
      calc.append(el(document, 'span', null, 'If you hold'));
      const input = el(document, 'input'); input.type = 'number'; input.min = '0'; input.step = 'any'; input.inputMode = 'decimal';
      input.placeholder = 'tokens'; input.setAttribute('aria-label', 'Token amount you hold');
      const out = el(document, 'output', null, '— of each holder payout');
      input.addEventListener('input', () => {
        const share = holderPoolShare(input.value, supply);
        out.textContent = share == null ? '— of each holder payout'
          : `≈ ${share < 0.0001 ? '<0.0001' : share.toLocaleString(undefined, { maximumFractionDigits: 4 })}% of each holder payout`;
      });
      calc.append(input, out);
      strip.append(calc, el(document, 'small', 'field-help', 'Estimate by share of total supply. Payouts need a funded pool, verified holdings and minimums; excluded accounts (pools, vaults) raise the real share.'));
    }
  }

  globalThis.addEventListener?.('funded:coin-facts', event => {
    const { mint, parsedMint, launch, error } = event.detail || {};
    if (error || mint !== app.getCoinMintAddress?.()) { state = null; render(); return; }
    const rows = savedFeeDistributionRows(launch);
    const holders = rows?.find(row => row.key === 'holders')?.percent;
    const decimals = Number(parsedMint?.decimals), raw = Number(parsedMint?.supply);
    if (holders == null) { state = null; render(); return; }
    state = { holders, supply: Number.isFinite(raw) && Number.isFinite(decimals) ? raw / 10 ** decimals : 0 };
    render();
  });
  globalThis.addEventListener?.('funded:coin-facts-loading', () => { state = null; render(); });
  globalThis.setInterval?.(() => { if (state && !strip.hidden) render(); }, 60_000);

  return true;
}
