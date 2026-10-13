import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildCreatorSupport, createCreatorSupportHandler } from '../server/creator-support.mjs';
import { createStore } from '../server/store.mjs';

const mint='5'.repeat(44), router='2'.repeat(44), wallet='4'.repeat(44);
const source='3'.repeat(64), payout='6'.repeat(64), id='123';
const fixture=()=>({ launches:{ [mint]:{ mint, cluster:'devnet', onchainVerified:true,
  policySignature:'signed-fixture', xUserId:id, creator:router, creatorWallet:wallet,
  pumpFeeRoute:{verified:true,scope:'per-mint-v3',router}, name:'Fixture',symbol:'QA',
  feeDistribution:{creatorDirected:{shares:{solClaimPercent:5},recipients:{xAccount:'@fixture'}}} } },
  collections:{ [source]:{ signature:source,mint,scope:'per-mint-v3',status:'collected',
    onchainVerified:true } },
  v3Settlements:{ [source]:{ status:'finalized',mint,allocationPlan:{
    status:'allocated-not-funded',creatorDirected:{xLamports:'80000000',holderLamports:'20000000'} } } },
  v3CreatorRewardFunding:{ [source]:{status:'finalized',mint,amount:'100000000',
    signature:source,balanceDeltaVerified:true} },
  v3XClaims:{ [source]:{mint,xUserId:id,status:'paid',wallet,amountLamports:'80000000',
    fundingSignature:source,payment:{signature:payout,amount:'80000000',
      finalized:true,balanceDeltaVerified:true}} },creatorProfiles:{} });

const state=fixture();
assert.equal(buildCreatorSupport(state,id,null,'devnet').paidLamports,'80000000');
const tampered=fixture();tampered.v3XClaims[source].payment.balanceDeltaVerified=false;
assert.equal(buildCreatorSupport(tampered,id,null,'devnet').paidLamports,'0');
const dir=await mkdtemp(join(tmpdir(),'funded-v3-creator-'));
let server;
try {
  const store=createStore(join(dir,'state.json'),'');
  await store.update(current=>Object.assign(current,fixture()));
  const handler=createCreatorSupportHandler({store,cluster:'devnet',getSession:async()=>null,
    readEvidence:async()=>({status:'unavailable'}),capabilities:async()=>({})});
  server=createServer(async(req,res)=>{try{if(!await handler(req,res,new URL(req.url,'http://localhost'))){
    res.writeHead(404);res.end();}}catch(error){res.writeHead(500);res.end(error.message);}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base='http://127.0.0.1:'+server.address().port;
  const get=path=>fetch(base+path);
  assert.equal((await(await get('/api/creators')).json()).creators.length,1);
  const profile=await(await get('/api/creators/'+id)).json();
  assert.equal(profile.paidLamports,'80000000');
  assert.equal(profile.receipts[0].signature,payout);
  assert.equal((await get('/api/creators/'+id+'/receipts')).status,410);
  assert.equal((await get('/api/creators/'+id+'/card.png?receipt='+payout)).status,200);
  await store.update(current=>{current.v3XClaims[source].payment.finalized=false;});
  assert.equal((await get('/api/creators/'+id+'/card.png?receipt='+payout)).status,404);
  await store.update(current=>{current.creatorProfiles[id]={id,optedOut:true};});
  assert.equal((await get('/api/creators/'+id)).status,404);
  console.log('V3 creator support profile, finalized receipt, retired history, and opt-out checks passed.');
} finally {
  if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
  await rm(dir,{recursive:true,force:true});
}