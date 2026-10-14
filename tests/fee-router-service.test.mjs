import test from 'node:test';
import assert from 'node:assert/strict';
import bs58 from 'bs58';
import { Keypair, SystemProgram } from '@solana/web3.js';
import { deriveFeeRouter, deriveMintFeeRouter } from '../fee-router.js';
import { deriveMintRouterV3 } from '../mint-router-v3.js';
import { createFeeRouterService } from '../server/fee-router-service.mjs';

// Synthetic keys are never funded, persisted, or sent to a network.
const key = byte => Keypair.fromSeed(new Uint8Array(32).fill(byte));
function fixture(overrides = {}) {
  const keeper = key(1), authority = key(2), payout = key(3), revenue = key(4), program = key(5), mint = key(6);
  const legacy = deriveFeeRouter(program.publicKey);
  const router = deriveMintFeeRouter(program.publicKey, mint.publicKey);
  const env = {
    FUNDED_MINT_FEE_ROUTER_ENABLED: 'true', SOLANA_KEEPER_CONFIGURED: 'true',
    SOLANA_KEEPER_SECRET_KEY: bs58.encode(keeper.secretKey),
    FUNDED_ROUTER_AUTHORITY_SECRET_KEY: bs58.encode(authority.secretKey),
    SOLANA_REFERRAL_PAYOUT_SECRET_KEY: bs58.encode(payout.secretKey), SOLANA_REFERRAL_PAYOUT_CONFIGURED: 'true',
    FUNDED_PUMP_REVENUE_WALLET: revenue.publicKey.toBase58(),
    FUNDED_FEE_ROUTER_PROGRAM_ID: program.publicKey.toBase58(),
    FUNDED_REWARD_PROGRAM_DATA_SHA256: 'a'.repeat(64), X_BEARER_TOKEN: 'fixture',
  };
  const state = {
    connections: 0, sends: 0, verificationReads: 0,
    launch: { onchainVerified: true, cluster: 'devnet', creator: router.address.toBase58(), pumpFeeRoute: { scope: 'per-mint-v2' } },
    curveCreator: router.address, instructions: [SystemProgram.transfer({ fromPubkey: keeper.publicKey, toPubkey: router.address, lamports: 0 })],
    proof: { transaction: { message: { accountKeys: [router.address] } }, meta: { preBalances: [100], postBalances: [130], err: null } },
    main: { collections:{}, v3Settlements:{} },
    executable: true, routerVerified: true, programHash: 'a'.repeat(64), lookupHealth: null,
  };
  class Connection {
    constructor() { state.connections++; }
    async getAccountInfo() {
      const data = Buffer.alloc(74);
      authority.publicKey.toBuffer().copy(data, 41);
      return { data };
    }
    async getBalance() { return 150; }
    async getLatestBlockhash() { return { blockhash: mint.publicKey.toBase58() }; }
    async getTransaction() { return state.proof; }
  }
  const service = createFeeRouterService({
    env, solanaCluster: 'devnet', solanaRpcUrl: 'http://unused.invalid', fundedTokenMint: mint.publicKey.toBase58(), devnetTestMode: false,
    store: { readLaunch: async () => state.launch, read:async () => state.main }, Connection,
    xConfig: () => ({ clientId: 'fixture', clientSecret: 'fixture' }), resolveXUser: { health: () => state.lookupHealth },
    OnlinePumpSdk: class { async fetchBondingCurve() { return { creator: state.curveCreator }; } },
    verifyFeeRouterAccount: async () => ({ verified: state.routerVerified, reason: 'fixture' }),
    verifyMintFeeRouterAccount: async () => ({ verified: true }),
    readProgramDataEvidence: async () => { state.verificationReads++; return { account: { executable: state.executable }, sha256: state.programHash }; },
    buildMintCreatorFeeCollectionInstructions: async () => ({ instructions: state.instructions }),
    sendAndConfirmTransaction: async (_connection, transaction, signers) => { state.sends++; state.transaction = transaction; state.signers = signers; return 'fixture-signature'; },
    sendFinalizedSolPayout: async ({ payer, recipient, lamports, onSigned }) => {
      state.sends++; state.signers = [payer]; state.lamports = lamports;
      await onSigned?.({ signature: 'fixture-signature' });
      return { signature: 'fixture-signature', from: payer.publicKey.toBase58(), to: recipient.toBase58(),
        amountLamports: lamports, recipientDeltaLamports: lamports, finalized: true };
    },
    ...overrides,
  });
  return { service, env, state, keeper, authority, payout, revenue, legacy, router, mint: mint.publicKey.toBase58() };
}

