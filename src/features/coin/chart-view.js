import { buildTradePricePath, selectObservedTradeWindow } from '../../../coin-detail-model.js';
import { escapeHtml, setCoinField as setField, formatCoinSpot } from '../shared/display.js';

// Presentation only: callers own state, requests, and transaction lifecycles.
export function renderCoinPricePath({ coinChartPeriod, coinChartMetric, coinChartUnit, coinMarketActivity, coinSolUsdValues, coinSolUsdPrice }, { formatCoinSnapshotUsd, document = globalThis.document } = {}){
  const setCoinField = (selector, value) => setField(selector, value, document);
  const panel = document.querySelector('#coin-price-path');
  if (!panel) return;
  document.querySelectorAll('[data-coin-chart-period]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.coinChartPeriod === coinChartPeriod)));
  document.querySelectorAll('[data-coin-chart-metric]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.coinChartMetric === coinChartMetric)));
  document.querySelectorAll('[data-coin-chart-unit]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.coinChartUnit === coinChartUnit)));
  const measure = coinChartMetric === 'price' ? 'Price' : 'Market cap';
  const unit = coinChartUnit.toUpperCase();
  setCoinField('#coin-chart-heading', `${document.querySelector('#coin-symbol')?.textContent?.trim() || 'Token'} · ${measure} in ${unit}`);
  if (coinMarketActivity.status === 'loading') {
    panel.innerHTML = '<div class="empty-state coin-activity-empty"><strong>Loading chart…</strong><small>Checking recent trades for this token.</small></div>';
    return;
  }
  if (coinMarketActivity.status === 'unavailable' || coinMarketActivity.status === 'summary-only') {
    panel.innerHTML = '<div class="empty-state coin-activity-empty"><strong>Chart unavailable</strong><small>Recent trade prices could not be loaded. Try refreshing the token page.</small></div>';
    return;
  }
  const observedTrades = selectObservedTradeWindow(coinMarketActivity.trades, coinChartPeriod);
  const path = buildTradePricePath(observedTrades, coinMarketActivity.decimals);
  if (path.count < 2) {
    panel.innerHTML = `<div class="empty-state coin-activity-empty"><strong>${path.count ? 'One recent price' : 'No recent prices'} · ${escapeHtml(coinChartPeriod)}</strong><small>${path.count ? 'At least two confirmed trades are needed to draw a chart.' : 'No confirmed trades were found in this time range.'}${coinMarketActivity.coverage !== 'complete' ? ' Some trade history may be missing.' : ''}</small></div>`;
    return;
  }
  const supply = coinSolUsdValues.supply;
  if ((coinChartMetric === 'mcap' && (!Number.isFinite(supply) || supply <= 0)) || (coinChartUnit === 'usd' && (!Number.isFinite(coinSolUsdPrice) || coinSolUsdPrice <= 0))) {
    panel.innerHTML = `<div class="empty-state"><strong>${escapeHtml(measure)} in ${escapeHtml(unit)} unavailable</strong><small>${coinChartMetric === 'mcap' && (!Number.isFinite(supply) || supply <= 0) ? 'A verified token supply is required.' : 'A current SOL/USD quote is required. Select SOL to view the on-chain price.'}</small></div>`;
    return;
  }
  const timeLabel = value => Number.isFinite(Number(value)) ? new Date(Number(value) * 1000).toLocaleString() : 'Time unavailable';
  const scale = coinChartMetric === 'mcap' ? supply : 1;
  const formatChartValue = value => coinChartUnit === 'usd' ? formatCoinSnapshotUsd(value * scale) : formatCoinSpot(value * scale);
  const label = coinChartMetric === 'mcap' ? 'Estimated market cap' : 'Estimated token price';
  const observations = path.points.map(point => `<circle cx="${point.x.toFixed(1)}" cy="${point.y.toFixed(1)}" r="2.6"/>`).join('');
  panel.innerHTML = `<div class="coin-price-path-head"><span>${label} · ${unit} · observed ${escapeHtml(coinChartPeriod)}</span><strong>${escapeHtml(formatChartValue(path.latest))}</strong></div><svg viewBox="0 0 600 190" role="img" aria-label="${label} in ${unit} from ${path.count} confirmed on-chain trade observations in the last ${coinChartPeriod}" preserveAspectRatio="none"><path class="coin-path-area" d="${path.area}"/><path class="coin-path-line" d="${path.line}"/><g class="coin-path-observations">${observations}</g><circle cx="${path.lastPoint.x.toFixed(1)}" cy="${path.lastPoint.y.toFixed(1)}" r="4"/></svg><div class="coin-price-path-range"><span>Low <b>${escapeHtml(formatChartValue(path.low))}</b></span><span>High <b>${escapeHtml(formatChartValue(path.high))}</b></span></div><div class="coin-price-path-times"><span>${escapeHtml(timeLabel(path.firstBlockTime))}</span><span>${escapeHtml(timeLabel(path.lastBlockTime))}</span></div>`;
}
