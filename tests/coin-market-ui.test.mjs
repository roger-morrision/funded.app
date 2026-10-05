import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

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
  assert.match(view.fields.get('#coin-volume-source'), /Partial curve \+ pool RPC scan/);
  assert.match(view.fields.get('#coin-description'), /Confirmed curve and pool trade observations from a partial RPC scan/);
  assert.doesNotMatch(view.fields.get('#coin-description'), /pool trades excluded/);
});

test('migrated token keeps the unavailable fallback without verified pool swaps', async () => {
  const view = await renderActivity({ cluster:'devnet', coverage:'complete', tradeCount24h:14, volume24hSol:8.7, recentTrades:[] });
  assert.equal(view.state().status, 'unavailable');
  assert.equal(view.fields.get('#coin-volume'), 'Pool activity unavailable');
  assert.equal(view.fields.get('#coin-trade-count'), 'Unavailable');
  assert.match(view.fields.get('#coin-volume-source'), /does not include PumpSwap swaps/);
});

test('migrated token distinguishes an RPC outage from zero pool swaps', async () => {
  const view = await renderActivity(null);
  assert.equal(view.state().status, 'unavailable');
  assert.match(view.fields.get('#coin-volume-source'), /unavailable from RPC/);
});
