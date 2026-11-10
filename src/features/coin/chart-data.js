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

// Indexed OHLC candles (USD, from GeckoTerminal/Birdeye) for Mainnet tokens.
export const INDEXED_FRAMES = { '5m': '1m', '1h': '1m', '6h': '5m', '24h': '15m' };
const PERIOD_SECONDS = { '5m': 300, '1h': 3600, '6h': 21600, '24h': 86400 };
export function buildIndexedCandles(source, { period = '24h', metric = 'price', unit = 'sol', solUsdPrice, nowSeconds = Date.now() / 1000 } = {}) {
  const interval = { '1m': 60, '5m': 300, '15m': 900 }[INDEXED_FRAMES[period] || '15m'];
  const empty = { candles: [], series: [], volumes: [], count: 0, interval };
  if (metric === 'mcap' && !(source?.supply > 0)) return { ...empty, reason: 'Token supply is unavailable for market cap.' };
  if (unit === 'sol' && !(solUsdPrice > 0)) return { ...empty, reason: 'A current SOL/USD quote is required.' };
  const scale = (metric === 'mcap' ? source.supply : 1) / (unit === 'usd' ? 1 : solUsdPrice);
  const from = nowSeconds - (PERIOD_SECONDS[period] || 86400) * (period === '24h' ? 1 : 1);
  const rows = (source?.candles || []).filter(row => row.time >= from - interval);
  const candles = rows.map(row => ({ time: row.time, open: row.open * scale, high: row.high * scale, low: row.low * scale, close: row.close * scale }));
  const volumes = rows.filter(row => Number.isFinite(row.volume)).map(row => ({ time: row.time, value: row.volume / (unit === 'usd' ? 1 : solUsdPrice), color: row.close >= row.open ? '#3baf8270' : '#e16c7970' }));
  return { candles, series: candles, volumes, count: candles.length, interval, latest: candles.at(-1)?.close,
    low: candles.length ? Math.min(...candles.map(c => c.low)) : null, high: candles.length ? Math.max(...candles.map(c => c.high)) : null };
}
