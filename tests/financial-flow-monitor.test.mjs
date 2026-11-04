import test from 'node:test';
import assert from 'node:assert/strict';
import {financialFlowMonitor} from '../server/financial-flow-monitor.mjs';
test('monitor distinguishes approvals, funded pools and overdue prepared payouts without claiming payment',()=>{
 const state={launches:{mint:{onchainVerified:true,pumpFeeRoute:{programId:'program'}}},collections:{source:{signature:'source',mint:'mint',cluster:'devnet',scope:'per-mint-v3',onchainVerified:true,programId:'program'}},
 v3Settlements:{source:{status:'finalized',allocationPlan:{status:'allocated-not-funded',creatorDirected:{walletLamports:'10',holderLamports:'20',xLamports:'0'},protocol:{communityLamports:'30',operationsLamports:'40',buybackLamports:'99'}}}},
 v3CommunityFunding:{source:{status:'finalized',balanceDeltaVerified:true}}};
 const result=financialFlowMonitor(state,{schedules:{s:{id:'s',mint:'mint',status:'prepared',payoutAt:1}}},{now:700000,programId:'program'});
 assert.equal(result.flows.find(f=>f.kind==='creator').stage,'awaiting-creator-approval');
 assert.equal(result.flows.find(f=>f.kind==='bonus').stage,'funded');
 assert.equal(result.flows.find(f=>f.kind==='buyback').stage,'below-minimum-order');
 assert.equal(result.alerts[0].code,'funded-payout-overdue');assert.equal(result.status,'attention-required');
});