function v3Fixture(overrides = {}) {
  const v3Program = key(7).publicKey;
  const v3Router = deriveMintRouterV3(v3Program, key(6).publicKey).address;
  let state;
  const f = fixture({
    verifyV3LaunchRouterReadiness:async () => ({ ready:true, configuredRouter:v3Router.toBase58() }),
    loadFinalizedV3PumpCollection:async () => state.finalizedProof,
    ...overrides,
  });
  state = f.state;
  state.launch = { onchainVerified:true, cluster:'devnet', mint:f.mint,
    creator:v3Router.toBase58(), creatorWallet:f.authority.publicKey.toBase58(),
    pumpFeeRoute:{ scope:'per-mint-v3', router:v3Router.toBase58(),
      programId:v3Program.toBase58(), initialAuthority:f.authority.publicKey.toBase58(),
      protocolSplit:{ operationsPercent:50, referralLevelPercents:[10,3,2],
        communityPercent:10, buybackPercent:25 } } };
  state.curveCreator = v3Router;
  state.finalizedProof = { signature:'fixture-signature', mint:f.mint,
    router:v3Router.toBase58(), expectedLamports:30n,
    claimId:Buffer.alloc(32, 1), slot:42 };
  f.env.FUNDED_V3_FEE_ROUTER_PROGRAM_ID = v3Program.toBase58();
  f.env.FUNDED_V3_PROGRAM_DATA_SHA256 = 'b'.repeat(64);
  f.env.FUNDED_V3_COLLECTION_ENABLED = 'true';
  f.env.FUNDED_V3_ROUTER_AUTHORITY_SECRET_KEY = bs58.encode(f.authority.secretKey);
  return f;
}

test('referral payout rejects role collisions, missing configuration and invalid amounts without sending', async () => {
  const f = fixture();
  for (const conflicting of [f.keeper, f.authority, f.revenue]) {
    f.env.SOLANA_REFERRAL_PAYOUT_SECRET_KEY = bs58.encode(conflicting.secretKey);
    assert.equal(f.service.referralPayoutKeypair(), null);
  }
  f.env.SOLANA_REFERRAL_PAYOUT_SECRET_KEY = bs58.encode(f.payout.secretKey);
  f.env.SOLANA_REFERRAL_PAYOUT_CONFIGURED = 'false';
  await assert.rejects(f.service.executeSolPayout({ recipientWallet: f.mint, amountSol: 1 }), /not configured/);
  f.env.SOLANA_REFERRAL_PAYOUT_CONFIGURED = 'true';
  for (const amountSol of [0, -1, NaN, Infinity, 1e20, 1e-10]) {
    await assert.rejects(f.service.executeSolPayout({ recipientWallet: f.mint, amountSol }), /positive SOL/);
  }
  assert.equal(f.state.connections, 0);
  assert.equal(f.state.sends, 0);
});

test('payout passes the dedicated signer and exact lamports to the injected sender', async () => {
  const f = fixture();
  const result = await f.service.executeSolPayout({ recipientWallet: f.mint, amountSol: 0.001 });
  assert.equal(result.signature, 'fixture-signature');
  assert.equal(result.from, f.payout.publicKey.toBase58());
  assert.equal(result.to, f.mint);
  assert.equal(f.state.signers[0].publicKey.toBase58(), result.from);
  assert.equal(f.state.lamports, 1_000_000);
  assert.equal(result.finalized, true);
  assert.equal(result.recipientDeltaLamports, 1_000_000);
  assert.equal(f.state.sends, 1);
});

test('reconciliation uses the original public payer after the configured secret rotates', async () => {
  let observed;
  const f = fixture({ reconcileFinalizedSolPayout: async input => { observed = input; return {
    signature: input.signature, from: input.payer.toBase58(), to: input.recipient.toBase58(),
    amountLamports: input.lamports, recipientDeltaLamports: input.lamports, finalized: true,
  }; } });
  const original = f.payout.publicKey.toBase58();
  f.env.SOLANA_REFERRAL_PAYOUT_SECRET_KEY = '';
  f.env.SOLANA_REFERRAL_PAYOUT_CONFIGURED = 'false';
  const proof = await f.service.reconcileSolPayout({ recipientWallet: f.mint, amountSol: 0.001,
    signature: 'signed-before-rotation', from: original });
  assert.equal(observed.payer.toBase58(), original);
  assert.equal(proof.from, original);
  assert.equal(f.state.sends, 0);
});

test('V2 collection is retired and V3 collection does not depend on V2 configuration', async () => {
  const old = fixture();
  await assert.rejects(old.service.collectPumpCreatorFees({ requestedMint:old.mint }), /requires a verified V3 mint router/);
  assert.equal(old.state.sends, 0);
  const f = v3Fixture();
  f.env.FUNDED_FEE_ROUTER_PROGRAM_ID = '';
  f.env.FUNDED_REWARD_PROGRAM_DATA_SHA256 = '';
  const result = await f.service.collectPumpCreatorFees({ requestedMint:f.mint });
  assert.equal(result.scope, 'per-mint-v3');
  assert.equal(result.status, 'collected');
  assert.equal(f.state.sends, 1);
});

test('collection rejects unverified launches and mismatched Pump creators before sending', async () => {
  const f = v3Fixture();
  f.state.launch.onchainVerified = false;
  await assert.rejects(f.service.collectPumpCreatorFees({ requestedMint: f.mint }), /verified launch/);
  f.state.launch.onchainVerified = true;
  f.state.curveCreator = f.keeper.publicKey;
  await assert.rejects(f.service.collectPumpCreatorFees({ requestedMint: f.mint }), /fee owner does not match/);
  assert.equal(f.state.sends, 0);
});

