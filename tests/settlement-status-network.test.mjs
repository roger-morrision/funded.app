import test from 'node:test';
import assert from 'node:assert/strict';
import {createSettlementStatusReader} from '../server/settlement-status-reader.mjs';

for (const cluster of ['devnet','mainnet-beta']) test(`status evidence uses only ${cluster} collections`, async () => {
  const inputs = [];
  const read = createSettlementStatusReader({readSnapshot:async () => ({identity:{cluster},state:{collections:{
    dev:{scope:'per-mint-v3',cluster:'devnet',signature:'dev',mint:'dev-mint'},
    main:{scope:'per-mint-v3',cluster:'mainnet-beta',signature:'main',mint:'main-mint'},
  }}}), verify:async input => {
    inputs.push(input);
    return {scope:'all-recorded-v3-collections',verified:false,recorded:input.recorded,checked:0,reason:'approved-program-unverified'};
  }});
  const result = await read({cluster});
  assert.equal(inputs.length,1);
  assert.equal(inputs[0].recorded,1);
  assert.deepEqual(Object.values(inputs[0].state.collections).map(row => row.cluster),[cluster]);
  assert.equal(result.verified,false); // Network selection cannot approve a release.
});

test('missing status network fails closed without invoking a verifier', async () => {
  let calls=0;
  const read=createSettlementStatusReader({readSnapshot:async()=>({identity:{},state:{}}),verify:async()=>{calls++;}});
  assert.equal((await read({})).verified,false);
  assert.equal(calls,0);
});
