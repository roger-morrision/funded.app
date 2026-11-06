import assert from 'node:assert/strict';
import test from 'node:test';
import { resolve } from 'node:path';
import { Keypair } from '@solana/web3.js';
import { assertDevnet, assertFinalized, DEVNET_GENESIS, keypairProvider, loadV3LaunchInputs, prepareAcceptancePayer, runAcceptance } from '../scripts/devnet-acceptance.mjs';
import { Transaction, SystemProgram } from '@solana/web3.js';
import { submitPumpDevnetLaunch } from '../launch-flow.js';

test('Devnet acceptance guard rejects mainnet, testnet and missing genesis', () => {
  assert.doesNotThrow(() => assertDevnet(DEVNET_GENESIS));
  for (const genesis of ['5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp', '4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY', null, '']) {
    assert.throws(() => assertDevnet(genesis), /not Solana Devnet/);
  }
});

test('only finalized error-free receipts count as successful', () => {
  assert.doesNotThrow(() => assertFinalized({ confirmationStatus: 'finalized', err: null }));
  for (const status of [null, {}, { confirmationStatus: 'confirmed', err: null }, { confirmationStatus: 'processed', err: null }, { confirmationStatus: 'finalized', err: { InstructionError: [0, 'Custom'] } }]) {
    assert.throws(() => assertFinalized(status), /finalized, error-free/);
  }
});

test('execute on the wrong network stops before funding or wallet creation', async t => {
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    const request = JSON.parse(init.body);
    requests.push(request.method);
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: 'wrong-network' }), { headers: { 'content-type': 'application/json' } });
  });
  const result = await runAcceptance({ execute: true, walletFile: '/not-loaded-on-wrong-network.json' });
  assert.equal(result.status, 'blocked');
  assert.deepEqual(requests, ['getGenesisHash']);
  assert.equal(result.transactions.length, 0);
  assert.equal(result.wallets, undefined);
  assert.equal(result.coverage.fullApplicationJourney, false);
});


test('explicit test wallet is never read before Devnet verification', async () => {
  let read = false;
  await assert.rejects(prepareAcceptancePayer({
    connection: { getGenesisHash: async () => 'wrong-network' },
    walletFile: '/test/never-read.json',
    readWalletFile: async () => { read = true; throw new Error('Keyfile must not be read'); },
  }), /not Solana Devnet/);
  assert.equal(read, false);
});

test('prefunded explicit payer uses finalized funding without requesting faucet SOL', async () => {
  const key = Keypair.generate();
  const calls = [];
  const prepared = await prepareAcceptancePayer({
    connection: {
      getGenesisHash: async () => { calls.push('genesis'); return DEVNET_GENESIS; },
      getBalance: async (address, commitment) => { calls.push('balance'); assert(address.equals(key.publicKey)); assert.equal(commitment, 'finalized'); return 500_000_000; },
      requestAirdrop: async () => { throw new Error('Prefunded mode must never request an airdrop'); },
    },
    walletFile: '/test/creator.json',
    readWalletFile: async path => { calls.push('read'); assert.equal(path, resolve('/test/creator.json')); return JSON.stringify(Array.from(key.secretKey)); },
  });
  assert.deepEqual(calls, ['genesis', 'read', 'balance']);
  assert(prepared.payer.publicKey.equals(key.publicKey));
  assert.equal(prepared.prefunded, true);
  assert.equal(prepared.source, 'explicit-test-wallet');
  assert.equal(prepared.balanceLamports, 500_000_000);
});

test('underfunded explicit payer fails without a faucet fallback', async () => {
  const key = Keypair.generate();
  await assert.rejects(prepareAcceptancePayer({
    connection: { getGenesisHash: async () => DEVNET_GENESIS, getBalance: async () => 99_999_999, requestAirdrop: async () => assert.fail('No faucet fallback allowed') },
    walletFile: '/test/creator.json',
    readWalletFile: async () => JSON.stringify(Array.from(key.secretKey)),
  }), /at least 0.1 finalized Devnet SOL/);
});

test('malformed keyfile errors do not expose secret contents', async () => {
  await assert.rejects(prepareAcceptancePayer({
    connection: { getGenesisHash: async () => DEVNET_GENESIS },
    walletFile: '/test/creator.json',
    readWalletFile: async () => 'sensitive-key-material-malformed-json',
  }), error => /valid 64-byte Solana keypair/.test(error.message) && !error.message.includes('sensitive-key-material'));
});

test('read-only acceptance refuses an explicit wallet', async () => {
  await assert.rejects(runAcceptance({ execute: false, walletFile: '/test/creator.json' }), /only with --execute/);
});

test('manual funding mode only accepts an in-memory execution wallet', async () => {
  await assert.rejects(runAcceptance({ execute: false, manualFundingWaitSeconds: 1 }), /requires --execute with an ephemeral payer/);
  await assert.rejects(runAcceptance({ execute: true, walletFile: '/test/creator.json', manualFundingWaitSeconds: 1 }), /requires --execute with an ephemeral payer/);
  await assert.rejects(runAcceptance({ execute: true, manualFundingWaitSeconds: 901 }), /between 0 and 900 seconds/);
});

const V3_CONFIG = { ready:true, cluster:'devnet', programId:'9H1r2nTZs6gQaheYTMaBWpH12JX6dCFj2Rvxg7Lno2Sm', initialAuthority:'7epA9KQ5wkwo5wZ5kcY8CfVUvpwVJoAMz2RNqt2ZwK5Y',
  protocolSplit:{ operationsPercent:40, referralLevelPercents:[3,1.25,0.75], communityPercent:20, buybackPercent:25, agencyPercent:10 },
  agency:{ version:'marketing-agency-v1', configRevision:'10' }, reasons:[] };
