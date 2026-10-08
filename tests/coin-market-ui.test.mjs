import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildTradePricePath, selectObservedTradeWindow } from '../coin-detail-model.js';

const appSource = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const loaderSource = appSource.match(/async function loadCoinMarketActivity\(mintAddress, loadId, decimals, graduated\)\{[\s\S]*?\n\}/)?.[0];
assert.ok(loaderSource, 'Token activity loader must exist.');

async function renderActivity(market) {
  const createHarness = new Function('market', `
    const fields = new Map();
    const EXPLORE_CLUSTER = 'devnet';
    let coinLoadId = 1;
    let coinMarketActivity = {};
    let coinSolUsdPrice = 100;
    const coinSolUsdValues = { marketCap:1, reserve:1 };
    const apiRequest = async () => ({ available:true, data:market });
    const setCoinField = (selector, value) => fields.set(selector, value);
    const formatCoinUsd = value => '$' + (Number(value) * 100).toFixed(2);
    const renderCoinSummary = () => {};
    const renderCoinPricePath = () => {};
    const renderCoinFlow = () => {};
    const renderCoinPulse = () => {};
    const setCoinTabLabels = () => {};
    const renderCoinActivityTab = () => {};
    const setCoinChartView = () => {};
    const renderCoinSnapshotUsd = () => {};
    ${loaderSource}
    return { run:() => loadCoinMarketActivity('5D6NrzqP94RdCjnyJan44AGxJF1fANjkVWDa6G4HtTBC', 1, 6, true),
      fields, state:() => coinMarketActivity };
  `);
  const harness = createHarness(market);
  await harness.run();
  return harness;
}

test('migrated token renders verified pool swaps and marks partial coverage', async () => {
  const market = {
    cluster:'devnet', coverage:'partial', poolTradeCount24h:2,
    tradeCount24h:3, buyCount24h:1, sellCount24h:2,
    volume24hSol:0.503913943, buyVolume24hSol:0.009499999, sellVolume24hSol:0.494413944,
    recentTrades:[{ signature:'pool-sell', route:'pool' }, { signature:'pool-buy', route:'pool' }, { signature:'curve-sell', route:'curve' }],
    activityWindows:{}, priceChangePercent:null,
  };
  const view = await renderActivity(market);
  assert.equal(view.state().graduated, true);
  assert.equal(view.state().poolTradeCount24h, 2);
  assert.equal(view.fields.get('#coin-trade-count'), '≥3');
  assert.equal(view.fields.get('#coin-volume'), '≥$50.39 · partial');
  assert.match(view.fields.get('#coin-volume-source'), /Some launch and pool trade history is missing · totals may be higher/);
  assert.match(view.fields.get('#coin-description'), /Recent trades are shown below, though some history may be missing/);
  assert.doesNotMatch(view.fields.get('#coin-description'), /pool trades excluded/);
});

test('migrated token keeps the unavailable fallback without verified pool swaps', async () => {
  const view = await renderActivity({ cluster:'devnet', coverage:'complete', tradeCount24h:14, volume24hSol:8.7, recentTrades:[] });
  assert.equal(view.state().status, 'unavailable');
  assert.equal(view.fields.get('#coin-volume'), 'Pool activity unavailable');
  assert.equal(view.fields.get('#coin-trade-count'), 'Unavailable');
  assert.match(view.fields.get('#coin-volume-source'), /PumpSwap trades are missing from the available history/);
});

test('migrated token distinguishes an RPC outage from zero pool swaps', async () => {
  const view = await renderActivity(null);
  assert.equal(view.state().status, 'unavailable');
  assert.match(view.fields.get('#coin-volume-source'), /trade history is unavailable right now/);
});

test('complete pool history with no recent swaps displays zero activity', async () => {
  const view = await renderActivity({ cluster:'devnet', coverage:'complete', poolHistoryCoverage:'complete',
    poolTradeCount24h:0, tradeCount24h:0, volume24hSol:0, buyVolume24hSol:0, sellVolume24hSol:0,
    buyCount24h:0, sellCount24h:0, recentTrades:[] });
  assert.equal(view.state().status, 'ready');
  assert.equal(view.state().graduated, true);
  assert.equal(view.fields.get('#coin-trade-count'), '0');
  assert.equal(view.fields.get('#coin-volume'), 'No trades');
  assert.equal(view.fields.get('#coin-change'), 'No 24h trades');
  assert.match(view.fields.get('#coin-description'), /No trades in the last 24 hours/);
});

test('zero pool trades do not imply a complete history when evidence is missing or partial', async () => {
  for (const poolHistoryCoverage of [undefined, 'partial', 'unavailable']) {
    const view = await renderActivity({ cluster:'devnet', coverage:'complete', poolHistoryCoverage,
      poolTradeCount24h:0, tradeCount24h:0, volume24hSol:0, recentTrades:[] });
    assert.equal(view.state().status, 'unavailable');
    assert.equal(view.fields.get('#coin-trade-count'), 'Unavailable');
  }
  const missingVolume = await renderActivity({ cluster:'devnet', coverage:'complete', poolHistoryCoverage:'complete',
    poolTradeCount24h:0, tradeCount24h:0, volume24hSol:null, recentTrades:[] });
  assert.equal(missingVolume.state().status, 'unavailable');
});

test('chart separates loading and unavailable prices from a confirmed empty history', () => {
  const chartSource = appSource.match(/function renderCoinPricePath\(\)\{[\s\S]*?\n\}/)?.[0];
  assert.ok(chartSource);
  const render = new Function('coinMarketActivity', 'buildTradePricePath', 'selectObservedTradeWindow', `
    const panel = { innerHTML:'' };
    const document = { querySelector:selector => selector === '#coin-price-path' ? panel : null, querySelectorAll:() => [] };
    const coinChartPeriod = '24h', coinChartMetric = 'mcap', coinChartUnit = 'usd';
    const setCoinField = () => {}, escapeHtml = value => value;
    ${chartSource}
    renderCoinPricePath();
    return panel.innerHTML;
  `);
  const view = (status, coverage = null) => render({ status, coverage, trades:[], decimals:6 }, buildTradePricePath, selectObservedTradeWindow);
  assert.match(view('loading'), /Loading chart/);
  for (const status of ['unavailable', 'summary-only']) {
    assert.match(view(status), /Chart unavailable/);
    assert.doesNotMatch(view(status), /No recent prices|No confirmed trades were found/);
  }
  assert.match(view('ready', 'complete'), /No confirmed trades were found/);
  assert.doesNotMatch(view('ready', 'complete'), /history may be missing/);
  assert.match(view('ready', 'partial'), /history may be missing/);
});
