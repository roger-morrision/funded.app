import test from 'node:test';
import assert from 'node:assert/strict';
import {buybackProgressTable} from '../src/features/marketing/buyback-progress.js';
import {createMarketingAgencyRoutes} from '../server/routes/marketing-agency.mjs';
import {agencyMilestoneProgress} from '../src/features/marketing/agency-token-table.js';
import {createAgencyProgressReader} from '../server/agency-progress.mjs';
import {Keypair} from '@solana/web3.js';
import {SOLANA_GENESIS} from '../solana-network.js';
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
test('milestone percentages use saved targets and never imply execution; stale prices are withheld',()=>{
  const market={targets:[100000,300000],marketCapUsd:85000,checkedAt:new Date().toISOString(),completedMask:0};
  assert.match(agencyMilestoneProgress(market,0),/85.00%.*near milestone/);
  assert.match(agencyMilestoneProgress(market,1),/28.33%/);
  assert.match(agencyMilestoneProgress({...market,marketCapUsd:100001},0),/target reached/);
  assert.equal(agencyMilestoneProgress({...market,completedMask:2},0),'Completed');
  assert.match(agencyMilestoneProgress({...market,checkedAt:'2000-01-01'},0),/market cap unavailable/);
});
test('progress reader uses finalized saved policy and fresh market quote, caches reads, and rejects wrong network',async()=>{
  const key=()=>Keypair.generate().publicKey.toBase58(),programId=key(),token=key();let reads=0,network=SOLANA_GENESIS.devnet;
  const connection={getGenesisHash:async()=>network,getMultipleAccountsInfoAndContext:async()=>{reads++;return {context:{slot:10},value:[{}]};}};
  const read=createAgencyProgressReader({connection,env:{FUNDED_V3_FEE_ROUTER_PROGRAM_ID:programId},decode:()=>({rules:{marketCapUsd:[123000,345000]},completedMask:0}),
    readSolUsd:async()=>({priceUsd:100,fetchedAt:new Date().toISOString()}),readMarketCaps:async()=>({[token]:{marketCapSol:1000,observedAt:new Date().toISOString()}})});
  const state={launches:{[token]:{mint:token,onchainVerified:true,cluster:'devnet',creatorWallet:key(),marketingAgency:{selectedAgents:['buyback-100k','buyback-300k']},
    pumpFeeRoute:{programId,initialAuthority:key(),protocolSplit:{operationsPercent:40,referralLevelPercents:[3,1.25,.75],communityPercent:20,buybackPercent:25,agencyPercent:10}}}}};
  const rows=await read(state);assert.equal(rows[0].marketCapUsd,100000);assert.deepEqual(rows[0].targets,[123000,345000]);await read(state);assert.equal(reads,1);
  network=SOLANA_GENESIS['mainnet-beta'];const other=createAgencyProgressReader({connection,env:{FUNDED_V3_FEE_ROUTER_PROGRAM_ID:programId}});assert.deepEqual(await other(state),[]);
});
