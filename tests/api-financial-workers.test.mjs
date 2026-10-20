import test from 'node:test';
import assert from 'node:assert/strict';
import {startApiFinancialWorkers} from '../server/api-financial-workers.mjs';
test('API-only acceptance never starts another payout scheduler and does not change financial gates',()=>{
  const env={FUNDED_API_ONLY:'true',FUNDED_V3_HOLDER_WORKER_ENABLED:'true',FUNDED_V3_AGENCY_NORMAL_FLOWS_ENABLED:'false'},before={...env};
  const unexpected=()=>assert.fail('An API-only process must not start a background financial worker.');
  assert.deepEqual(startApiFinancialWorkers({env,startCommunity:unexpected,startHolder:unexpected,startDailyBonus:unexpected}),{mode:'api-only',started:[]});
  assert.deepEqual(env,before);
});
test('normal startup retains every worker; malformed role settings fail before any scheduler starts',()=>{
  for(const env of [{},{FUNDED_API_ONLY:'false'}]){
    const calls=[];const result=startApiFinancialWorkers({env,startCommunity:()=>calls.push('community'),startHolder:()=>calls.push('holder'),startDailyBonus:()=>calls.push('bonus')});
    assert.deepEqual(calls,['community','holder','bonus']);assert.equal(result.started.length,3);
  }
  let calls=0;assert.throws(()=>startApiFinancialWorkers({env:{FUNDED_API_ONLY:'yes'},startCommunity:()=>calls++,startHolder:()=>calls++,startDailyBonus:()=>calls++}),/true or false/);
  assert.equal(calls,0);
});
