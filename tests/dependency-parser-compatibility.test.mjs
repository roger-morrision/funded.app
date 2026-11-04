import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { Connection, PublicKey } from '@solana/web3.js';

// Exercise dependencies through Anchor's parser and Solana's HTTP RPC client.
// The application does not use Jayson's TCP/TLS framing API.
const require = createRequire(import.meta.url);
const anchorRequire = createRequire(require.resolve('@coral-xyz/anchor'));
const toml = anchorRequire('toml');

test('Anchor TOML dependency preserves program and provider configuration', () => {
  const config = toml.parse('[provider]\ncluster = "devnet"\n[programs.devnet]\nexample = "11111111111111111111111111111111"\n');
  assert.equal(config.provider.cluster, 'devnet');
  assert.equal(config.programs.devnet.example, '11111111111111111111111111111111');
  assert.throws(() => toml.parse('[provider]\ncluster = "devnet"\ncluster = "mainnet"\n'));
});

test('Solana HTTP RPC generates IDs and decodes finalized balance responses', async () => {
  const requests = [];
  const connection = new Connection('http://127.0.0.1:8899', { fetch: async (_url, init) => {
    const request = JSON.parse(init.body); requests.push(request);
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: { context: { slot: 123 }, value: 456 } }));
  } });
  assert.equal(await connection.getBalance(PublicKey.default, 'finalized'), 456);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].method, 'getBalance');
  assert.equal(requests[0].params[1].commitment, 'finalized');
  assert.equal(typeof requests[0].id, 'string');
  assert(requests[0].id.length > 0);
});

test('Solana HTTP RPC propagates error responses without inventing a balance', async () => {
  const connection = new Connection('http://127.0.0.1:8899', { fetch: async (_url, init) => {
    const request = JSON.parse(init.body);
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: request.id, error: { code: -32603, message: 'RPC unavailable' } }));
  } });
  await assert.rejects(connection.getBalance(PublicKey.default), /RPC unavailable/);
});