function v3Fetch(overrides = {}) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const path = new URL(url).pathname; calls.push({ path, method:init.method || 'GET', origin:init.headers?.origin, body:init.body });
    const payer = init.body ? JSON.parse(init.body).payer : null;
    const bodies = { '/api/v3-launch-config':V3_CONFIG,
      '/api/launch-reserve-config':{ cluster:'devnet', authority:V3_CONFIG.initialAuthority, programId:V3_CONFIG.programId, lookupTable:'FqrcLjTPoiMQkhuTF9cg3X8tvPX6RVp1Dpb8XSeyghUW' },
      '/api/service-fees':{ cluster:'devnet', hash:'a'.repeat(64) },
      '/api/launch-service-quote':{ id:'launch_service_1_ffffffffffffffff', payer, policyHash:'a'.repeat(64), amountLamports:'20000000' }, ...overrides };
    const body = bodies[path];
    return new Response(JSON.stringify(body ?? {}), { status: body ? 200 : 404 });
  };
  return { calls, fetchImpl };
}

test('V3 launch inputs come from the live app config, with the app origin on the quote POST', async () => {
  const payer = Keypair.generate().publicKey;
  const { calls, fetchImpl } = v3Fetch();
  const inputs = await loadV3LaunchInputs({ appOrigin:'https://funded.vip', payer, fetchImpl });
  assert.equal(inputs.v3FeeRouter.programId, V3_CONFIG.programId);
  assert.deepEqual(inputs.v3FeeRouter.split, V3_CONFIG.protocolSplit);
  assert.equal(inputs.v3FeeRouter.agency.configRevision, '10');
  assert(Array.isArray(inputs.v3FeeRouter.agency.selectedAgents) && !inputs.v3FeeRouter.agency.selectedAgents.includes('x-promotion'));
  const quote = calls.find(call => call.path === '/api/launch-service-quote');
  assert.equal(quote.method, 'POST');
  assert.equal(quote.origin, 'https://funded.vip');
  assert.deepEqual(JSON.parse(quote.body), { payer:payer.toBase58(), expectedHash:'a'.repeat(64) });
});

test('V3 launch inputs stop when launches are not ready or the reserve program differs', async () => {
  const payer = Keypair.generate().publicKey;
  await assert.rejects(loadV3LaunchInputs({ appOrigin:'https://funded.vip', payer,
    fetchImpl:v3Fetch({ '/api/v3-launch-config':{ ...V3_CONFIG, ready:false, reasons:['paused'] } }).fetchImpl }), /not ready: paused/);
  await assert.rejects(loadV3LaunchInputs({ appOrigin:'https://funded.vip', payer,
    fetchImpl:v3Fetch({ '/api/launch-reserve-config':{ cluster:'devnet', programId:Keypair.generate().publicKey.toBase58(), lookupTable:'x' } }).fetchImpl }), /Reserve program differs/);
});

test('paid QA packages select promotion and reject mismatches before any RPC or wallet use', async () => {
  const { v3FeeRouter } = await loadV3LaunchInputs({ appOrigin:'https://funded.vip',
    payer:Keypair.generate().publicKey, promotion:true, fetchImpl:v3Fetch().fetchImpl });
  assert.deepEqual(v3FeeRouter.agency.selectedAgents,['x-promotion','buyback-100k','buyback-300k']);
  await assert.rejects(submitPumpDevnetLaunch({ useMintRouter:true, v3FeeRouter, launchBurn:null }), /match the launch package before signing/);
  v3FeeRouter.agency.selectedAgents = ['buyback-100k','buyback-300k'];
  await assert.rejects(submitPumpDevnetLaunch({ useMintRouter:true, v3FeeRouter, launchBurn:{tier:'pro',amountTokens:1} }), /match the launch package before signing/);
});

test('keypair provider signs legacy launch steps without replacing existing signatures', async () => {
  const payer = Keypair.generate(), mint = Keypair.generate();
  const transaction = new Transaction({ feePayer:payer.publicKey, recentBlockhash:'11111111111111111111111111111111' })
    .add(SystemProgram.transfer({ fromPubkey:payer.publicKey, toPubkey:mint.publicKey, lamports:1 }), SystemProgram.transfer({ fromPubkey:mint.publicKey, toPubkey:payer.publicKey, lamports:1 }));
  transaction.partialSign(mint);
  const signed = await keypairProvider(payer).signTransaction(transaction);
  assert(signed.verifySignatures());
});

test('caller-owned ephemeral payer remains in memory across read failures and skips faucet when funded',async()=>{
 const payer=Keypair.generate();let calls=0;
 const connection={getGenesisHash:async()=>DEVNET_GENESIS,getBalance:async()=>{if(++calls===1)throw Error('temporarily unavailable');return 100_000_000;}};
 await assert.rejects(prepareAcceptancePayer({connection,ephemeralPayer:payer}),/temporarily/);
 const result=await prepareAcceptancePayer({connection,ephemeralPayer:payer});
 assert.equal(result.payer,payer);assert.equal(result.prefunded,true);assert.equal(result.source,'ephemeral-memory');
 await assert.rejects(runAcceptance({ephemeralPayer:payer}),/In-memory payer requires/);
});
