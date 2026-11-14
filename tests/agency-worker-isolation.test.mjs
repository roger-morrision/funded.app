import test from 'node:test';
import assert from 'node:assert/strict';
import { Keypair, PublicKey } from '@solana/web3.js';
import { runAgencyCycle } from '../scripts/run-agency-worker.mjs';

test('one coin that fails custody verification is skipped without blocking the agency worker', async () => {
  const programId = Keypair.generate().publicKey.toBase58(), lookup = Keypair.generate().publicKey, authority = Keypair.generate();
  const [bad, good] = [Keypair.generate().publicKey.toBase58(), Keypair.generate().publicKey.toBase58()].sort();
  const split = { agencyPercent: 10 };
  let state = { launches: { [bad]: { mint: bad, cluster: 'devnet', pumpFeeRoute: { programId, protocolSplit: split } },
    [good]: { mint: good, cluster: 'devnet', pumpFeeRoute: { programId, protocolSplit: split } } }, adminSettings: {} };
  const store = { read: async () => structuredClone(state), update: async fn => { const next = structuredClone(state); fn(next); state = next; } };
  const connection = { getAddressLookupTable: async () => ({ value: { key: new PublicKey(lookup), state: { deactivationSlot: 0xffffffffffffffffn } } }) };
  const context = { slot: 1, policyFingerprint: 'f', remainingLamports: '0', agentRemaining: ['0', '0', '0'],
    policy: { paidLamports: [0n, 0n, 0n, 0n, 0n, 0n, 0n, 5n], withdrawnLamports: Array(8).fill(0n), selectedMask: 6, completedMask: 0, rules: null } };
  const result = await runAgencyCycle({ config: { execute: true, buybacksOnly: true, mintLimit: 5, programId, approvedHash: 'a'.repeat(64), build: 'b'.repeat(40),
    lookupAddress: lookup.toBase58() }, store, outbox: null, connection, authority, publisher: null,
    readDeployment: async () => ({ revision: '12' }),
    readContext: async ({ mint }) => { if (mint === bad) throw new Error('Agency counters contain unverified or unindexed source funding.'); return context; },
    milestone: async ({ mint }) => { if (mint === bad) throw new Error('unverifiable'); return { status: 'below-threshold' }; } });
  assert.equal(result.readinessStatus, 'ready');
  const heartbeat = state.adminSettings.agencyBuybackWorker;
  assert.equal(heartbeat.status, 'ready');
  assert.deepEqual(heartbeat.degradedMints, [bad]);
  assert.ok(state.adminSettings.agencyBudgets[good]);
  assert.equal(state.adminSettings.agencyBudgets[bad], undefined);
});
