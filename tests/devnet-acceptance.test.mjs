import assert from 'node:assert/strict';
import test from 'node:test';
import { resolve } from 'node:path';
import { Keypair } from '@solana/web3.js';
import { assertDevnet, assertFinalized, DEVNET_GENESIS, prepareAcceptancePayer, runAcceptance } from '../scripts/devnet-acceptance.mjs';

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
