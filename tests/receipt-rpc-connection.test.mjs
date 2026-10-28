import test from 'node:test';
import assert from 'node:assert/strict';
import { createReceiptRpcConnection } from '../server/receipt-rpc-connection.mjs';
import { createReceiptEvidenceReader } from '../server/receipt-service.mjs';
import { createAnalyticsSummaryReader } from '../server/analytics-summary-reader.mjs';

const genesis = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
const receiptStore = {
  readReceiptCandidates: async () => ({ collections: [], payouts: [], scope: 'global-recent',
    coverage: { recordedCollections: 1, recordedPayouts: 0 } }),
  readReceiptProofs: async () => [],
};

test('the actual SDK makes one read on quota failure and a later usable read can recover', async () => {
  let calls = 0, healthy = false;
  const rpc = createReceiptRpcConnection('https://fixture.invalid', 'finalized', async (_url, options) => {
    calls++;
    assert(options.signal instanceof AbortSignal);
    if (!healthy) return new Response('max usage reached', { status: 429 });
    const { id } = JSON.parse(options.body);
    return Response.json({ jsonrpc: '2.0', id, result: genesis });
  });
  await assert.rejects(rpc.getGenesisHash(), /429/);
  assert.equal(calls, 1, 'Quota failure must not start SDK backoff retries.');
  healthy = true;
  assert.equal(await rpc.getGenesisHash(), genesis);
  assert.equal(calls, 2);
});

test('Analytics completes with unavailable evidence after a real SDK 429 rather than waiting past its deadline', async () => {
  let calls = 0;
  // A recorded candidate is necessary to exercise the RPC identity check.
  const store = { ...receiptStore, readReceiptCandidates: async () => ({
    collections: [{ signature: '4'.repeat(64) }], payouts: [], scope: 'global-recent',
    coverage: { recordedCollections: 1, recordedPayouts: 0 },
  }) };
  const evidence = createReceiptEvidenceReader({ store, cluster: 'devnet', commitment: 'finalized',
    officialGenesis: async () => genesis,
    connectionFactory: () => createReceiptRpcConnection('https://fixture.invalid', 'finalized', async () => {
      calls++; return new Response('max usage reached', { status: 429 });
    }),
  });
  const result = await createAnalyticsSummaryReader([() => ({}), () => ({}), evidence, () => ({})])();
  assert.equal(result.available, true);
  assert.equal(result.values[2].status, 'unavailable');
  assert.deepEqual(result.values[2].verifiedCollections, []);
  assert.equal(calls, 1);
});

test('wrong network and malformed provider replies never become verified evidence', async () => {
  for (const response of [() => new Response('invalid JSON'),
    id => Response.json({ jsonrpc: '2.0', id, result: 'wrong-network' })]) {
    const store = { ...receiptStore, readReceiptCandidates: async () => ({
      collections: [{ signature: '4'.repeat(64) }], payouts: [], scope: 'global-recent',
      coverage: { recordedCollections: 1, recordedPayouts: 0 },
    }) };
    const read = createReceiptEvidenceReader({ store, cluster: 'devnet', commitment: 'finalized',
      officialGenesis: async () => genesis,
      connectionFactory: () => createReceiptRpcConnection('https://fixture.invalid', 'finalized', async (_url, options) => response(JSON.parse(options.body).id)),
    });
    const evidence = await read();
    assert.equal(evidence.status, 'unavailable');
    assert.deepEqual(evidence.verifiedCollections, []);
    assert.deepEqual(evidence.verifiedPayouts, []);
  }
});

test('a stalled provider is aborted before the Analytics response deadline', async t => {
  const keepAlive = setTimeout(() => {}, 7_000);
  t.after(() => clearTimeout(keepAlive));
  let calls = 0, aborted = false;
  const rpc = createReceiptRpcConnection('https://fixture.invalid', 'finalized', (_url, options) => {
    calls++;
    return new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => {
      aborted = true; reject(options.signal.reason);
    }, { once: true }));
  });
  await assert.rejects(rpc.getGenesisHash(), /timed out|timeout/i);
  assert.equal(aborted, true);
  assert.equal(calls, 1);
});
