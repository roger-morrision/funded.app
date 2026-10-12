import assert from 'node:assert/strict';
import test from 'node:test';
import { createRewardFundingProcessor } from '../server/reward-funding-processor.mjs';
import { CreatorSignatureRequiredError } from '../server/mint-router-payout.mjs';

test('unsigned funding is parked; finalized signed holder, operations and community receipts are reconciled once', async () => {
  const state = { fundingRequests:{
    unsigned:{ id:'unsigned', mint:'mint', asset:'SOL', kind:'holder', amount:'10', status:'pending' },
    holder:{ id:'holder', mint:'mint', asset:'SOL', kind:'holder', amount:'20', status:'funding',
      approvedCreator:'creator', fundingSignature:'holder-signature' },
    operations:{ id:'operations', mint:'mint', asset:'SOL', kind:'operations', recipient:'operations-wallet',
      amount:'30', status:'funding', approvedCreator:'creator', fundingSignature:'operations-signature' },
    community:{ id:'community', mint:'mint', asset:'SOL', kind:'community-reserve', recipient:null,
      amount:'40', status:'funding', approvedCreator:'creator', fundingSignature:'community-signature' },
  } };
  const calls = [];
  const store = { transaction:async update=>update(state) };
  const chain = {
    readiness:async()=>({ constrainedPayouts:true }),
    fundSolVaultFromMintRouter:async row=>{
      calls.push(row);
      if (!row.fundingSignature) throw new CreatorSignatureRequiredError();
      return { signature:row.fundingSignature, claim:`claim:${row.fundingId}`, vault:'vault',
        amount:String(row.amount), balanceDeltaVerified:true };
    },
    fundCommunitySolVaultFromMintRouter:async row=>{
      calls.push(row);
      return { signature:row.fundingSignature, claim:`claim:${row.fundingId}`, vault:'reserve',
        amount:String(row.amount), balanceDeltaVerified:true };
    },
  };
  const scheduler = { recordFundedPool:async row=>({ id:`pool:${row.id}` }),
    recordDirectFunded:async row=>({ id:`direct:${row.id}` }) };
  const processor = createRewardFundingProcessor({ store, chain, scheduler });
  assert.deepEqual(await processor.processPending(), { status:'processed', pending:4, funded:3 });
  assert.equal(state.fundingRequests.unsigned.status, 'awaiting-creator-signature');
  for (const id of ['holder','operations','community']) {
    assert.equal(state.fundingRequests[id].status, 'funded');
    assert.equal(state.fundingRequests[id].fundingClaim, `claim:${id}`);
    assert.equal(state.fundingRequests[id].balanceDeltaVerified, true);
  }
  assert.deepEqual(calls.map(row => [row.fundingId,row.creator,row.fundingSignature,row.kind || null]), [
    ['unsigned',undefined,undefined,'holder'],
    ['holder','creator','holder-signature','holder'],
    ['operations','creator','operations-signature','operations'],
    ['community','creator','community-signature',null],
  ]);
  assert.deepEqual(await processor.processPending(), { status:'processed', pending:0, funded:0 });
});
