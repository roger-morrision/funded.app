import assert from 'node:assert/strict';
import test from 'node:test';
import { verifiedTokenFundingDeltas } from '../server/automatic-reward-chain.mjs';
import { createRewardFundingProcessor } from '../server/reward-funding-processor.mjs';

test('fee-bearing vault transfer records the verified net amount', () => {
  assert.equal(verifiedTokenFundingDeltas({ sourceBefore: 1_000n, sourceAfter: 900n,
    vaultBefore: 50n, vaultAfter: 148n, requestedAmount: 100n }), '98');
  assert.throws(() => verifiedTokenFundingDeltas({ sourceBefore: 1_000n, sourceAfter: 900n,
    vaultBefore: 50n, vaultAfter: 50n, requestedAmount: 100n }), /positive net receipt/);
  assert.throws(() => verifiedTokenFundingDeltas({ sourceBefore: 1_000n, sourceAfter: 901n,
    vaultBefore: 50n, vaultAfter: 148n, requestedAmount: 100n }), /gross debit/);
});

test('funding processor schedules and records only net token receipt', async () => {
  const state = { fundingRequests: { fee: { id:'fee', status:'pending', kind:'holder', mint:'mint',
    asset:'token', amount:'100', decimals:6 } } };
  const store = { transaction: async fn => fn(state) };
  let scheduled;
  const scheduler = { recordFundedPool: async row => { scheduled = row; return { id:'pool' }; } };
  const chain = { readiness: async () => ({ constrainedPayouts:true }),
    fundTokenVault: async () => ({ amount:'98', grossAmount:'100', signature:'finalized-signature', balanceDeltaVerified:true }) };
  const result = await createRewardFundingProcessor({ store, chain, scheduler }).processPending();
  assert.equal(result.funded, 1);
  assert.equal(scheduled.amount, '98');
  assert.equal(state.fundingRequests.fee.fundedAmount, '98');
  assert.equal(state.fundingRequests.fee.grossAmount, '100');
});

test('interrupted token funding is held for reconciliation instead of transferred again', async () => {
  const state = { fundingRequests: { uncertain: { id:'uncertain', status:'funding', kind:'holder',
    mint:'mint', asset:'token', amount:'100', decimals:6 } } };
  let transfers = 0;
  const processor = createRewardFundingProcessor({
    store: { transaction: async fn => fn(state) },
    chain: { readiness: async () => ({ constrainedPayouts:true }),
      fundTokenVault: async () => { transfers++; throw new Error('must not retry'); } },
    scheduler: {},
  });
  assert.deepEqual(await processor.processPending(), { status:'processed', pending:0, funded:0 });
  assert.equal(transfers, 0);
  assert.equal(state.fundingRequests.uncertain.status, 'funding');
});
