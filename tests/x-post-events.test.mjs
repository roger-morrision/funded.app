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
const launch = { mint, signature, cluster: 'devnet', onchainVerified: true, createdTimestamp: Date.parse(occurredAt) / 1000 };
const verifiedLaunch = async row => ({ mint: row.mint, name: 'Example', symbol: 'EX', occurredAt, proofs: [proof(row.signature)] });

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
