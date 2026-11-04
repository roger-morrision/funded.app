import test from 'node:test';import assert from 'node:assert/strict';
import {linkedReferences,scrubShared,purgeRewardState,containsReference} from '../scripts/devnet-record-purge.mjs';
test('purge follows old receipt links and preserves newer launch and account records',()=>{
  const old='oldMint123456789012345',fresh='newMint123456789012345',signature='oldSignature123456789012345';
  const refs=linkedReferences([{bucket:'collections',entity_key:signature,payload:{mint:old,signature}},
    {bucket:'proof',entity_key:'proof123456789012345',payload:{collectionSignature:signature}}],[old]);
  assert(refs.has(signature));
  assert.deepEqual(scrubShared({wallet:'wallet',mints:[old,fresh],imports:[{mint:old},{mint:fresh}]},refs),
    {wallet:'wallet',mints:[fresh],imports:[{mint:fresh}]});
  const state={version:2,schedules:{old:{mint:old},new:{mint:fresh}},rewardPools:{receipt:{fundingSignature:signature}},
    dailyBonusSnapshots:{old:{sourceMint:old},new:{sourceMint:fresh}},dailyBonusAssignments:{old:{rank:1},new:{rank:2}},
    communityClaimIndex:{drops:[{mint:old},{mint:fresh}]},tradeFinancialWake:{events:{old:{mint:old},new:{mint:fresh}}}};
  const counts=purgeRewardState(state,refs);assert.equal(counts.schedules,1);assert.equal(counts.rewardPools,1);
  assert.deepEqual(state.schedules,{new:{mint:fresh}});assert.deepEqual(state.dailyBonusAssignments,{new:{rank:2}});
  assert.equal(containsReference(state,refs),false);assert.equal(state.version,2);
});
