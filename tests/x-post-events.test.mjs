import assert from 'node:assert/strict';
import test from 'node:test';
import bs58 from 'bs58';
import nacl from 'tweetnacl';
import { createXProfitVerifier, xProfitConsentStatement } from '../server/x-profit-proof.mjs';
import { createHash } from 'node:crypto';
import { rewardAddresses } from '../server/automatic-reward-chain.mjs';
import { buildRewardManifest } from '../reward-merkle.js';
import { Keypair, PublicKey } from '@solana/web3.js';
import { collectXPostEvents, createXPostChainAdapters } from '../server/x-post-events.mjs';
import { buildXPost } from '../server/x-post-content.mjs';
const mint = Keypair.fromSeed(new Uint8Array(32).fill(1)).publicKey.toBase58();
const wallet = Keypair.fromSeed(new Uint8Array(32).fill(2)).publicKey.toBase58();
const router = Keypair.fromSeed(new Uint8Array(32).fill(3)).publicKey.toBase58();
const signature = bs58.encode(new Uint8Array(64).fill(1)), otherSignature = bs58.encode(new Uint8Array(64).fill(2));
const enabledAt = '2026-10-04T00:00:00Z', occurredAt = '2026-10-04T01:00:00Z', now = '2026-10-04T02:00:00Z';
const proof = (sig = signature) => ({ signature: sig, slot: 123, cluster: 'devnet', commitment: 'finalized', verified: true });
const launch = { mint, signature, cluster: 'devnet', onchainVerified: true, createdTimestamp: Date.parse(occurredAt) / 1000,
  creatorLaunchBurn: { tier: 'pro', status: 'verified', amountTokens: 100, receipt: { signature, verified: true, atomicWithPumpLaunch: true } } };
const verifiedLaunch = async row => ({ mint: row.mint, name: 'Example', symbol: 'EX', marketingTier: row.creatorLaunchBurn?.tier || 'standard', occurredAt, proofs: [proof(row.signature)] });

test('all launch tiers get an announcement, and only Premier gets a follow-up after publication', async () => {
  const pro = launch;
  const premier = { ...launch, mint: router, signature: otherSignature,
    creatorLaunchBurn: { ...launch.creatorLaunchBurn, tier: 'premier', receipt: { ...launch.creatorLaunchBurn.receipt, signature: otherSignature } } };
  const standard = { ...launch, mint: wallet, creatorLaunchBurn: null };
  const state = { launches: [pro, premier, standard] };
  const initial = await collectXPostEvents({ state, enabledAt, now, adapters: { verifyLaunch: verifiedLaunch, isPostedEvent: async () => false } });
  assert.deepEqual(initial.events.map(event => event.kind), ['launch', 'launch', 'launch']);
  assert.deepEqual(initial.events.map(event => event.payload.marketingTier).sort(), ['premier', 'pro', 'standard']);
  const later = '2026-10-05T02:00:00Z';
  const waiting = await collectXPostEvents({ state, enabledAt, now: later, cursor: initial.cursor,
    adapters: { verifyLaunch: verifiedLaunch, isPostedEvent: async () => false } });
  assert.equal(waiting.events.length, 0);
  assert.equal(waiting.cursor.streams.launch_followup.pending.length, 1);
  const postedIds = new Set(initial.events.map(event => event.id));
  const ready = await collectXPostEvents({ state, enabledAt, now: later, cursor: waiting.cursor,
    adapters: { verifyLaunch: verifiedLaunch, isPostedEvent: async id => postedIds.has(id) } });
  assert.deepEqual(ready.events.map(event => event.kind), ['launch_followup']);
  assert.equal(ready.events[0].payload.marketingTier, 'premier');
  assert.notEqual(ready.events[0].id, initial.events.find(event => event.payload.marketingTier === 'premier').id);
  assert.equal((await collectXPostEvents({ state, enabledAt, now: later, cursor: ready.cursor,
    adapters: { verifyLaunch: verifiedLaunch, isPostedEvent: async () => true } })).events.length, 0);
});

test('activation excludes older verified projects and malformed paid tiers', async () => {
  const standard = { ...launch, creatorLaunchBurn: null };
  const old = { ...standard, mint: router, createdTimestamp: Date.parse('2026-10-03T23:00:00Z') / 1000 };
  const malformed = { ...launch, mint: wallet, creatorLaunchBurn: { tier: 'pro', status: 'pending', amountTokens: 100 } };
  const result = await collectXPostEvents({ state: { launches: [standard, old, malformed] }, enabledAt, now,
    adapters: { verifyLaunch: verifiedLaunch } });
  assert.deepEqual(result.events.map(event => event.payload.marketingTier), ['standard']);
});

test('launch events require a separate finalized proof and skip historical announcements', async () => {
  const state = { launches: { [mint]: launch } };
  assert.equal((await collectXPostEvents({ state, enabledAt, now })).events.length, 0);
  const confirmed = await collectXPostEvents({ state, enabledAt, now, adapters: { verifyLaunch: async row => ({ ...await verifiedLaunch(row), proofs: [{ ...proof(), commitment: 'confirmed' }] }) } });
  assert.equal(confirmed.events.length, 0);
  assert.equal(confirmed.cursor.streams.launch.pending.length, 1);
  const old = await collectXPostEvents({ state: { launches: { [mint]: { ...launch, createdTimestamp: Date.parse('2026-10-03') / 1000 } } }, enabledAt, now, adapters: { verifyLaunch: verifiedLaunch } });
  assert.equal(old.events.length, 0);
});

test('collector retries unfinalized sources without losing highwater and uses deterministic event identities', async () => {
  const input = { state: { launches: { [mint]: launch } }, enabledAt, now };
  const pending = await collectXPostEvents({ ...input, adapters: { verifyLaunch: async () => { throw new Error('RPC unavailable with secret endpoint'); } } });
  assert.equal(JSON.stringify(pending).includes('secret endpoint'), false);
  const result = await collectXPostEvents({ ...input, cursor: pending.cursor, adapters: { verifyLaunch: verifiedLaunch } });
  assert.equal(result.events.length, 1);
  assert.equal(result.cursor.streams.launch.pending.length, 0);
  const repeated = await collectXPostEvents({ ...input, adapters: { verifyLaunch: async row => ({ ...await verifiedLaunch(row), proofs: [{ ...proof(), verifiedAt: 'changed clock', transaction: {} }] }) } });
  assert.deepEqual(repeated.events, result.events);
  const committed = await collectXPostEvents({ ...input, cursor: result.cursor, adapters: { verifyLaunch: async () => assert.fail('Previously committed event must not reverify') } });
  assert.equal(committed.events.length, 0);
  assert.equal(buildXPost('launch', result.events[0].payload, { cluster: 'devnet' }).kind, 'launch');
});

