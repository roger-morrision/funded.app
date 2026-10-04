import assert from 'node:assert/strict';
import test from 'node:test';
import { assertDevnet, assertFinalized, DEVNET_GENESIS, runAcceptance } from '../scripts/devnet-acceptance.mjs';

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
  const result = await runAcceptance({ execute: true });
  assert.equal(result.status, 'blocked');
  assert.deepEqual(requests, ['getGenesisHash']);
  assert.equal(result.transactions.length, 0);
  assert.equal(result.wallets, undefined);
  assert.equal(result.coverage.fullApplicationJourney, false);
});