test('collection uses transaction balance proof and leaves missing proof pending', async () => {
  const f = v3Fixture();
  const result = await f.service.collectPumpCreatorFees({ requestedMint: f.mint });
  assert.equal(result.collectedLamports, 30);
  assert.equal(result.onchainVerified, true);
  assert.equal(result.attribution, 'mint-verified');
  assert.equal(f.state.signers[0].publicKey.toBase58(), f.keeper.publicKey.toBase58());
  f.state.finalizedProof = null;
  const pending = await f.service.collectPumpCreatorFees({ requestedMint: f.mint });
  assert.equal(pending.status, 'verification-pending');
  assert.equal(pending.onchainVerified, false);
  assert.equal(pending.signature, 'fixture-signature');
  f.state.instructions = [];
  const empty = await f.service.collectPumpCreatorFees({ requestedMint: f.mint });
  assert.equal(empty.status, 'nothing-to-collect');
  assert.equal(f.state.sends, 2, 'Empty instruction sets must not broadcast');
});

test('collection propagates uncertain broadcast outcomes without retrying', async () => {
  let attempts = 0;
  const f = v3Fixture({ sendAndConfirmTransaction: async () => { attempts++; throw new Error('RPC response timed out'); } });
  await assert.rejects(f.service.collectPumpCreatorFees({ requestedMint: f.mint }), /RPC response timed out/);
  assert.equal(attempts, 1);
});

test('V3 collection needs its separate gate, immutable policy, and finalized Pump proof', async () => {
  const v3Program = key(7).publicKey;
  const v3Router = deriveMintRouterV3(v3Program, key(6).publicKey).address;
  let finalizedProof = null;
  let readinessCalls = 0;
  const f = fixture({
    verifyV3LaunchRouterReadiness:async input => {
      readinessCalls++;
      assert.equal(input.programId, v3Program.toBase58());
      assert.equal(input.initialAuthority, key(2).publicKey.toBase58());
      return { ready:true, configuredRouter:v3Router.toBase58() };
    },
    loadFinalizedV3PumpCollection:async () => finalizedProof,
  });
  f.state.launch = { onchainVerified:true, cluster:'devnet', mint:f.mint,
    creator:v3Router.toBase58(), creatorWallet:f.authority.publicKey.toBase58(),
    pumpFeeRoute:{ scope:'per-mint-v3', router:v3Router.toBase58(),
      programId:v3Program.toBase58(), initialAuthority:f.authority.publicKey.toBase58(),
      protocolSplit:{ operationsPercent:50, referralLevelPercents:[10,3,2],
        communityPercent:10, buybackPercent:25 } } };
  f.state.curveCreator = v3Router;
  f.env.FUNDED_V3_FEE_ROUTER_PROGRAM_ID = v3Program.toBase58();
  f.env.FUNDED_V3_PROGRAM_DATA_SHA256 = 'b'.repeat(64);
  await assert.rejects(f.service.collectPumpCreatorFees({ requestedMint:f.mint }), /V3 collection is not activated/);
  assert.equal(f.state.sends, 0);
  f.env.FUNDED_V3_COLLECTION_ENABLED = 'true';
  await assert.rejects(f.service.collectPumpCreatorFees({ requestedMint:f.mint }), /separate signer matching the V3 settlement authority/);
  assert.equal(f.state.sends, 0);
  f.env.FUNDED_V3_ROUTER_AUTHORITY_SECRET_KEY = bs58.encode(f.authority.secretKey);
  finalizedProof = { signature:'fixture-signature', mint:f.mint, router:v3Router.toBase58(),
    expectedLamports:30n, claimId:Buffer.alloc(32, 1), slot:42 };
  const collected = await f.service.collectPumpCreatorFees({ requestedMint:f.mint });
  assert.equal(collected.scope, 'per-mint-v3');
  assert.equal(collected.status, 'collected');
  assert.equal(collected.collectedLamports, 30);
  assert.equal(collected.claimId, '01'.repeat(32));
  assert.equal(readinessCalls, 1);
  f.state.main.collections[collected.signature] = collected;
  await assert.rejects(f.service.collectPumpCreatorFees({ requestedMint:f.mint }), /prior V3 collection needs finalized settlement/);
  assert.equal(f.state.sends, 1);
  f.state.main.v3Settlements[collected.signature] = { status:'verification-pending' };
  await assert.rejects(f.service.collectPumpCreatorFees({ requestedMint:f.mint }), /prior V3 collection needs finalized settlement/);
  assert.equal(f.state.sends, 1);
  f.state.main.v3Settlements[collected.signature] = { status:'finalized' };
  finalizedProof = null;
  const pending = await f.service.collectPumpCreatorFees({ requestedMint:f.mint });
  assert.equal(pending.status, 'verification-pending');
  assert.equal(pending.onchainVerified, false);
  assert.equal(f.state.sends, 2);
});
