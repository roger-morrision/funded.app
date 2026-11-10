import test from 'node:test';
import assert from 'node:assert/strict';
import {buybackProgressTable} from '../src/features/marketing/buyback-progress.js';
import {createMarketingAgencyRoutes} from '../server/routes/marketing-agency.mjs';
const mint='11111111111111111111111111111111',program='22222222222222222222222222222222';
test('paused agency retains registered token identities without claiming readiness or inventing balances',async()=>{
  let result;const handle=createMarketingAgencyRoutes({env:{FUNDED_V3_FEE_ROUTER_PROGRAM_ID:program,FUNDED_V3_AGENCY_ENABLED:'false'},
    store:{read:async()=>({launches:{[mint]:{mint,symbol:'CAT',cluster:'devnet',onchainVerified:true,pumpFeeRoute:{programId:program,protocolSplit:{agencyPercent:10}}}}})},respond:(_r,_s,d)=>result=d});
  await handle({method:'GET'},{},new URL('https://richpad.fun/api/marketing-agency'));
  assert.equal(result.launches.length,1);assert.equal(result.launches[0].symbol,'CAT');assert.equal(result.launches[0].status,'awaiting-fresh-finalized-snapshot');
  assert.notEqual(result.active,true);assert.equal(result.funding.collectedLamports,null);assert(result.agents.every(a=>!a.enabled));
});
test('buyback progress distinguishes verified zero, near threshold, and unavailable custody',()=>{
  const render=vault=>buybackProgressTable({dashboard:{thresholdLamports:'5000000000',vaults:[{mint,...vault}]}},[{mint,symbol:'CAT'}]);
  assert.match(render({status:'verified',pendingLamports:'4000000000'}),/80.00%[\s\S]*Near funding threshold/);
  assert.match(render({status:'verified',pendingLamports:'0'}),/No funds accumulated/);
  const unknown=render({status:'unavailable',pendingLamports:'4999999999'});assert.match(unknown,/Awaiting verification/);assert.doesNotMatch(unknown,/4.999999999|Near funding threshold/);
  assert.match(unknown,/\$CAT/);
});
