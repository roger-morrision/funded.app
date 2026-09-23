import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PublicKey } from '@solana/web3.js';

const mint = String(process.argv[2] || '').trim();
assert.doesNotThrow(() => new PublicKey(mint), 'Pass a valid Devnet mint for the isolated countdown fixture.');
const port = Number(process.env.COUNTDOWN_FIXTURE_PORT || 8791);
assert.ok(Number.isInteger(port) && port > 1024 && port < 65536, 'COUNTDOWN_FIXTURE_PORT must be a non-privileged port.');
const cutoffDelaySeconds = Number(process.env.COUNTDOWN_CUTOFF_DELAY_SECONDS || 12);
const payoutDelaySeconds = Number(process.env.COUNTDOWN_PAYOUT_DELAY_SECONDS || 10);
assert.ok(Number.isInteger(cutoffDelaySeconds) && cutoffDelaySeconds > 0, 'COUNTDOWN_CUTOFF_DELAY_SECONDS must be a positive integer.');
assert.ok(Number.isInteger(payoutDelaySeconds) && payoutDelaySeconds > 0, 'COUNTDOWN_PAYOUT_DELAY_SECONDS must be a positive integer.');

const directory = await mkdtemp(join(tmpdir(), 'funded-countdown-fixture-'));
const storePath = join(directory, 'funded-store.json');
const rewardStorePath = join(directory, 'automatic-rewards.json');
const now = Math.floor(Date.now() / 1000);
const cutoffAt = now + cutoffDelaySeconds;
const payoutAt = cutoffAt + payoutDelaySeconds;
const id = `${mint}:${now}:holder:SOL`;

await writeFile(storePath, JSON.stringify({
  version: 3,
  launches: {}, settlements: {}, obligations: {}, claims: {}, referralClaims: {}, payouts: {}, collections: {},
  launchReviews: {}, alerts: {}, xIntake: {}, marketActivity: {}, coinChats: {},
  referrals: { codes: {}, wallets: {}, attributions: {}, challenges: {} },
  creatorProfiles: {},
}));
await writeFile(rewardStorePath, JSON.stringify({
  version: 2,
  obligations: {}, batches: {}, programs: {}, holderSnapshots: {}, rewardPools: {}, buyOrders: {}, fundingRequests: {},
  schedules: { [id]: { id, mint, asset: 'SOL', kind: 'holder', periodStart: now - 86_388, cutoffAt, payoutAt, status: 'indexing', payments: {} } },
  serviceStatus: { constrainedPayouts: true, reasons: [], reason: null, checkedAt: new Date().toISOString() },
}));

Object.assign(process.env, {
  NODE_ENV: 'test',
  HOST: '127.0.0.1',
  PORT: String(port),
  DATABASE_URL: '',
  FUNDED_STORE_PATH: storePath,
  AUTOMATIC_REWARD_STORE_PATH: rewardStorePath,
  FUNDED_BUILD_ID: 'countdown-fixture-local-only',
  SOLANA_KEEPER_CONFIGURED: 'false',
  SOLANA_ALLOW_KEEPER_TRANSFER: 'false',
  DEVNET_TEST_MODE: 'false',
});

const cleanup = async () => { await rm(directory, { recursive: true, force: true }); };
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await cleanup(); process.exit(0); });
process.once('exit', () => { void cleanup(); });

console.log(JSON.stringify({ status: 'local-only-fixture', url: `http://127.0.0.1:${port}/token/${mint}`, cutoffAt: new Date(cutoffAt * 1000).toISOString(), payoutAt: new Date(payoutAt * 1000).toISOString() }));
await import('../server/index.mjs');