test('bounded scans retain unprocessed rows and never change activation baseline silently', async () => {
  const secondMint = Keypair.fromSeed(new Uint8Array(32).fill(4)).publicKey.toBase58();
  const state = { launches: { one: launch, two: { ...launch, mint: secondMint, signature: otherSignature, createdTimestamp: launch.createdTimestamp + 1 } } };
  const first = await collectXPostEvents({ state, enabledAt, now, maxBatch: 1, adapters: { verifyLaunch: verifiedLaunch } });
  const second = await collectXPostEvents({ state, enabledAt, now, maxBatch: 1, cursor: first.cursor, adapters: { verifyLaunch: verifiedLaunch } });
  assert.equal(first.events.length, 1); assert.equal(second.events.length, 1);
  assert.notEqual(first.events[0].id, second.events[0].id);
  await assert.rejects(collectXPostEvents({ state, enabledAt: '2026-10-03', now, cursor: first.cursor }), /activation baseline differs/);
});

test('known outbox events are skipped without invoking verification again', async () => {
  const result = await collectXPostEvents({ state: { listings: { [mint]: { mint, signature, cluster: 'devnet', onchainVerified: true, status: 'listed', listedAt: occurredAt } } }, enabledAt, now,
    adapters: { isKnownEvent: async () => true, verifyListing: async () => assert.fail('Already queued') } });
  assert.equal(result.events.length, 0);
});

test('daily summaries require one complete exact interval, recipient-bound SOL receipts and no activation backlog', async () => {
  const makeDaily = async ({ windowStart, windowEnd }) => ({ cluster: 'devnet', windowStart, windowEnd, coverage: 'complete', scope: 'recorded-verified-payouts', proofs: [proof()], payments: [{ id: 'pay-1', signature, recipient: wallet, asset: 'SOL', amountLamports: '17', status: 'paid', finalized: true, balanceDeltaVerified: true }] });
  const options = { enabledAt: '2026-10-01', now: '2026-10-04T02:00:00Z', adapters: { verifiedDailyRewards: makeDaily } };
  const result = await collectXPostEvents(options);
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].kind, 'daily_rewards');
  assert.equal(result.events[0].payload.windowStart, '2026-10-03T00:00:00.000Z');
  assert.equal(result.events[0].payload.payments[0].recipient, wallet);
  assert.match(buildXPost('daily_rewards', result.events[0].payload, { cluster: 'devnet' }).text, /0.000000017/);
  assert.equal((await collectXPostEvents({ ...options, cursor: result.cursor })).events.length, 0);
  assert.equal((await collectXPostEvents({ ...options, enabledAt: '2026-10-03T12:00:00Z' })).events.length, 0);
  for (const alteration of [{ coverage: 'partial' }, { windowStart: '2026-10-02T00:00:00Z' }, { payments: [{ id: 'pay', signature, recipient: wallet, asset: mint, amountLamports: '99', status: 'paid', finalized: true, balanceDeltaVerified: true }] }]) {
    const blocked = await collectXPostEvents({ ...options, adapters: { verifiedDailyRewards: async input => ({ ...await makeDaily(input), ...alteration }) } });
    assert.equal(blocked.events.length, 0);
  }
});

test('trade outcomes cannot become profit posts without opt-in and complete attributable cost basis', async () => {
  const row = { wallet, mint, buySignature: signature, sellSignature: otherSignature, cluster: 'devnet', publicConsent: true, consentVerified: true, consentedAt: occurredAt };
  const verification = { wallet, mint, name: 'Example', occurredAt, publicConsent: true, completeCostBasis: true, positionClosed: true, buyCostLamports: '1000000000', sellProceedsLamports: '2200000000', feesLamports: '10000', proofs: [proof(), proof(otherSignature)] };
  const input = { state: { xPublicTradeShares: { test: row } }, enabledAt, now, adapters: { verifyPublicClosedTrade: async () => verification } };
  assert.equal((await collectXPostEvents(input)).events[0].kind, 'trade_profit');
  assert.equal((await collectXPostEvents({ ...input, state: { xPublicTradeShares: { test: { ...row, consentVerified: false } } } })).events.length, 0);
  assert.equal((await collectXPostEvents({ ...input, adapters: { verifyPublicClosedTrade: async () => ({ ...verification, completeCostBasis: false }) } })).events.length, 0);
});

