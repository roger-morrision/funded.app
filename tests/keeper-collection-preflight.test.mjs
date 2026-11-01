import test from 'node:test';
import assert from 'node:assert/strict';
import {Keypair} from '@solana/web3.js';
import {createKeeperCollectionRoutes} from '../server/routes/keeper-collection.mjs';

test('keeper retries only proven pre-submission failures and preserves uncertain collection locks',async()=>{
  for(const proven of [true,false]){
    const mint=Keypair.generate().publicKey.toBase58(),state={launches:{[mint]:{pumpFeeRoute:{scope:'per-mint-v3'}}},collections:{},alerts:{}};
    let calls=0,result;
    const route=createKeeperCollectionRoutes({requireAuthorized:()=>true,body:async()=>({mint}),solanaCluster:'devnet',
      env:{},store:{readLaunch:async()=>state.launches[mint],update:async fn=>fn(state)},
      collectPumpCreatorFees:async()=>{calls++;if(calls===1)throw Object.assign(new Error('RPC unavailable'),
        proven?{code:'V3_COLLECTION_PREFLIGHT_UNAVAILABLE',transactionSubmitted:false}:{});
        return{status:'collected',onchainVerified:true,signature:'verified-collection',mint};},
      respond:(_res,status,data)=>{result={status,data};}});
    const req={method:'POST'},url=new URL('http://localhost/api/keeper/collect');
    await assert.rejects(route(req,{},url),/RPC unavailable/);
    assert.equal(state.alerts['fee-collect:'+mint].status,proven?'retryable-before-submission':'review-required');
    await route(req,{},url);
    assert.equal(calls,proven?2:1);assert.equal(result.status,proven?200:409);
  }
});
