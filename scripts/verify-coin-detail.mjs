import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Keypair } from '@solana/web3.js';
import { enrichMarketRecord, summarizeMarkets } from '../market-intelligence.js';
import { readPumpMarketActivity, summarizePumpTrades } from '../server/coin-market.mjs';
import { routerFeeActivity } from '../server/fee-activity.mjs';

const missingMarket = enrichMarketRecord({ address: 'devnet-mint', volume24hUsd: null, liquidityUsd: null, marketCapUsd: null, priceChange24hPercent: null });
assert.equal(missingMarket.volume24hUsd, null);
assert.equal(missingMarket.priceChange24hPercent, null);
assert.equal(missingMarket.marketCapUsd, null);
assert.equal(summarizeMarkets([missingMarket]).volume24hUsd, null);
assert.equal(summarizeMarkets([missingMarket]).liquidityUsd, null);
const trades = [
  { blockTime: 1200, order: 0, solLamports: 2_000_000_000n, priceRatio: 1.2 },
  { blockTime: 1100, order: 1, solLamports: 1_000_000_000n, priceRatio: 1.0 },
  { blockTime: 900, order: 2, solLamports: 500_000_000n, priceRatio: 0.9 },
];
const completeMarket = summarizePumpTrades(trades, { cutoffSeconds: 1000, complete: true });
assert.equal(completeMarket.volume24hSol, 3);
assert.equal(completeMarket.tradeCount24h, 2);
assert.equal(completeMarket.priceChangeBasis, '24h');
assert.ok(Math.abs(completeMarket.priceChangePercent - 33.33333333333333) < 0.0001);
const partialMarket = summarizePumpTrades(trades, { cutoffSeconds: 1000, complete: false });
assert.equal(partialMarket.coverage, 'partial');
assert.equal(partialMarket.priceChangePercent, null);
const newCoinMarket = summarizePumpTrades(trades.slice(0, 2), { cutoffSeconds: 1000, complete: true, sinceLaunch: true });
assert.equal(newCoinMarket.priceChangeBasis, 'since-first-trade');
const noCurveHistory = await readPumpMarketActivity({ connection: { getSignaturesForAddress: async () => [] }, mint: Keypair.generate().publicKey });
assert.equal(noCurveHistory.volume24hSol, null);
assert.equal(noCurveHistory.coverage, 'unavailable');

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
