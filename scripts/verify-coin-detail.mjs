import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Keypair, PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddressSync, TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';
import { bondingCurvePda } from '@pump-fun/pump-sdk';
import { enrichMarketRecord, summarizeMarkets } from '../market-intelligence.js';
import { buildTradePricePath, selectRecentTrades, summarizeTokenAccounts, verifiedRegistryLaunch } from '../coin-detail-model.js';
import { readPumpMarketActivity, summarizePumpTrades } from '../server/coin-market.mjs';
import { routerFeeActivity } from '../server/fee-activity.mjs';

const appSource = await readFile(new URL('../app.js', import.meta.url), 'utf8');
assert.match(appSource, /holders: `Token accounts \$\{coinActivity\.accountAvailable/);
assert.match(appSource, /RPC token-account sample, not a unique holder count/);
assert.doesNotMatch(appSource, /Top holders \$\{coinActivity\.accountAvailable/);
const coinFormatterSource = appSource.match(/function formatCoinUsd\(solValue\)\{[^}]+\}/)?.[0];
assert.ok(coinFormatterSource, 'coin display formatter is present');
const coinFormatter = new Function('coinSolUsdPrice', 'formatUsd', 'formatCoinSpot', `${coinFormatterSource}; return formatCoinUsd;`);
assert.equal(coinFormatter(null, value => `$${value}`, value => `${value} SOL`)(0.5), '0.5 SOL');
assert.equal(coinFormatter(100, value => `$${value}`, value => `${value} SOL`)(0.5), '$50');
assert.equal(coinFormatter(null, value => `$${value}`, value => `${value} SOL`)(null), '$—');
assert.match(appSource, /Observed \$\{Number\.isFinite\(coinSolUsdPrice\) \? 'USD' : 'SOL'\} per token/);

const legacyVerifiedLaunch = { mint: 'verified-mint', cluster: 'devnet', onchainVerified: true, policySignature: 'signed-policy', name: 'Verified name', symbol: 'VERIFY' };
assert.equal(verifiedRegistryLaunch([legacyVerifiedLaunch], 'verified-mint', 'devnet'), legacyVerifiedLaunch, 'Verified legacy records do not require a metadata URI to retain their signed registry name.');
assert.equal(verifiedRegistryLaunch([{ ...legacyVerifiedLaunch, policySignature: '' }], 'verified-mint', 'devnet'), null);
assert.equal(verifiedRegistryLaunch([{ ...legacyVerifiedLaunch, onchainVerified: false }], 'verified-mint', 'devnet'), null);
assert.equal(verifiedRegistryLaunch([{ ...legacyVerifiedLaunch, cluster: 'mainnet-beta' }], 'verified-mint', 'devnet'), null);

const missingMarket = enrichMarketRecord({ address: 'devnet-mint', volume24hUsd: null, liquidityUsd: null, marketCapUsd: null, priceChange24hPercent: null });
assert.equal(missingMarket.volume24hUsd, null);
assert.equal(missingMarket.priceChange24hPercent, null);
assert.equal(missingMarket.marketCapUsd, null);
assert.equal(summarizeMarkets([missingMarket]).volume24hUsd, null);
assert.equal(summarizeMarkets([missingMarket]).liquidityUsd, null);
const trades = [
  { blockTime: 1200, order: 0, signature: 'confirmed-buy', trader: 'buyer-wallet', isBuy: true, solLamports: 2_000_000_000n, tokenAmountRaw: 3_000_000n, priceRatio: 1.2 },
  { blockTime: 1100, order: 1, signature: 'confirmed-sell', trader: 'seller-wallet', isBuy: false, solLamports: 1_000_000_000n, tokenAmountRaw: 2_000_000n, priceRatio: 1.0 },
  { blockTime: 900, order: 2, solLamports: 500_000_000n, priceRatio: 0.9 },
];
const completeMarket = summarizePumpTrades(trades, { cutoffSeconds: 1000, complete: true });
assert.equal(completeMarket.volume24hSol, 3);
assert.equal(completeMarket.buyVolume24hSol, 2);
assert.equal(completeMarket.sellVolume24hSol, 1);
assert.equal(completeMarket.tradeCount24h, 2);
assert.equal(completeMarket.buyCount24h, 1);
assert.equal(completeMarket.sellCount24h, 1);
assert.equal(completeMarket.activityWindows['24h'].tradeCount, 2);
assert.equal(completeMarket.activityWindows['24h'].traderCount, 2);
assert.equal(completeMarket.activityWindows['24h'].volumeSol, 3);
assert.equal(completeMarket.activityWindows['1h'].tradeCount, 0);
assert.deepEqual(completeMarket.recentTrades.map(item => [item.side, item.signature, item.solLamports, item.tokenAmountRaw]), [['buy', 'confirmed-buy', '2000000000', '3000000'], ['sell', 'confirmed-sell', '1000000000', '2000000']]);
assert.deepEqual(completeMarket.recentTrades.map(item => item.priceRatio), [1.2, 1]);
const pricePath = buildTradePricePath(completeMarket.recentTrades, 6);
assert.equal(pricePath.count, 2);
assert.ok(Math.abs(pricePath.low - 0.001) < 1e-12);
assert.ok(Math.abs(pricePath.latest - 0.0012) < 1e-12);
assert.equal(pricePath.line, 'M24.0 158.0 L576.0 42.0');
assert.equal(buildTradePricePath(completeMarket.recentTrades.slice(0, 1), 6).count, 1);
assert.equal(buildTradePricePath([{ priceRatio: 1, blockTime: 1 }, { priceRatio: 1, blockTime: 2 }], 6).line, 'M24.0 100.0 L576.0 100.0');
assert.deepEqual(selectRecentTrades(completeMarket.recentTrades, { side: 'sell', minSol: 0.5 }).map(item => item.trader), ['seller-wallet']);
assert.deepEqual(selectRecentTrades(completeMarket.recentTrades, { wallet: 'SELLER' }).map(item => item.side), ['sell']);
assert.deepEqual(selectRecentTrades(completeMarket.recentTrades, { wallet: 'BUYER', minSol: 2.1 }), []);
assert.equal(completeMarket.priceChangeBasis, '24h');
assert.ok(Math.abs(completeMarket.priceChangePercent - 33.33333333333333) < 0.0001);
const partialMarket = summarizePumpTrades(trades, { cutoffSeconds: 1000, complete: false });
assert.equal(partialMarket.coverage, 'partial');
assert.equal(partialMarket.activityWindows['6h'].coverage, 'partial');
assert.equal(partialMarket.priceChangePercent, null);
const pulseTrades = [
  { blockTime: 87000, isBuy: true, solLamports: 2_000_000_000n, trader: 'wallet-a' },
  { blockTime: 84000, isBuy: false, solLamports: 1_000_000_000n, trader: 'wallet-a' },
  { blockTime: 70000, isBuy: true, solLamports: 3_000_000_000n, trader: 'wallet-b' },
  { blockTime: 50000, isBuy: false, solLamports: 4_000_000_000n, trader: 'wallet-c' },
];
const pulse = summarizePumpTrades(pulseTrades, { cutoffSeconds: 1000, complete: true }).activityWindows;
assert.deepEqual([pulse['1h'].tradeCount, pulse['6h'].tradeCount, pulse['24h'].tradeCount], [2, 3, 4]);
assert.deepEqual([pulse['1h'].volumeSol, pulse['6h'].volumeSol, pulse['24h'].volumeSol], [3, 6, 10]);
assert.deepEqual([pulse['1h'].traderCount, pulse['6h'].traderCount, pulse['24h'].traderCount], [1, 2, 3]);
assert.deepEqual([pulse['1h'].largestTradeSol, pulse['6h'].largestTradeSol, pulse['24h'].largestTradeSol], [2, 3, 4]);
assert.deepEqual([pulse['1h'].buyCount, pulse['1h'].sellCount], [1, 1]);
const newCoinMarket = summarizePumpTrades(trades.slice(0, 2), { cutoffSeconds: 1000, complete: true, sinceLaunch: true });
assert.equal(newCoinMarket.priceChangeBasis, 'since-first-trade');
const noCurveHistory = await readPumpMarketActivity({ connection: { getSignaturesForAddress: async () => [] }, mint: Keypair.generate().publicKey });
assert.equal(noCurveHistory.volume24hSol, null);
assert.equal(noCurveHistory.buyVolume24hSol, null);
assert.equal(noCurveHistory.activityWindows, null);
assert.equal(noCurveHistory.coverage, 'unavailable');
const knownMint = new PublicKey('HJ4D7fKZkRepSnnD8i8SAJrPwWn7bewXbFjuv2mHMQbx');
const curveVault = getAssociatedTokenAddressSync(knownMint, bondingCurvePda(knownMint), true, TOKEN_2022_PROGRAM_ID).toBase58();
assert.equal(curveVault, '2YEJPpuMfFfZm51uedtd9KwN4n1ektzXHjMnKqcDH7yL');
const accountDistribution = summarizeTokenAccounts([
  { address: curveVault, share: 90 },
  { address: 'other-one', share: 6 },
  { address: 'other-two', share: 2 },
], curveVault);
assert.deepEqual(accountDistribution, { vaultAddress: curveVault, vaultShare: 90, otherCount: 2, otherShare: 8, largestOtherShare: 6, topTenOtherShare: 8, outsideSampleShare: 2 });
assert.equal(summarizeTokenAccounts([{ address: 'other-one', share: 6 }], curveVault), null);
assert.equal(summarizeTokenAccounts([], null), null);

const directory = await mkdtemp(join(tmpdir(), 'funded-coin-detail-'));
const mint = Keypair.generate().publicKey.toBase58();
const otherMint = Keypair.generate().publicKey.toBase58();
const claimSignature = 'recorded-claim-signature';
const fixture = {
  version: 3, launches: {}, obligations: {}, claims: {}, referralClaims: {}, payouts: {},
  collections: {
    [claimSignature]: { id: claimSignature, mint, signature: claimSignature, status: 'collected', attribution: 'mint-verified', cluster: 'devnet', collectedLamports: 250_000_000, recordedAt: '2026-09-19T01:00:00.000Z' },
    other: { id: 'other', mint: otherMint, signature: 'other', status: 'collected', attribution: 'mint-verified', cluster: 'devnet', collectedLamports: 500_000_000 },
    legacy: { id: 'legacy', mint, router: 'shared-router', signature: 'legacy', status: 'collected', cluster: 'devnet', collectedLamports: 100_000 },
    router: { id: 'router', mint: null, requestedMint: mint, router: 'shared-router', signature: 'router', status: 'collected', attribution: 'router', cluster: 'devnet', collectedLamports: 100_000 },
    zero: { id: 'zero', mint, signature: 'zero', status: 'collected', attribution: 'mint-verified', cluster: 'devnet', collectedLamports: 0 },
    pending: { id: 'pending', mint, signature: 'pending', status: 'pending', cluster: 'devnet' },
    wrongCluster: { id: 'wrongCluster', mint, signature: 'wrongCluster', status: 'collected', cluster: 'mainnet-beta' },
  },
  settlements: { [claimSignature]: { claimSignature, status: 'allocated', grossCreatorFees: 0.25, asset: 'SOL', claimedAt: '2026-09-19T01:01:00.000Z' } },
  referrals: { codes: {}, wallets: {}, attributions: {}, challenges: {} },
};
assert.deepEqual(routerFeeActivity(fixture.collections, 'shared-router', 'devnet').map(item => item.signature), ['legacy', 'router']);
const fixturePath = join(directory, 'store.json');
await writeFile(fixturePath, JSON.stringify(fixture));
const port = 18094;
const server = spawn(process.execPath, ['server/index.mjs'], { cwd: process.cwd(), env: { ...process.env, PORT: String(port), FUNDED_STORE_PATH: fixturePath, VITE_SOLANA_CLUSTER: 'devnet' }, stdio: 'ignore' });
const base = `http://127.0.0.1:${port}`;

async function request(path) {
  const response = await fetch(`${base}${path}`);
  return { status: response.status, data: await response.json() };
}

try {
  let ready = false;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try { if ((await request('/api/health')).status === 200) { ready = true; break; } } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.equal(ready, true, 'API did not start');
  const result = await request(`/api/tokens/${mint}/fee-activity`);
  assert.equal(result.status, 200);
  assert.equal(result.data.cluster, 'devnet');
  assert.equal(result.data.coverage, 'mint-verified-fee-claims-only');
  assert.equal(result.data.source, 'funded.app-file-ledger');
  assert.deepEqual(result.data.collections.map(item => item.signature), [claimSignature]);
  assert.equal(result.data.collections[0].collectedLamports, 250_000_000);
  assert.deepEqual(result.data.claims.map(item => item.claimSignature), [claimSignature]);
  assert.equal((await request(`/api/tokens/${otherMint}/fee-activity`)).data.collections.length, 1);
  assert.equal((await request('/api/tokens/invalid/fee-activity')).status, 400);
  assert.equal((await request('/api/tokens/invalid/market-activity')).status, 400);
  console.log('coin detail fee activity checks passed');
} finally {
  server.kill();
  await rm(directory, { recursive: true, force: true });
}
