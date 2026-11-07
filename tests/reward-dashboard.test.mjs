import test from 'node:test';
import assert from 'node:assert/strict';
import { rewardDashboardGroup, rewardDashboardSummary } from '../src/features/experience/reward-dashboard-model.js';
import { financialRows } from '../src/features/experience/financial-model.js';
const wallet='11111111111111111111111111111111';
const other='22222222222222222222222222222222';
const record=(id,stage,extra={})=>({id,stage,wallet,...extra});

test('separates recipient receipts, manual reviews, automatic work and waiting allocations',()=>{
  const rows=[record('paid:holder:one','Verified'),record('approval','Awaiting approval',{ready:true}),
    record('automatic','Processing',{automatic:true}),record('uncertain','Processing'),
    record('funded','Funded'),record('blocked','Awaiting approval',{ready:false}),record('locked','Locked'),
    record('other','Verified',{wallet:other}),{id:'burned:one',stage:'Verified'}];
  const result=rewardDashboardSummary(rows,wallet);
  assert.deepEqual(Object.fromEntries(Object.entries(result.groups).map(([key,rows])=>[key,rows.map(row=>row.id)])),{
    action:['approval','uncertain'],automatic:['automatic'],received:['paid:holder:one'],waiting:['funded','blocked','locked']});
});
test('duplicate receipts count once and wallet switches do not retain personal rows',()=>{
  const receipt=record('paid:one','Verified');
  assert.equal(rewardDashboardSummary([receipt,receipt],wallet).count('received'),'1');
  assert.equal(rewardDashboardSummary([receipt],other).count('received'),'0');
  assert.equal(rewardDashboardGroup(receipt,''),null);
});
test('missing, partial and loading evidence never presents unknown counts as zero',()=>{
  const result=rewardDashboardSummary([record('paid:one','Verified')],wallet,{missing:['rewards']});
  assert.equal(result.count('received'),'1+');assert.equal(result.count('automatic'),'Unavailable');
  assert.equal(rewardDashboardSummary([],wallet,{checking:true}).count('received'),'Checking…');
  assert.equal(rewardDashboardSummary([],wallet,{missing:['buybacks']}).count('received'),'0');
  assert.equal(rewardDashboardSummary([],wallet,{missing:['additional creator launches']}).state,'partial');
});
test('disconnected state hides counts even if previous wallet records remain in memory',()=>{
  const result=rewardDashboardSummary([record('paid:one','Verified')],'');
  assert.equal(result.state,'disconnected');assert.equal(result.groups.received.length,0);
  assert.equal(result.count('received'),'—');
});
test('financial projection identifies automatic settlement explicitly and excludes unverified payouts',()=>{
  const overview={available:true,scope:'per-mint-v3',creatorWallet:wallet,mint:other,
    automaticSettlementEnabled:true,collections:[{signature:'collection',settlement:'pending',amountLamports:'1000'}]};
  const rows=financialRows({overviews:[overview],wallet});
  assert.equal(rows.length,1);assert.equal(rewardDashboardGroup(rows[0],wallet),'automatic');
  overview.automaticSettlementEnabled=false;overview.gates={settlement:true};
  assert.equal(rewardDashboardGroup(financialRows({overviews:[overview],wallet})[0],wallet),'action');
  const experience={cluster:'devnet',evidence:{status:'recorded-finalized-v3'},wallet:{address:wallet,rows:[{mint:other,payouts:[{wallet,kind:'holder',signature:'3'.repeat(64),amountLamports:'10',feeSourceVerified:false}]}]}};
  assert.equal(financialRows({experience,wallet}).length,0);
});
