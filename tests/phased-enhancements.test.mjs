import test from 'node:test';
import assert from 'node:assert/strict';
import { createDirectoryRoutes } from '../server/routes/directory.mjs';
import { Connection } from '@solana/web3.js';
import { rememberMarketFacts, marketFacts, marketFreshness } from '../src/features/explore/market-facts.js';
import { topCallersMarkup, calloutRowMarkup } from '../src/features/callouts/callouts.js';
import { flowTimingSummary, recordFlowTiming } from '../src/features/experience/flow-timing.js';
import { validateIssue } from '../server/routes/product-issues.mjs';
import { proofTotals } from '../src/features/proof/proof-totals.js';
import { createExploreFiltersController } from '../src/app/controllers/explore-filters.js';
const mint = 'APjV65KZhb2AshXJDoHVVatxsGWV4GUEWdU6Q3WZoVMn';

test('included launch is recognized without metadata RPC or a payment quote', async () => {
  let sent, reads=0;
  const handle=createDirectoryRoutes({store:{readLaunch:async()=>({onchainVerified:true,cluster:'devnet',pumpFeeRoute:{scope:'per-mint-v3'},name:'FLOWQA',symbol:'FLOWQA'}),readMetadata:async()=>{reads++;throw Error('offline');}},solanaCluster:'devnet',solanaRpcUrl:'http://127.0.0.1:1',route:()=>null,respond:(_res,status,data)=>{sent={status,data};}});
  await handle({method:'GET'},{},new URL('http://local/api/listings/mint/'+mint));
  assert.equal(reads,0);assert.equal(sent.status,200);assert.equal(sent.data.included,true);assert.equal(sent.data.mint,mint);assert.equal(sent.data.source,'verified-launch-registry');
});
test('unverified or wrong-network registry row cannot bypass listing verification', async()=>{
  const old=Connection.prototype.getGenesisHash;Connection.prototype.getGenesisHash=async()=>{throw Error('RPC unavailable');};
  try{for(const launch of [{onchainVerified:false,cluster:'devnet'},{onchainVerified:true,cluster:'mainnet-beta'}]){
    let sent;const handle=createDirectoryRoutes({store:{readLaunch:async()=>({...launch,pumpFeeRoute:{scope:'per-mint-v3'}})},solanaCluster:'devnet',solanaRpcUrl:'http://127.0.0.1:1',route:()=>null,respond:(_res,status,data)=>{sent={status,data};}});
    await handle({method:'GET'},{},new URL('http://local/api/listings/mint/'+mint));assert.equal(sent.status,409);assert.notEqual(sent.data.included,true);
  }}finally{Connection.prototype.getGenesisHash=old;}
});
test('last market observation survives registry fallback, stays network scoped, and newer data wins',()=>{
  const prior={address:mint,verifiedAt:'2026-11-04T00:00:00Z',complete:false,curveCapSol:0,source:'Solana RPC'};
  rememberMarketFacts([prior],'devnet');const fallback={address:mint,registryFallback:true};
  assert.equal(marketFacts(fallback).curveCapSol,0);assert.match(marketFreshness(fallback,'devnet',Date.parse('2026-11-04T00:03:00Z')),/Last verified 3m/);
  assert.equal(marketFacts(fallback,'mainnet-beta').complete,undefined);
  const migrated={...prior,verifiedAt:'2026-11-04T00:04:00Z',migrated:true,poolMarketCapSol:8};rememberMarketFacts([migrated],'devnet');
  assert.equal(marketFacts(prior).migrated,true);assert.equal(prior.complete,false);assert.equal(fallback.migrated,undefined);
});
test('one-call rank and falling price distinguish observed peak, current value and sample',()=>{
  assert.match(topCallersMarkup([{author:mint,calls:1,hits:1,avgMultiple:18.528,hitRate:1}]),/18.5x mean peak/);
  assert.match(topCallersMarkup([{author:mint,calls:1,hits:1,avgMultiple:18.528,hitRate:1}]),/1 of 1 calls reached 2x · small sample/);
  const row=calloutRowMarkup({id:'one',mint,author:mint,text:'test',createdAt:'2026-11-04T00:00:00Z',multiple:.5,peakMultiple:3,calledMarketCapSol:10,currentMarketCapSol:5});
  assert.match(row,/-50%/);assert.match(row,/observed peak 3.0x/);
});
test('Explore filters, labels and cap all use the same newer observation without replacing coin metadata',()=>{
  const stale={address:mint,name:'Original name',registryFallback:true,complete:false};
  let passed;
  const controller=createExploreFiltersController({EXPLORE_CLUSTER:'devnet',coinSolUsdPrice:2,exploreTab:'trending',
    filterMarketRecords:rows=>{passed=rows;return rows;},exploreFilterOptions:()=>({}),formatDashboardUsd:amount=>`$${amount}`,verifiedPaidListingPayment:()=>null});
  assert.equal(controller.filterExploreTabRecords([stale])[0].name,'Original name');
  assert.equal(passed[0].migrated,true);
  assert.equal(controller.exploreStageLabel(stale),'Migrated');assert.equal(controller.exploreMarketCapUsd(stale),'$16');
  assert.equal(stale.migrated,undefined);
});
test('timing groups keep unavailable and pending separate from latency percentiles',()=>{
  const rows=[10,20,30,40,100].map((ms,i)=>({flow:'quote',temperature:'cold',ms,outcome:i===4?'unavailable':'available'}));
  assert.deepEqual(flowTimingSummary(rows),[{key:'quote/cold',samples:5,p50:30,p95:100,unavailable:1,pending:0}]);
  for(let i=0;i<210;i++)recordFlowTiming('recovery',i,'pending');assert.equal(flowTimingSummary().find(r=>r.key==='recovery/warm').samples,200);
});
test('support context keeps only approved operation and failure stage',()=>{
  const input={category:'bug',description:'Unable to check this coin',context:{mint,operation:'trade',stage:'recovery',privateKey:'never-store',query:'secret'}};
  const result=validateIssue(input);assert.equal(result.context.operation,'trade');assert.equal(result.context.stage,'recovery');assert.equal(result.context.privateKey,undefined);assert.equal(result.context.query,undefined);
  assert.equal(validateIssue({...input,context:{operation:'secret'}}).context.operation,null);
});
test('burn display separates spent SOL, readable tokens and exact units',()=>{
  const summary={homeFeeAllocations:{protocolBuybacks:{spentLamports:'1000000000',burnedBaseUnits:'99070',count:4}}};
  const row=proofTotals(summary,{decimals:6}).find(r=>r.key==='buyback');assert.equal(row.lamports,1e9);assert.match(row.note,/0.09907 \$FUNDED burned/);assert.match(row.note,/99,070 \$FUNDED base units/);
});
