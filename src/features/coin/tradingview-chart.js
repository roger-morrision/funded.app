import { createChart, CandlestickSeries, HistogramSeries, CrosshairMode } from 'lightweight-charts';

const instances = new WeakMap();
const active = new Set();
if (typeof window !== 'undefined') {
  window.addEventListener('funded:route-change', () => {
    if (!document.body.classList.contains('page-route-coin')) for (const panel of active) disposeTradingViewChart(panel);
  });
  window.addEventListener('pagehide', () => { for (const panel of active) disposeTradingViewChart(panel); });
}

export function disposeTradingViewChart(panel) {
  const state = instances.get(panel);
  if (!state) return;
  state.chart.remove(); instances.delete(panel); active.delete(panel); panel.dataset.chartReady = 'false'; panel.dataset.chartCandles = '0';
}

export function renderTradingViewChart(panel, { key, candles, series = candles, volumes, formatValue, summary }) {
  let state = instances.get(panel);
  if (state && !panel.contains(state.host)) { disposeTradingViewChart(panel); state = null; }
  if (!state) {
    const host = panel.querySelector('.coin-tradingview-canvas');
    if (!host) return;
    const chart = createChart(host, {
      autoSize: true,
      layout: { background: { type: 'solid', color: '#0e1726' }, textColor: '#9fb0c7', fontFamily: 'Manrope, sans-serif', fontSize: 11, attributionLogo: true },
      grid: { vertLines: { color: '#202c3f' }, horzLines: { color: '#202c3f' } },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: '#344158', scaleMargins: { top: .12, bottom: .26 } },
      timeScale: { borderColor: '#344158', timeVisible: true, secondsVisible: false, rightOffset: 4, minBarSpacing: 2, shiftVisibleRangeOnNewBar: false },
      handleScroll: { mouseWheel: false, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
      handleScale: { axisPressedMouseMove: true, axisDoubleClickReset: true, mouseWheel: true, pinch: true },
      localization: { locale: 'en-US', timeFormatter: time => new Date(Number(time) * 1000).toLocaleString('en-GB', { timeZone: 'UTC', hour12: false }) },
    });
    const price = chart.addSeries(CandlestickSeries, { upColor: '#3baf82', downColor: '#e16c79', borderVisible: false, wickUpColor: '#3baf82', wickDownColor: '#e16c79' });
    const volume = chart.addSeries(HistogramSeries, { priceScaleId: 'volume', priceFormat: { type: 'volume' }, lastValueVisible: false, priceLineVisible: false });
    volume.priceScale().applyOptions({ scaleMargins: { top: .82, bottom: 0 } });
    state = { host, chart, price, volume, key: null, summary, formatValue, populated: false, range: null };
    chart.timeScale().subscribeVisibleTimeRangeChange(range => {
      const label = panel.querySelector('.coin-chart-window'); if (!label) return;
      const utc = time => new Date(Number(time) * 1000).toLocaleString('en-GB', { timeZone: 'UTC', hour12: false });
      label.textContent = range ? `Visible: ${utc(range.from)} – ${utc(range.to)} UTC` : 'No price range available';
    });
    chart.subscribeCrosshairMove(event => {
      const readout = panel.querySelector('.coin-chart-readout'); if (!readout) return;
      const point = event.seriesData.get(price);
      readout.textContent = point && 'open' in point
        ? `O ${state.formatValue(point.open)} · H ${state.formatValue(point.high)} · L ${state.formatValue(point.low)} · C ${state.formatValue(point.close)}` : state.summary;
    });
    instances.set(panel, state); active.add(panel);
    panel.querySelector('[data-chart-reset]').onclick = () => { const current = instances.get(panel); current?.chart.timeScale().fitContent(); current?.chart.priceScale('right').applyOptions({ autoScale: true }); };
  }
  state.summary = summary; state.formatValue = formatValue;
  const same = state.key === key;
  if (!same) { state.range = null; state.populated = false; }
  else if (state.populated) state.range = state.chart.timeScale().getVisibleLogicalRange() || state.range;
  const minimum = candles.length ? Math.min(...candles.map(candle => candle.low)) : 1;
  const base = 10 ** Math.max(0, Math.min(15, 4 - Math.floor(Math.log10(minimum))));
  state.price.applyOptions({ priceFormat: { type: 'custom', formatter: value => formatValue(value).replace(/\s+SOL$/, ''), minMove: 1 / base, base } });
  state.price.setData(series); state.volume.setData(volumes);
  if (!state.populated) { state.chart.timeScale().fitContent(); state.chart.priceScale('right').applyOptions({ autoScale: true }); }
  else if (candles.length && state.range) state.chart.timeScale().setVisibleLogicalRange(state.range);
  state.key = key; state.populated ||= candles.length > 0;
  panel.dataset.chartReady = 'true'; panel.dataset.chartCandles = String(candles.length);
}
