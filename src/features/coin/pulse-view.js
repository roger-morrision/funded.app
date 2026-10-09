import { setCoinField as setField, formatOnChainNumber } from '../shared/display.js';

// Presentation only: callers own state, requests, and transaction lifecycles.
export function renderCoinPulse({ coinMarketActivity, coinPulsePeriod }, { formatExploreUsd, document = globalThis.document } = {}){
  const setCoinField = (selector, value) => setField(selector, value, document);
  setCoinField('.coin-pulse-grid > div:nth-child(3) > span', coinMarketActivity.graduated ? 'Trade volume' : 'Curve volume');
  document.querySelectorAll('[data-coin-pulse-period]').forEach(button => {
    const active = button.dataset.coinPulsePeriod === coinPulsePeriod;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  const pulse = coinMarketActivity.activityWindows?.[coinPulsePeriod]
    || (coinPulsePeriod === '5m' && coinMarketActivity.status === 'ready' && Array.isArray(coinMarketActivity.trades)
      ? observedFiveMinutePulse(coinMarketActivity.trades) : null);
  const note = document.querySelector('#coin-pulse-note');
  const buyBar = document.querySelector('#coin-pulse-buy-bar');
  const sellBar = document.querySelector('#coin-pulse-sell-bar');
  if (!pulse) {
    const label = coinMarketActivity.status === 'loading' ? 'Loading…' : 'Unavailable';
    ['#coin-pulse-trades','#coin-pulse-traders','#coin-pulse-volume','#coin-pulse-buy-volume','#coin-pulse-sell-volume','#coin-pulse-largest'].forEach(selector => setCoinField(selector, label));
    setCoinField('#coin-pulse-buy-count', 'Buys —'); setCoinField('#coin-pulse-sell-count', 'Sells —');
    if (buyBar) buyBar.style.width = '0%'; if (sellBar) sellBar.style.width = '0%';
    if (note) {
      note.hidden = false;
      note.textContent = coinMarketActivity.status === 'loading' ? 'Loading confirmed trades…' : 'Trade totals for this time range are unavailable.';
    }
    return;
  }
  const partial = pulse.coverage === 'partial';
  const count = value => `${partial && value > 0 ? '≥' : ''}${formatOnChainNumber(value, 0)}`;
  const usd = value => formatExploreUsd(value, { partial: partial && Number(value) > 0 });
  setCoinField('#coin-pulse-trades', count(pulse.tradeCount));
  setCoinField('#coin-pulse-traders', count(pulse.traderCount));
  setCoinField('#coin-pulse-volume', usd(pulse.volumeSol));
  setCoinField('#coin-pulse-buy-volume', usd(pulse.buyVolumeSol));
  setCoinField('#coin-pulse-sell-volume', usd(pulse.sellVolumeSol));
  setCoinField('#coin-pulse-largest', usd(pulse.largestTradeSol));
  setCoinField('#coin-pulse-buy-count', `Buys ${count(pulse.buyCount)}`);
  setCoinField('#coin-pulse-sell-count', `Sells ${count(pulse.sellCount)}`);
  const volume = Number(pulse.buyVolumeSol) + Number(pulse.sellVolumeSol);
  if (buyBar) buyBar.style.width = `${volume > 0 ? Number(pulse.buyVolumeSol) / volume * 100 : 0}%`;
  if (sellBar) sellBar.style.width = `${volume > 0 ? Number(pulse.sellVolumeSol) / volume * 100 : 0}%`;
  if (note) {
    note.hidden = !partial;
    note.textContent = partial ? 'Some trade history is missing. Actual totals may be higher.' : '';
  }
}

function observedFiveMinutePulse(trades){
  const cutoff = Math.floor(Date.now() / 1000) - 5 * 60;
  const recent = trades.filter(item => Number(item.blockTime) >= cutoff);
  const buys = recent.filter(item => item.side === 'buy');
  const sells = recent.filter(item => item.side === 'sell');
  const volume = rows => rows.reduce((sum, item) => sum + Number(item.solLamports || 0) / 1_000_000_000, 0);
  return {
    tradeCount: recent.length, buyCount: buys.length, sellCount: sells.length,
    volumeSol: volume(recent), buyVolumeSol: volume(buys), sellVolumeSol: volume(sells),
    traderCount: new Set(recent.map(item => item.trader).filter(Boolean)).size,
    largestTradeSol: Math.max(0, ...recent.map(item => Number(item.solLamports || 0) / 1_000_000_000)),
    coverage: 'partial',
  };
}
