import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {Keypair} from '@solana/web3.js';
import {createRewardStatusRoutes} from '../server/routes/reward-status.mjs';

test('public buyback status follows a pending program check after custody is ready',async()=>{
  const program=Keypair.generate().publicKey,signer=Keypair.generate().publicKey;
  let complete,response;
  const readiness=new Promise(resolve=>{complete=resolve;});
  const now=Date.now(),env={FUNDED_V3_FEE_ROUTER_PROGRAM_ID:String(program),FUNDED_V3_PROGRAM_DATA_SHA256:'a'.repeat(64),
    FUNDED_V3_BUYBACK_ENABLED:'true',FUNDED_DEVNET_BUYBACK_PRICE_SIGNER:String(signer),FUNDED_DEVNET_BUYBACK_PRICE_SIGNER_URL:'https://signer.test/sign'};
  const handle=createRewardStatusRoutes({env,solanaCluster:'devnet',solanaRpcUrl:'https://rpc.test',statusTimeoutMs:5,now:()=>now,
    store:{read:async()=>({})},automaticRewardStore:{read:async()=>({buybackWorkerHeartbeat:{status:'ready',cluster:'devnet',at:new Date(now).toISOString()}})},
    respond:(_res,status,body)=>{response={status,body};},readProgramReadiness:()=>readiness,
    readBuybackDashboard:async()=>({status:'verified',unindexedStatus:'verified',triggerReached:false,collectedLamports:'0',vaults:[],unindexedVaults:[]}),
    connectionFactory:()=>({getGenesisHash:async()=> 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG',getAccountInfo:async()=>({owner:program,
      data:Buffer.concat([createHash('sha256').update('account:BuybackPriceConfig').digest().subarray(0,8),signer.toBuffer()])})})});
  // The route's bounded timer is unref'ed, so retain a test timer until it returns.
  const keepAlive=setTimeout(()=>{},1000);
  try{
    await handle({method:'GET'}, {},new URL('https://richpad.fun/api/buyback/status'));
    assert.equal(response.status,200);assert.equal(response.body.dashboard.status,'verified');
    assert.equal(response.body.refreshing,true);assert.equal(response.body.priceSignerReady,false);
    assert.equal(response.body.executionReady,false);
    complete({ready:true,programId:String(program)});await new Promise(resolve=>setImmediate(resolve));
    await handle({method:'GET'}, {},new URL('https://richpad.fun/api/buyback/status'));
    assert.equal(response.body.refreshing,false);assert.equal(response.body.priceSignerReady,true);
    assert.equal(response.body.executionReady,false,'No funding exists; readiness must not authorize a buyback.');
    assert(response.body.executionReasons.includes('Verified buyback funding is below the execution threshold.'));
  }finally{clearTimeout(keepAlive);}
});
