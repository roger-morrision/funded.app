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

test('signed collection identity survives a lost response and is offered for read-only reconciliation',async()=>{
 const mint=Keypair.generate().publicKey.toBase58(),signature='3'.repeat(88),programId=Keypair.generate().publicKey.toBase58();
 const state={launches:{[mint]:{mint,onchainVerified:true,cluster:'devnet',creator:'router',pumpFeeRoute:{scope:'per-mint-v3',verified:true,router:'router'}}},collections:{},alerts:{}};
 let calls=0,result;
 const route=createKeeperCollectionRoutes({requireAuthorized:()=>true,body:async()=>({mint}),solanaCluster:'devnet',env:{},
  store:{readLaunch:async()=>state.launches[mint],read:async()=>state,update:async fn=>fn(state)},
  collectPumpCreatorFees:async({onSigned})=>{calls++;await onSigned({mint,scope:'per-mint-v3',status:'verification-pending',signature,programId,cluster:'devnet',lastValidBlockHeight:42});throw Error('response lost');},
  respond:(_res,status,data)=>{result={status,data};}});
 await assert.rejects(route({method:'POST'},{},new URL('http://localhost/api/keeper/collect')),/response lost/);
 assert.equal(state.collections[signature].status,'verification-pending');assert.equal(state.alerts['fee-collect:'+mint].signature,signature);
 await route({method:'POST'},{},new URL('http://localhost/api/keeper/collect'));assert.equal(calls,1);assert.equal(result.status,409);
 const original=process.env.FUNDED_V3_COLLECTION_ENABLED;process.env.FUNDED_V3_COLLECTION_ENABLED='true';
 try{await route({method:'GET'},{},new URL('http://localhost/api/keeper/collection-candidates'));
  assert.deepEqual(result.data.pendingV3Collections,[{mint,signature}]);
 }finally{if(original===undefined)delete process.env.FUNDED_V3_COLLECTION_ENABLED;else process.env.FUNDED_V3_COLLECTION_ENABLED=original;}
});

test('a changed collection lock aborts durable identity creation before broadcast',async()=>{
 const mint=Keypair.generate().publicKey.toBase58(),state={launches:{[mint]:{pumpFeeRoute:{scope:'per-mint-v3'}}},collections:{},alerts:{}};
 let broadcast=false;
 const route=createKeeperCollectionRoutes({requireAuthorized:()=>true,body:async()=>({mint}),solanaCluster:'devnet',env:{},
  store:{readLaunch:async()=>state.launches[mint],update:async fn=>fn(state)},respond:()=>{},
  collectPumpCreatorFees:async({onSigned})=>{state.alerts['fee-collect:'+mint].status='review-required';
   await onSigned({mint,scope:'per-mint-v3',status:'verification-pending',signature:'3'.repeat(88),lastValidBlockHeight:42});broadcast=true;}});
 await assert.rejects(route({method:'POST'},{},new URL('http://localhost/api/keeper/collect')),/lock changed/);
 assert.equal(broadcast,false);assert.deepEqual(state.collections,{});
});
