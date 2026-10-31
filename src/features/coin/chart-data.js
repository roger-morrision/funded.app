import { selectObservedTradeWindow } from '../../../coin-detail-model.js';

const intervals = { '5m': 15, '1h': 60, '6h': 300, '24h': 900 };

// Candles describe the reported confirmed trades, not a complete OHLC feed.
// Never carry a previous close into a gap or invent an unobserved trade.
export function buildObservedCandles(trades, { decimals, period = '24h', metric = 'price', unit = 'sol', supply, solUsdPrice, nowSeconds = Date.now() / 1000 } = {}) {
  const interval = intervals[period] || intervals['24h'];
  const empty = { candles: [], series: [], volumes: [], count: 0, interval };
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) return { ...empty, reason: 'Token decimals could not be verified.' };
  if (metric === 'mcap' && (!Number.isFinite(supply) || supply <= 0)) return { ...empty, reason: 'A verified token supply is required.' };
  if (unit === 'usd' && (!Number.isFinite(solUsdPrice) || solUsdPrice <= 0)) return { ...empty, reason: 'A current SOL/USD quote is required. Select SOL to view the on-chain price.' };
  const multiplier = 10 ** decimals / 1e9 * (metric === 'mcap' ? supply : 1) * (unit === 'usd' ? solUsdPrice : 1);
  if (!Number.isFinite(multiplier) || multiplier <= 0) return { ...empty, reason: 'The selected price scale is unavailable.' };
  const seen = new Set();
  const observations = selectObservedTradeWindow(trades, period, nowSeconds).slice().reverse().flatMap(trade => {
    const time = Number(trade.blockTime), price = Number(trade.priceRatio) * multiplier;
    if (!Number.isFinite(time) || time <= 0 || !Number.isFinite(price) || price <= 0) return [];
    const key = trade.signature && [trade.signature, trade.route, trade.blockTime, trade.priceRatio, trade.solLamports, trade.tokenAmountRaw].join(':');
    if (key && seen.has(key)) return [];
    if (key) seen.add(key);
    const volume = /^\d+$/.test(String(trade.solLamports)) ? Number(trade.solLamports) / 1e9 : NaN;
    return [{ time: Math.floor(time), price, volume }];
  }).sort((a, b) => a.time - b.time);
  const buckets = new Map();
  for (const observation of observations) {
    const time = Math.floor(observation.time / interval) * interval;
    let candle = buckets.get(time);
    if (!candle) { candle = { time, open: observation.price, high: observation.price, low: observation.price, close: observation.price, volume: 0 }; buckets.set(time, candle); }
    candle.high = Math.max(candle.high, observation.price); candle.low = Math.min(candle.low, observation.price); candle.close = observation.price;
    candle.volume += observation.volume; // A missing amount makes this bucket's volume unavailable.
  }
  const candles = [], volumes = [];
  for (const { volume, ...candle } of buckets.values()) {
    candles.push(candle);
    if (Number.isFinite(volume) && volume >= 0) volumes.push({ time: candle.time, value: volume, color: candle.close >= candle.open ? '#3baf8270' : '#e16c7970' });
  }
  const byTime = new Map(candles.map(candle => [candle.time, candle])), series = [];
  if (candles.length) for (let time = candles[0].time; time <= candles.at(-1).time; time += interval) series.push(byTime.get(time) || { time });
  return { candles, series, volumes, count: observations.length, interval, latest: candles.at(-1)?.close,
    low: candles.length ? Math.min(...candles.map(candle => candle.low)) : null,
    high: candles.length ? Math.max(...candles.map(candle => candle.high)) : null };
}
