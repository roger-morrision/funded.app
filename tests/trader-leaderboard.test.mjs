import test from 'node:test';
import assert from 'node:assert/strict';
import { rankObservedTraders } from '../market-intelligence.js';
import { renderLeaderboard } from '../src/features/leaderboard/board-view.js';

const nowSeconds = 1_800_000_000;
const alice = 'A'.repeat(44);
const bob = 'B'.repeat(44);
const signature = letter => letter.repeat(88);
const policy = mint => ({ mint, cluster: 'devnet', onchainVerified: true });
const trade = (trader, sig, solLamports, blockTime = nowSeconds - 30, side = 'buy') =>
  ({ trader, signature: signature(sig), solLamports: String(solLamports), blockTime, side });

test('ranks distinct observed wallet trades by SOL volume with transaction proof', () => {
  const result = rankObservedTraders([
    { address: 'mint-a', recentTrades: [trade(alice, 'C', 1_000_000_000), trade(bob, 'D', 2_000_000_000)] },
    { address: 'mint-b', recentTrades: [trade(alice, 'E', 2_000_000_000, nowSeconds - 10, 'sell'), trade(alice, 'E', 2_000_000_000, nowSeconds - 10, 'sell')] },
  ], [policy('mint-a'), policy('mint-b')], { nowSeconds });
  assert.equal(result.scannedTokens, 2);
  assert.deepEqual(result.traders.map(row => [row.wallet, row.tradeCount, row.volumeSol, row.tokenCount]),
    [[alice, 2, 3, 2], [bob, 1, 2, 1]]);
  assert.equal(result.traders[0].latestSignature, signature('E'));
  assert.deepEqual([result.traders[0].buyCount, result.traders[0].sellCount], [1, 1]);
});

test('excludes unverified mints, stale trades and malformed wallet or transaction data', () => {
  const result = rankObservedTraders([
    { address: 'mint-a', recentTrades: [
      trade(alice, 'C', 100, nowSeconds - 86401),
      trade('not-a-wallet', 'D', 100),
      trade(alice, 'E', 0),
      trade(alice, 'F', 100, nowSeconds + 61),
      trade(alice, 'G', 100),
    ] },
    { address: 'mint-b', recentTrades: [trade(bob, 'H', 1_000_000_000)] },
  ], [policy('mint-a'), { ...policy('mint-b'), onchainVerified: false }], { nowSeconds });
  assert.equal(result.scannedTokens, 1);
  assert.deepEqual(result.traders.map(row => row.wallet), [alice]);
  assert.equal(result.traders[0].tradeCount, 1);
});

test('trader tab shows ranked wallet proof and discloses the sample limit', () => {
  const nodes = new Map();
  const document = { querySelector(selector) {
    if (!nodes.has(selector)) nodes.set(selector, {
      textContent: '', innerHTML: '', dataset: {}, setAttribute(name, value) { this[name] = value; },
      closest() { return null; },
    });
    return nodes.get(selector);
  } };
  renderLeaderboard({ leaderboardView: 'traders', assets: [{ address: 'mint-a', recentTrades: [trade(alice, 'C', 1_000_000_000)] }],
    verifiedLaunchPolicies: [policy('mint-a')], verifiedLaunchPoliciesStatus: 'ready', exploreFeedAvailable: true, EXPLORE_CLUSTER: 'devnet' },
  { document, rankObservedTraders: (assets, policies) => rankObservedTraders(assets, policies, { nowSeconds }),
    exploreExplorer: path => `https://explorer.solana.com/${path}?cluster=devnet` });
  assert.match(nodes.get('#leaderboard-table').innerHTML, /1 buy · 0 sell/);
  assert.match(nodes.get('#leaderboard-table').innerHTML, /Trade ↗/);
  assert.match(nodes.get('#leaderboard-table').innerHTML, /cluster=devnet/);
  assert.match(nodes.get('#leaderboard-source-note').textContent, /up to 20 recent trades per token/);
  assert.equal(nodes.get('#leaderboard-panel')['aria-labelledby'], 'leaderboard-traders-tab');
});

test('trader tab distinguishes an unavailable feed from a scanned feed with no trades', () => {
  const render = available => {
    const nodes = new Map();
    const document = { querySelector(selector) {
      if (!nodes.has(selector)) nodes.set(selector, { textContent: '', innerHTML: '', dataset: {},
        setAttribute() {}, closest() { return null; } });
      return nodes.get(selector);
    } };
    renderLeaderboard({ leaderboardView: 'traders', assets: [{ address: 'mint-a', recentTrades: [] }],
      verifiedLaunchPolicies: [policy('mint-a')], verifiedLaunchPoliciesStatus: 'ready',
      exploreFeedAvailable: available, EXPLORE_CLUSTER: 'devnet' },
    { document, rankObservedTraders: (assets, policies) => rankObservedTraders(assets, policies, { nowSeconds }) });
    return nodes.get('#leaderboard-table').innerHTML;
  };
  assert.match(render(false), /Trader ranking unavailable/);
  assert.match(render(true), /No trades in this sample/);
});
