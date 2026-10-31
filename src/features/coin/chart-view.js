import { buildObservedCandles } from './chart-data.js';
import { escapeHtml, setCoinField as setField, formatCoinSpot } from '../shared/display.js';

const pending = new WeakMap();

// Presentation only: callers own data verification, requests and transactions.
export function renderCoinPricePath({ coinChartPeriod, coinChartMetric, coinChartUnit, coinMarketActivity, coinSolUsdValues, coinSolUsdPrice, coinMint = '' }, { formatCoinSnapshotUsd, document = globalThis.document } = {}) {
  const panel = document.querySelector('#coin-price-path'); if (!panel) return;
  for (const [attribute, value] of [['period', coinChartPeriod], ['metric', coinChartMetric], ['unit', coinChartUnit]]) {
    document.querySelectorAll(`[data-coin-chart-${attribute}]`).forEach(button => button.setAttribute('aria-pressed', String(button.dataset[`coinChart${attribute[0].toUpperCase()}${attribute.slice(1)}`] === value)));
  }
  const measure = coinChartMetric === 'price' ? 'Price' : 'Market cap', unit = coinChartUnit.toUpperCase();
  setField('#coin-chart-heading', `${document.querySelector('#coin-symbol')?.textContent?.trim() || 'Token'} · ${measure} in ${unit}`, document);
  const label = coinChartMetric === 'mcap' ? 'Estimated market cap' : 'Estimated token price';
  const data = buildObservedCandles(coinMarketActivity.trades, { decimals: coinMarketActivity.decimals, period: coinChartPeriod, metric: coinChartMetric, unit: coinChartUnit, supply: coinSolUsdValues?.supply, solUsdPrice: coinSolUsdPrice });
  let title = '', message = '';
  if (coinMarketActivity.status === 'loading') { title = 'Loading chart…'; message = 'Checking recent trades for this token.'; }
  else if (['unavailable', 'summary-only'].includes(coinMarketActivity.status)) { title = 'Chart unavailable'; message = 'Recent trade prices could not be loaded. Try refreshing the token page.'; }
  else if (data.reason) { title = `${measure} in ${unit} unavailable`; message = data.reason; }
  else if (!data.count) { title = `No recent prices · ${coinChartPeriod}`; message = `No confirmed trades were found in this time range.${coinMarketActivity.coverage !== 'complete' ? ' Some trade history may be missing.' : ''}`; }
  const plotted = title ? { candles: [], volumes: [] } : data;
  const formatValue = value => coinChartUnit === 'usd' ? formatCoinSnapshotUsd(value / coinSolUsdPrice)
    : value > 0 && value < 1e-12 ? `${value.toExponential(4)} SOL` : formatCoinSpot(value);
  const interval = data.interval < 60 ? `${data.interval}s` : `${data.interval / 60}m`;
  const summary = title || `${label} · ${unit} · ${formatValue(data.latest)}`;
  const status = `<strong>${escapeHtml(title)}</strong><small>${escapeHtml(message)}</small>`;
  const count = coinMarketActivity.status === 'ready' && !data.reason ? ` · ${data.count} reported trade${data.count === 1 ? '' : 's'}` : '';
  const note = `Observed ${interval} candles${count} · UTC. Volume in SOL. Gaps stay empty.${coinMarketActivity.coverage !== 'complete' ? ' Some trade history may be missing.' : ' Recent trades only; the full range may not be covered.'}`;
  if (!panel.querySelector?.('.coin-tradingview-canvas')) {
    panel.innerHTML = `<div class="coin-price-path-head"><span class="coin-chart-readout">${escapeHtml(summary)}</span><button type="button" data-chart-reset aria-label="Reset chart zoom">Reset view</button></div><div class="coin-tradingview-stage"><div class="coin-tradingview-canvas" role="img" aria-label="${escapeHtml(summary)}"></div><div class="coin-chart-status" role="status"${title ? '' : ' hidden'}>${status}</div></div><small class="coin-chart-window">No price range available</small><div class="coin-chart-evidence">${escapeHtml(note)}</div><small class="coin-chart-attribution"><a href="https://www.tradingview.com/" target="_blank" rel="noopener noreferrer">TradingView Lightweight Charts™</a> · Copyright (с) 2025 TradingView, Inc. · <a href="/licenses/tradingview-lightweight-charts.txt" target="_blank" rel="noopener noreferrer">License</a></small>`;
  } else {
    panel.querySelector('.coin-chart-readout').textContent = summary;
    const overlay = panel.querySelector('.coin-chart-status'); overlay.hidden = !title; overlay.innerHTML = status;
    panel.querySelector('.coin-chart-evidence').textContent = note;
    panel.querySelector('.coin-tradingview-canvas').setAttribute('aria-label', summary);
  }
  if (!panel.isConnected) return;
  const version = {}; pending.set(panel, version);
  import('./tradingview-chart.js').then(({ renderTradingViewChart, disposeTradingViewChart }) => {
    if (pending.get(panel) !== version || !panel.isConnected) return;
    if (panel.closest('#coin-page')?.hidden) { disposeTradingViewChart(panel); return; }
    try { renderTradingViewChart(panel, { key: [coinMint, coinChartPeriod, coinChartMetric, coinChartUnit].join(':'), ...plotted, formatValue, summary }); }
    catch (error) { disposeTradingViewChart(panel); throw error; }
  }).catch(error => {
    if (pending.get(panel) !== version || !panel.isConnected) return;
    console.warn('Token chart unavailable:', error?.message || 'Chart initialization failed');
    const overlay = panel.querySelector('.coin-chart-status');
    if (overlay) { overlay.hidden = false; overlay.innerHTML = '<strong>Chart unavailable</strong><small>The chart could not be loaded. Refresh the token page to retry.</small>'; }
    panel.dataset.chartReady = 'false';
  });
}