function referralFixture() {
  const collectionSignature = otherSignature, amountLamports = '10000000';
  const payout = { id: 'referral:claim', claimId: 'claim', signature, source: 'solana-keeper-referral-claim', status: 'paid', cluster: 'devnet', from: router, to: wallet, amountSol: 0.01 };
  const collection = { signature: collectionSignature, mint, router, status: 'collected', attribution: 'mint-verified', onchainVerified: true, cluster: 'devnet', collectedLamports: 1000000000 };
  const state = { launches: { [mint]: { mint, name: 'Example' } }, payouts: { [payout.id]: payout }, collections: { [collectionSignature]: collection },
    referralClaims: { claim: { id: 'claim', status: 'paid', asset: 'SOL', recipientWallet: wallet, publicKey: wallet, payoutSignature: signature, amount: 0.01, settlementSignature: collectionSignature, level: 1 } },
    settlements: { [collectionSignature]: { fundedApp: { referralLevels: [{ level: 1, recipient: wallet, amount: 0.01 }] } } } };
  const transaction = (sig, keys, preBalances, postBalances) => ({ slot: 123, blockTime: Date.parse('2026-10-03T12:00:00Z') / 1000, transaction: { signatures: [sig], message: { accountKeys: keys } }, meta: { err: null, preBalances, postBalances } });
  const txs = { [signature]: transaction(signature, [router, wallet], [20000000, 0], [9995000, 10000000]), [collectionSignature]: transaction(collectionSignature, [router], [0], [1000000000]) };
  const reads = [];
  const connection = { getGenesisHash: async () => 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG', getTransaction: async (sig, options) => { assert.equal(options.commitment, 'finalized'); reads.push(sig); return txs[sig]; } };
  return { state, connection, reads, amountLamports, txs };
}

test('default daily adapters reverify full recorded payout and collection entitlement, and rank exact paid SOL', async () => {
  const { state, connection } = referralFixture();
  const adapters = createXPostChainAdapters({ connection });
  const result = await collectXPostEvents({ state, rewardState: { schedules: {} }, enabledAt: '2026-10-01', now, adapters });
  const rewards = result.events.find(row => row.kind === 'daily_rewards');
  const projects = result.events.find(row => row.kind === 'daily_projects');
  assert.equal(rewards.payload.payments[0].amountLamports, '10000000');
  assert.equal(rewards.payload.payments[0].recipient, wallet);
  assert.equal(projects.payload.metric, 'paid_rewards_lamports');
  assert.equal(projects.payload.projects[0].amountLamports, '10000000');
  assert.match(buildXPost('daily_projects', projects.payload, { cluster: 'devnet' }).text, /verified rewards paid/);
});

test('default daily adapters fail closed on missing ledgers, changed entitlements, wrong network and bounded overflow', async () => {
  const fixture = referralFixture(), input = { state: fixture.state, rewardState: { schedules: {} }, cluster: 'devnet', windowStart: '2026-10-03T00:00:00Z', windowEnd: '2026-10-04T00:00:00Z' };
  const adapters = createXPostChainAdapters({ connection: fixture.connection });
  await assert.rejects(adapters.verifiedDailyRewards({ ...input, rewardState: null }), /complete automatic reward ledger/);
  fixture.state.referralClaims.claim.amount = 0.02;
  await assert.rejects(adapters.verifiedDailyRewards(input), /original referral entitlement/);
  const wrong = createXPostChainAdapters({ connection: { getGenesisHash: async () => 'mainnet', getTransaction: async () => assert.fail('Wrong-network read') } });
  await assert.rejects(wrong.verifiedDailyRewards(input), /requires Devnet/);
  const bounded = createXPostChainAdapters({ connection: fixture.connection, maxDailyRecords: 1 });
  fixture.state.payouts.duplicate = { ...fixture.state.payouts['referral:claim'], id: 'other' };
  await assert.rejects(bounded.verifiedDailyRewards(input), /record budget/);
});

function scheduledFixture(recipient = wallet) {
  const programId = Keypair.fromSeed(new Uint8Array(32).fill(5)).publicKey.toBase58();
  const manifest = buildRewardManifest({ cycleId: '01'.repeat(32), asset: 'SOL', allocations: [{ recipient, amount: '10000000' }] });
  const addresses = rewardAddresses({ programId, authority: router, mint, cycleId: manifest.cycleId, recipient });
  const blockTime = Date.parse('2026-10-03T12:00:00Z') / 1000;
  const cycleData = Buffer.alloc(173), paymentData = Buffer.alloc(92);
  createHash('sha256').update('account:RewardCycle').digest().copy(cycleData, 0, 0, 8);
  addresses.vault.toBuffer().copy(cycleData, 8); Buffer.from(manifest.cycleId, 'hex').copy(cycleData, 40);
  Buffer.from(manifest.root, 'hex').copy(cycleData, 72); cycleData.writeBigUInt64LE(10000000n, 136); cycleData.writeUInt32LE(1, 168);
  createHash('sha256').update('account:RewardPayment').digest().copy(paymentData, 0, 0, 8);
  addresses.cycle.toBuffer().copy(paymentData, 8); new PublicKey(recipient).toBuffer().copy(paymentData, 40);
  paymentData.writeBigUInt64LE(10000000n, 72); paymentData.writeBigInt64LE(BigInt(blockTime), 84);
  const keys = [router, addresses.vault.toBase58(), addresses.cycle.toBase58(), recipient, addresses.payment.toBase58(), '11111111111111111111111111111111', programId];
  const instructionData = Buffer.alloc(24); createHash('sha256').update('global:payout_reward_sol').digest().copy(instructionData, 0, 0, 8); instructionData.writeBigUInt64LE(10000000n, 8);
  const tx = { slot: 123, blockTime, transaction: { signatures: [signature], message: { accountKeys: keys, instructions: [{ programIdIndex: 6, accounts: [0, 1, 2, 3, 4, 5], data: bs58.encode(instructionData) }] } }, meta: { err: null, preBalances: [20000000, 20000000, 1000, 0, 0, 1, 1], postBalances: [18995000, 10000000, 1000, 10000000, 1000000, 1, 1] } };
  const connection = { getGenesisHash: async () => 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG', getTransaction: async () => tx,
    getAccountInfo: async (key, commitment) => { assert.equal(commitment, 'finalized'); return { owner: new PublicKey(programId), data: key.equals(addresses.cycle) ? cycleData : paymentData }; } };
  const input = { state: {}, rewardState: { schedules: { cycle: { mint, asset: 'SOL', manifest, cycle: addresses.cycle.toBase58(), payments: { [recipient]: { status: 'paid', amount: '10000000', signature, payment: addresses.payment.toBase58(), finalized: true, balanceDeltaVerified: true } } } } }, windowStart: '2026-10-03T00:00:00Z', windowEnd: '2026-10-04T00:00:00Z' };
  return { adapter: createXPostChainAdapters({ connection, programId, rewardAuthority: router }), input, cycleData, paymentData, tx };
}

test('scheduled SOL rewards bind finalized manifest, payment account, creation instruction and exact deltas', async () => {
  const fixture = scheduledFixture();
  assert.equal((await fixture.adapter.verifiedDailyRewards(fixture.input)).payments[0].amountLamports, '10000000');
  fixture.cycleData[72] ^= 1;
  await assert.rejects(fixture.adapter.verifiedDailyRewards(fixture.input), /cycle differs/);
  fixture.cycleData[72] ^= 1; fixture.tx.meta.postBalances[3] -= 1;
  await assert.rejects(fixture.adapter.verifiedDailyRewards(fixture.input), /recipient delta/);
  fixture.tx.meta.postBalances[3] += 1; fixture.tx.meta.preBalances[4] = 1;
  await assert.rejects(fixture.adapter.verifiedDailyRewards(fixture.input), /uniquely create/);
  const self = scheduledFixture(router);
  await assert.rejects(self.adapter.verifiedDailyRewards(self.input), /Self-funded/);
});

test('collector rejects malformed signatures, conflicting proof slots and duplicate transfer totals', async () => {
  for (const proofs of [[{ ...proof(), signature: '1'.repeat(88) }], [proof(), { ...proof(), slot: 124 }]]) {
    const result = await collectXPostEvents({ state: { launches: { mint: launch } }, enabledAt, now, adapters: { verifyLaunch: async () => ({ ...await verifiedLaunch(launch), proofs }) } });
    assert.equal(result.events.length, 0);
  }
  const result = await collectXPostEvents({ enabledAt: '2026-10-01', now, adapters: { verifiedDailyRewards: async ({ windowStart, windowEnd }) => ({ cluster: 'devnet', windowStart, windowEnd, coverage: 'complete', scope: 'recorded-verified-payouts', proofs: [proof()], payments: ['one', 'two'].map(id => ({ id, recipient: wallet, signature, asset: 'SOL', amountLamports: '1', status: 'paid', finalized: true, balanceDeltaVerified: true })) }) } });
  assert.equal(result.events.length, 0);
});


test('one poll shares daily receipt verification but separate polls reverify finalized evidence', async () => {
  const { state, connection, reads } = referralFixture();
  const adapters = createXPostChainAdapters({ connection });
  const input = { state, rewardState: { schedules: {} }, enabledAt: '2026-10-01', now, adapters };
  assert.equal((await collectXPostEvents(input)).events.length, 2);
  assert.equal(reads.length, 2);
  await collectXPostEvents(input);
  assert.equal(reads.length, 4);
});

test('verification retries rotate and pending capacity never loses fresh highwater', async () => {
  const launches = Object.fromEntries(Array.from({ length: 201 }, (_, index) => [index, { ...launch, mint: Keypair.fromSeed(new Uint8Array(32).fill(index + 1)).publicKey.toBase58(), createdTimestamp: launch.createdTimestamp + index }]));
  const input = { state: { launches }, enabledAt, now, maxBatch: 200, adapters: { verifyLaunch: async () => { throw new Error('Unavailable'); } } };
  const first = await collectXPostEvents(input);
  assert.equal(first.cursor.streams.launch.pending.length, 200);
  const second = await collectXPostEvents({ ...input, cursor: first.cursor });
  assert.equal(second.cursor.streams.launch.pending.length, 200);
  assert.deepEqual(second.cursor.streams.launch.after, first.cursor.streams.launch.after);
  const resumed = await collectXPostEvents({ ...input, cursor: second.cursor, adapters: { verifyLaunch: verifiedLaunch } });
  const final = await collectXPostEvents({ ...input, cursor: resumed.cursor, adapters: { verifyLaunch: verifiedLaunch } });
  assert.equal(resumed.events.length + final.events.length, 201);
});

test('late launch registration uses verified ingestion time while old chain receipts remain excluded', async () => {
  const input = { state: { launches: { mint: launch } }, enabledAt, now, adapters: { verifyLaunch: verifiedLaunch } };
  const first = await collectXPostEvents(input);
  const late = { ...launch, mint: router, signature: otherSignature, createdTimestamp: launch.createdTimestamp - 1, onchainVerifiedAt: '2026-10-04T01:30:00Z' };
  const result = await collectXPostEvents({ ...input, state: { launches: { mint: launch, late } }, cursor: first.cursor });
  assert.equal(result.events[0].payload.mint, router);
});


test('an unavailable launch backlog leaves a polling budget for other event sources', async () => {
  const launches = Object.fromEntries(Array.from({ length: 5 }, (_, index) => [index, { ...launch, mint: Keypair.fromSeed(new Uint8Array(32).fill(index + 1)).publicKey.toBase58(), createdTimestamp: launch.createdTimestamp + index }]));
  const result = await collectXPostEvents({ state: { launches, listings: { mint: { mint, signature, cluster: 'devnet', onchainVerified: true, status: 'listed', listedAt: occurredAt } } }, enabledAt, now, maxBatch: 2, adapters: { verifyLaunch: async () => { throw new Error('Unavailable'); }, verifyListing: async () => ({ mint, name: 'Listed', occurredAt, proofs: [proof()] }) } });
  assert.equal(result.events[0].kind, 'listing');
  assert.equal(result.cursor.streams.launch.pending.length, 1);
});


test('strict profit adapter binds signed consent to the configured publisher before any chain reads', async () => {
  const consent = { version: 1, purpose: 'publish-closed-trade-on-x', cluster: 'devnet', origin: 'https://funded.vip', account: 'johntrand83', wallet, mint, buySignature: signature, sellSignature: otherSignature, issuedAt: '2026-10-04T00:59:00.000Z', expiresAt: '2026-10-04T01:09:00.000Z', challengeId: 'a'.repeat(43) };
  consent.signature = bs58.encode(nacl.sign.detached(new TextEncoder().encode(xProfitConsentStatement(consent)), Keypair.fromSeed(new Uint8Array(32).fill(2)).secretKey));
  const row = { wallet, mint, buySignature: signature, sellSignature: otherSignature, cluster: 'devnet', publicConsent: true, consentVerified: true, consentedAt: occurredAt, consent };
  let reads = 0;
  const connection = { getGenesisHash: async () => { reads += 1; return 'mainnet'; }, getParsedTransaction: async () => assert.fail('Wrong-network transaction lookup') };
  for (const config of [{ publicOrigin: 'https://other.example', xAccount: 'johntrand83' }, { publicOrigin: 'https://funded.vip', xAccount: 'otheraccount' }]) {
    const result = await collectXPostEvents({ state: { xPublicTradeShares: { test: row } }, enabledAt, now, adapters: { verifyPublicClosedTrade: createXProfitVerifier({ connection, ...config, now: () => Date.parse(now) }) } });
    assert.equal(result.events.length, 0);
    assert.equal(reads, 0);
  }
  const correctPublisher = createXProfitVerifier({ connection, publicOrigin: 'https://funded.vip', xAccount: 'johntrand83', now: () => Date.parse(now) });
  await assert.rejects(correctPublisher(row), /requires Solana Devnet/);
  assert.equal(reads, 1);
});

test('equal-time late smaller IDs survive a persisted cursor without duplicate events', async () => {
  const rows = [launch, { ...launch, mint: router, signature: otherSignature }];
  const input = { enabledAt, now, adapters: { verifyLaunch: verifiedLaunch } };
  const all = await collectXPostEvents({ ...input, state: { launches: rows } });
  const [smaller, larger] = [...all.events].sort((a, b) => a.id.localeCompare(b.id));
  const initialRow = rows.find(row => row.mint === larger.payload.mint);
  const first = await collectXPostEvents({ ...input, state: { launches: [initialRow] } });
  const second = await collectXPostEvents({ ...input, state: { launches: rows }, cursor: JSON.parse(JSON.stringify(first.cursor)) });
  assert.deepEqual(second.events.map(event => event.id), [smaller.id]);
  const third = await collectXPostEvents({ ...input, state: { launches: rows }, cursor: second.cursor });
  assert.equal(third.events.length, 0);
});

test('same-time boundary spans batches and retains failed verification across restart', async () => {
  const rows = Array.from({ length: 7 }, (_, index) => ({ ...launch, mint: Keypair.fromSeed(new Uint8Array(32).fill(index + 10)).publicKey.toBase58() }));
  let cursor, calls = 0;
  const ids = new Set();
  for (let poll = 0; poll < 6; poll++) {
    const result = await collectXPostEvents({ state: { launches: rows }, enabledAt, now, maxBatch: 2, cursor,
      adapters: { verifyLaunch: async row => { if (calls++ === 0) throw new Error('Not finalized yet'); return verifiedLaunch(row); } } });
    cursor = JSON.parse(JSON.stringify(result.cursor));
    for (const event of result.events) { assert.equal(ids.has(event.id), false); ids.add(event.id); }
  }
  assert.equal(ids.size, 7);
  assert.equal(cursor.streams.launch.pending.length, 0);
  assert.equal(cursor.streams.launch.boundaryIds.length, 7);
});

test('legacy timestamp cursors reconcile through durable outbox IDs and otherwise fail closed', async () => {
  const input = { enabledAt, now, state: { launches: [launch] }, adapters: { verifyLaunch: verifiedLaunch } };
  const first = await collectXPostEvents(input);
  const cursor = structuredClone(first.cursor); delete cursor.streams.launch.boundaryIds;
  const without = await collectXPostEvents({ ...input, cursor });
  assert.equal(without.events.length, 0);
  assert.match(without.sourceGaps.find(gap => gap.source === 'launch').reason, /durable outbox deduplication/);
  const state = { launches: [launch, { ...launch, mint: router, signature: otherSignature }] };
  const withDedup = await collectXPostEvents({ ...input, state, cursor, adapters: { verifyLaunch: verifiedLaunch, isKnownEvent: async id => id === first.events[0].id } });
  assert.equal(withDedup.events.length, 1);
  assert.equal(withDedup.events[0].payload.mint, router);
  assert.equal(withDedup.cursor.streams.launch.boundaryIds.length, 2);
  assert.equal((await collectXPostEvents({ ...input, state, cursor: withDedup.cursor })).events.length, 0);
});

test('full timestamp boundary stops before unseen records and reports its bounded capacity', async () => {
  const first = await collectXPostEvents({ state: { launches: [launch] }, enabledAt, now, adapters: { verifyLaunch: verifiedLaunch } });
  const cursor = structuredClone(first.cursor);
  cursor.streams.launch.boundaryIds = Array.from({ length: 500 }, (_, index) => `devnet:launch:${index.toString(16).padStart(64, '0')}`);
  const result = await collectXPostEvents({ state: { launches: [launch] }, enabledAt, now, cursor, adapters: { verifyLaunch: async () => assert.fail('No verification beyond bounded capacity') } });
  assert.equal(result.events.length, 0);
  assert.match(result.sourceGaps.find(gap => gap.source === 'launch').reason, /Timestamp boundary capacity is full/);
  assert.deepEqual(result.cursor.streams.launch.after, cursor.streams.launch.after);
  assert.equal(result.cursor.streams.launch.boundaryIds.length, 500);
});

test('daily rewards verify a 15-lamport receipt fixture without mutating its ledger record', async () => {
  const fixture = referralFixture();
  const payout = fixture.state.payouts['referral:claim'];
  payout.amountSol = 1.5e-8;
  fixture.state.referralClaims.claim.amount = 1.5e-8;
  fixture.state.settlements[otherSignature].fundedApp.referralLevels[0].amount = 1.5e-8;
  fixture.txs[signature].meta.postBalances = [19994985, 15];
  const before = structuredClone(fixture.state);
  const result = await createXPostChainAdapters({ connection: fixture.connection }).verifiedDailyRewards({ state: fixture.state, rewardState: { schedules: {} }, windowStart: '2026-10-03T00:00:00Z', windowEnd: '2026-10-04T00:00:00Z' });
  assert.equal(result.payments[0].amountLamports, '15');
  assert.deepEqual(fixture.state, before);
});

test('daily project and reward adapters reject invalid UTC windows before any provider reads', async () => {
  let reads = 0;
  const adapters = createXPostChainAdapters({ connection: { getGenesisHash: async () => { reads++; throw new Error('Unexpected provider read'); } } });
  const base = { state: {}, rewardState: { schedules: {} }, windowStart: '2026-10-03T00:00:00Z', windowEnd: '2026-10-04T00:00:00Z' };
  const invalid = [
    undefined, {}, { ...base, windowStart: undefined }, { ...base, windowEnd: undefined },
    { ...base, windowStart: null }, { ...base, windowEnd: '' }, { ...base, windowStart: 'not-a-date', windowEnd: 'not-a-date' },
    { ...base, windowStart: NaN }, { ...base, windowStart: Date.parse(base.windowStart) },
    { ...base, windowStart: '2026-02-30T00:00:00Z', windowEnd: '2026-03-03T00:00:00Z' },
    { ...base, windowStart: '2026-02-29T00:00:00Z', windowEnd: '2026-03-02T00:00:00Z' },
    { ...base, windowStart: '2026-10-03T00:00:00+00:00' }, { ...base, windowStart: '2026-10-03T00:00:00' },
    { ...base, windowStart: '2026-10-03' }, { ...base, windowStart: '2026-10-03T00:00:01Z' },
    { ...base, windowStart: '2026-10-03T00:00:00.001Z' }, { ...base, windowStart: ' 2026-10-03T00:00:00Z' },
    { ...base, windowEnd: base.windowStart }, { ...base, windowEnd: '2026-10-02T00:00:00Z' },
    { ...base, windowEnd: '2026-10-03T23:00:00Z' }, { ...base, windowEnd: '2026-10-04T01:00:00Z' },
    { ...base, windowEnd: '2026-10-05T00:00:00Z' },
  ];
  for (const method of ['verifiedDailyProjects', 'verifiedDailyRewards']) {
    for (const input of invalid) await assert.rejects(adapters[method](input), /Daily window/);
  }
  assert.equal(reads, 0);
});

test('valid UTC daily adapters keep exact lower-inclusive and upper-exclusive receipt boundaries', async () => {
  for (const suffix of ['Z', '.000Z']) {
    const fixture = referralFixture(), adapters = createXPostChainAdapters({ connection: fixture.connection });
    const input = { state: fixture.state, rewardState: { schedules: {} }, windowStart: `2026-10-03T00:00:00${suffix}`, windowEnd: `2026-10-04T00:00:00${suffix}` };
    const start = Date.parse(input.windowStart) / 1000, end = Date.parse(input.windowEnd) / 1000;
    fixture.txs[otherSignature].blockTime = start - 2;
    for (const [blockTime, count] of [[start - 1, 0], [start, 1], [end - 1, 1], [end, 0]]) {
      fixture.txs[signature].blockTime = blockTime;
      const rewards = await adapters.verifiedDailyRewards(input);
      const projects = await adapters.verifiedDailyProjects(input);
      assert.equal(rewards.payments.length, count);
      assert.equal(projects.projects.length, count);
      for (const result of [rewards, projects]) {
        assert.equal(result.coverage, 'complete');
        assert.equal(result.windowStart, input.windowStart);
        assert.equal(result.windowEnd, input.windowEnd);
      }
      if (count) { assert.equal(rewards.payments[0].amountLamports, '10000000'); assert.equal(projects.projects[0].amountLamports, '10000000'); }
    }
  }
  const fixture = referralFixture();
  const result = await createXPostChainAdapters({ connection: fixture.connection }).verifiedDailyRewards({ state: fixture.state, rewardState: { schedules: {} }, windowStart: '2026-10-03T12:00:00Z', windowEnd: '2026-10-04T12:00:00Z' });
  assert.equal(result.payments.length, 1, 'Explicit minute-aligned 24-hour windows remain valid like the formatter');
});

test('daily cache cannot bypass validation or reuse evidence for another requested interval', async () => {
  const fixture = referralFixture(), adapters = createXPostChainAdapters({ connection: fixture.connection });
  const input = { state: fixture.state, rewardState: { schedules: {} }, windowStart: '2026-10-03T00:00:00Z', windowEnd: '2026-10-04T00:00:00Z', batchToken: Symbol('same-poll') };
  assert.equal((await adapters.verifiedDailyRewards(input)).payments.length, 1);
  assert.equal((await adapters.verifiedDailyProjects(input)).projects.length, 1);
  assert.equal(fixture.reads.length, 2);
  for (const method of ['verifiedDailyProjects', 'verifiedDailyRewards']) {
    await assert.rejects(adapters[method]({ ...input, windowStart: 'not-a-date', windowEnd: 'not-a-date' }), /Daily window/);
  }
  assert.equal(fixture.reads.length, 2, 'Malformed cached requests never reach RPC');
  const previous = { ...input, windowStart: '2026-10-02T00:00:00Z', windowEnd: '2026-10-03T00:00:00Z' };
  const result = await adapters.verifiedDailyProjects(previous);
  assert.equal(result.projects.length, 0);
  assert.equal(result.windowStart, previous.windowStart);
  assert.equal(result.windowEnd, previous.windowEnd);
  assert.equal(fixture.reads.length, 3, 'A different valid interval rechecks receipt times');
  const millisecond = { ...input, windowStart: '2026-10-03T00:00:00.000Z', windowEnd: '2026-10-04T00:00:00.000Z' };
  const restored = await adapters.verifiedDailyRewards(millisecond);
  assert.equal(restored.payments.length, 1);
  assert.equal(restored.windowStart, millisecond.windowStart);
  assert.equal(restored.windowEnd, millisecond.windowEnd);
});

// These fixtures exercise source discovery only; their finalized proofs are
// synthetic. The production chain and signed-consent adapters have separate tests.
function backdatedFixture(kind = 'launch') {
  const bucket = { launch: 'launches', listing: 'listings', trade_profit: 'xPublicTradeShares' }[kind];
  const verifierName = { launch: 'verifyLaunch', listing: 'verifyListing', trade_profit: 'verifyPublicClosedTrade' }[kind];
  const rows = [], known = new Set(), calls = [];
  const make = (index, at = occurredAt) => {
    const rowMint = bs58.encode(new Uint8Array(32).fill(index));
    return { ...launch, mint: rowMint, onchainVerifiedAt: at, listedAt: at, status: 'listed', wallet,
      buySignature: signature, sellSignature: otherSignature, publicConsent: true, consentVerified: true, consentedAt: at };
  };
  const verified = async row => {
    calls.push(row.mint);
    if (row.unavailable) throw new Error('Synthetic provider outage');
    return { mint: row.mint, name: 'Fixture', wallet, listingType: 'paid', marketingTier: row.creatorLaunchBurn?.tier, occurredAt: row.receiptAt || row.onchainVerifiedAt,
      publicConsent: true, completeCostBasis: !row.incomplete, positionClosed: true,
      buyCostLamports: '1000000000', sellProceedsLamports: '3000000000', feesLamports: '5000',
      proofs: (kind === 'trade_profit' ? [proof(), proof(otherSignature)] : [proof()]).map(item => row.confirmed ? { ...item, commitment: 'confirmed' } : item) };
  };
  const input = { enabledAt, now, state: { [bucket]: rows }, adapters: { [verifierName]: verified, isKnownEvent: async id => known.has(id) } };
  let cursor;
  const poll = async (options = {}) => {
    const result = await collectXPostEvents({ ...input, cursor, ...options });
    cursor = JSON.parse(JSON.stringify(result.cursor));
    for (const event of result.events) { assert(!known.has(event.id), 'A durable outbox event must not be emitted twice'); known.add(event.id); }
    return result;
  };
  return { make, rows, known, calls, input, poll, get cursor() { return cursor; } };
}

for (const kind of ['launch', 'listing', 'trade_profit']) {
  test(`backdated ${kind} insertion is recovered after restart without moving highwater or duplicating known events`, async () => {
    const fixture = backdatedFixture(kind);
    fixture.rows.push(fixture.make(20, '2026-10-04T01:30:00Z'));
    await fixture.poll();
    const after = structuredClone(fixture.cursor.streams[kind].after);
    fixture.rows.push(fixture.make(21));
    const recovered = [];
    for (let index = 0; index < 4; index++) recovered.push(...(await fixture.poll()).events);
    assert.deepEqual(recovered.map(event => event.payload.mint), [fixture.rows[1].mint]);
    assert.deepEqual(fixture.cursor.streams[kind].after, after);
    assert.equal(fixture.known.size, 2);
    assert(recovered[0].payload.proofs.every(item => item.commitment === 'finalized'));
  });
}

test('backdated reconciliation preserves activation, finality and complete realized-profit proof gates', async () => {
  for (const kind of ['launch', 'listing', 'trade_profit']) {
    const fixture = backdatedFixture(kind);
    fixture.rows.push(fixture.make(20, '2026-10-04T01:30:00Z'));
    await fixture.poll();
    fixture.rows.push(fixture.make(21, '2026-10-03T23:00:00Z'), { ...fixture.make(22), receiptAt: '2026-10-03T23:59:00Z' },
      { ...fixture.make(23), confirmed: true }, ...(kind === 'trade_profit' ? [{ ...fixture.make(24), incomplete: true }] : []));
    for (let index = 0; index < 3; index++) assert.equal((await fixture.poll()).events.length, 0);
    assert(!fixture.calls.includes(fixture.rows[1].mint), 'Preactivation sources must never reach the provider');
    assert(fixture.calls.includes(fixture.rows[2].mint), 'Eligible ingestion still requires actual receipt-time verification');
    assert(fixture.cursor.streams[kind].pending.length >= 1, 'Unfinalized evidence remains retryable');
  }
});

test('backdated reconciliation requires durable dedup and recovers after its lookup outage', async () => {
  const fixture = backdatedFixture();
  fixture.rows.push(fixture.make(20, '2026-10-04T01:30:00Z')); await fixture.poll();
  fixture.rows.push(fixture.make(21));
  for (const isKnownEvent of [undefined, async () => { throw new Error('Outbox unavailable'); }, undefined]) {
    const blocked = await fixture.poll({ adapters: { ...fixture.input.adapters, isKnownEvent } });
    assert.equal(blocked.events.length, 0);
    assert.equal(fixture.calls.length, 1, 'Unavailable durable dedup must not invoke backdated chain verification');
  }
  let recovered = 0;
  for (let index = 0; index < 4; index++) recovered += (await fixture.poll()).events.length;
  assert.equal(recovered, 1);
});

test('bounded reconciliation wraps to discover a lower ID inserted behind its finite sweep', async () => {
  const fixture = backdatedFixture();
  fixture.rows.push(fixture.make(20, '2026-10-04T01:30:00Z')); await fixture.poll();
  const candidates = Array.from({ length: 8 }, (_, index) => fixture.make(index + 30));
  const eligible = await collectXPostEvents({ ...fixture.input, state: { launches: candidates } });
  const ordered = [...eligible.events].sort((a, b) => a.id < b.id ? -1 : 1);
  const delayed = candidates.find(row => row.mint === ordered[0].payload.mint);
  fixture.rows.push(...candidates.filter(row => row !== delayed));
  await fixture.poll({ maxBatch: 1 });
  fixture.rows.push(delayed);
  for (let index = 0; index < 20; index++) {
    const result = await fixture.poll({ maxBatch: 1 });
    assert(result.events.length <= 1);
  }
  assert.equal(fixture.known.size, 9, 'A new lower ID must be discovered on the next finite sweep');
});

test('one-record batches fairly revisit retries, fresh sources and backdated sources', async () => {
  const fixture = backdatedFixture();
  fixture.rows.push(fixture.make(20, '2026-10-04T01:30:00Z')); await fixture.poll();
  const retry = { ...fixture.make(21, '2026-10-04T01:31:00Z'), unavailable: true };
  fixture.rows.push(retry); await fixture.poll({ maxBatch: 1 });
  const late = fixture.make(22); fixture.rows.push(late); fixture.calls.length = 0;
  for (let index = 0; index < 12; index++) {
    fixture.rows.push(fixture.make(index + 30, `2026-10-04T01:${String(32 + index).padStart(2, '0')}:00Z`));
    const result = await fixture.poll({ maxBatch: 1 });
    assert(result.events.length <= 1);
  }
  assert(fixture.calls.includes(late.mint), 'Continuous fresh sources must not starve older discovery');
  assert(fixture.calls.filter(value => value === retry.mint).length >= 2, 'Retries must keep receiving a bounded share');
  assert(fixture.known.size >= 3, 'Fresh events must continue while retries fail');
});

test('full retry capacity cannot discard a newly discovered backdated source', async () => {
  const fixture = backdatedFixture();
  fixture.rows.push(...Array.from({ length: 200 }, (_, index) => ({ ...fixture.make(index + 1, '2026-10-04T01:30:00Z'), unavailable: true })));
  await fixture.poll({ maxBatch: 200 });
  assert.equal(fixture.cursor.streams.launch.pending.length, 200);
  const late = fixture.make(220); fixture.rows.push(late);
  const blocked = await fixture.poll({ maxBatch: 3 });
  assert.equal(blocked.events.length, 0);
  assert(!fixture.calls.includes(late.mint));
  for (const row of fixture.rows) row.unavailable = false;
  for (let index = 0; index < 5; index++) await fixture.poll({ maxBatch: 200 });
  assert.equal(fixture.known.size, 201);
});

test('duplicate storage rows produce one logical event and one verification per poll', async () => {
  const fixture = backdatedFixture();
  const first = fixture.make(20, '2026-10-04T01:30:00Z');
  fixture.rows.push(first, structuredClone(first));
  assert.equal((await fixture.poll()).events.length, 1);
  assert.equal(fixture.calls.length, 1);
  const late = fixture.make(21);
  fixture.rows.push(late, structuredClone(late));
  assert.equal((await fixture.poll()).events.length, 1);
  assert.equal(fixture.calls.filter(value => value === late.mint).length, 1);
  assert.equal((await fixture.poll()).events.length, 0);
});


test('backdated proof retries retain durable dedup requirements after an adapter configuration outage', async () => {
  const fixture = backdatedFixture();
  fixture.rows.push(fixture.make(20, '2026-10-04T01:30:00Z')); await fixture.poll();
  const late = { ...fixture.make(21), unavailable: true }; fixture.rows.push(late);
  await fixture.poll();
  assert.equal(fixture.cursor.streams.launch.pending.length, 1);
  const calls = fixture.calls.length; late.unavailable = false;
  const blocked = await fixture.poll({ adapters: { ...fixture.input.adapters, isKnownEvent: undefined } });
  assert.equal(blocked.events.length, 0);
  assert.equal(fixture.calls.length, calls, 'A reconciliation retry must not bypass durable dedup');
  assert.equal(fixture.cursor.streams.launch.pending.length, 1);
  assert.equal((await fixture.poll()).events.length, 1);
  assert.equal((await fixture.poll()).events.length, 0);
});

test('known launch reconciliation cannot starve listings, profits or completed daily summaries in tiny batches', async () => {
  for (const maxBatch of [1, 2]) {
    const fixture = backdatedFixture();
    fixture.input.enabledAt = '2026-10-01T00:00:00Z';
    fixture.rows.push(fixture.make(20), fixture.make(21, '2026-10-04T01:30:00Z'));
    await fixture.poll();
    fixture.input.state.listings = [{ mint, signature, cluster: 'devnet', onchainVerified: true, status: 'listed', listedAt: occurredAt }];
    fixture.input.adapters.verifyListing = async () => ({ mint, name: 'Fixture', occurredAt, proofs: [proof()] });
    fixture.input.adapters.verifiedDailyProjects = async ({ windowStart, windowEnd }) => ({ cluster: 'devnet', windowStart, windowEnd, coverage: 'complete', scope: 'recorded-verified-payouts', metric: 'paid_rewards_lamports', projects: [{ mint, name: 'Fixture', amountLamports: '15' }], proofs: [proof()] });
    fixture.input.adapters.verifiedDailyRewards = async ({ windowStart, windowEnd }) => ({ cluster: 'devnet', windowStart, windowEnd, coverage: 'complete', scope: 'recorded-verified-payouts', payments: [{ id: 'fixture', recipient: wallet, signature, asset: 'SOL', amountLamports: '15', status: 'paid', finalized: true, balanceDeltaVerified: true }], proofs: [proof()] });
    fixture.input.state.xPublicTradeShares = [{ mint, wallet, buySignature: signature, sellSignature: otherSignature, cluster: 'devnet', publicConsent: true, consentVerified: true, consentedAt: occurredAt }];
    fixture.input.adapters.verifyPublicClosedTrade = async () => ({ mint, wallet, name: 'Fixture', occurredAt, publicConsent: true, completeCostBasis: true, positionClosed: true, buyCostLamports: '1000000000', sellProceedsLamports: '3000000000', feesLamports: '5000', proofs: [proof(), proof(otherSignature)] });
    const kinds = [];
    for (let index = 0; index < 12; index++) {
      const result = await fixture.poll({ maxBatch });
      assert(result.events.length <= maxBatch);
      kinds.push(...result.events.map(event => event.kind));
    }
    assert.deepEqual(kinds.sort(), ['daily_projects', 'daily_rewards', 'listing', 'trade_profit']);
    assert.equal(fixture.known.size, 6);
  }
});

test('settled sources do not prevent an older launch from receiving a one-record reconciliation turn', async () => {
  const fixture = backdatedFixture();
  fixture.rows.push(fixture.make(20), fixture.make(21, '2026-10-04T01:30:00Z'));
  fixture.input.state.listings = fixture.rows.map(row => ({ ...row, status: 'listed', listedAt: row.onchainVerifiedAt }));
  fixture.input.adapters.verifyListing = async row => ({ mint: row.mint, name: 'Fixture', occurredAt: row.listedAt, proofs: [proof()] });
  fixture.input.state.xPublicTradeShares = fixture.rows.map(row => ({ ...row, wallet, buySignature: signature, sellSignature: otherSignature, publicConsent: true, consentVerified: true, consentedAt: row.onchainVerifiedAt }));
  fixture.input.adapters.verifyPublicClosedTrade = async row => ({ mint: row.mint, wallet, name: 'Fixture', occurredAt: row.consentedAt, publicConsent: true, completeCostBasis: true, positionClosed: true, buyCostLamports: '1000000000', sellProceedsLamports: '3000000000', feesLamports: '5000', proofs: [proof(), proof(otherSignature)] });
  await fixture.poll();
  assert.equal(fixture.known.size, 6);
  const late = fixture.make(22, '2026-10-04T00:30:00Z'); fixture.rows.push(late);
  const emitted = [];
  for (let index = 0; index < 20; index++) {
    const result = await fixture.poll({ maxBatch: 1 });
    assert(result.events.length <= 1);
    emitted.push(...result.events);
  }
  assert.deepEqual(emitted.map(event => [event.kind, event.payload.mint]), [['launch', late.mint]]);
});
