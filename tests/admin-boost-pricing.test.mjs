import test from 'node:test';
import assert from 'node:assert/strict';
import {Keypair} from '@solana/web3.js';
import {DEFAULT_BOOST_PRICES,boostUsdCents,validateBoostPrices} from '../boost-pricing.js';
import {boostPricingSnapshot,handleAdminBoostPricing} from '../server/admin-boost-pricing.mjs';
import {createBoostRoutes} from '../server/routes/boost.mjs';
import {validateBoostQuote} from '../boost-checkout-recovery.js';
test('boost prices use exact cents and reject missing, extra, negative and fractional-cent values',()=>{
  assert.equal(boostUsdCents('49.50'),4950);assert.throws(()=>boostUsdCents('49.501'));
  for(const prices of [{...DEFAULT_BOOST_PRICES,'10x':0},{...DEFAULT_BOOST_PRICES,'10x':1.5},{...DEFAULT_BOOST_PRICES,bad:2},{}])
    assert.throws(()=>validateBoostPrices(prices));
});
test('admin boost changes are revision-checked and new quotes use them without repricing issued quotes',async()=>{
  const state={},store={read:async()=>state,update:async fn=>fn(state),chargeRpcRate:async()=>true};let response,seq=0;
  const origin='https://funded.test',saved={wallet:process.env.FUNDED_BOOST_PAYMENT_WALLET,origin:process.env.CORS_ORIGIN};
  process.env.FUNDED_BOOST_PAYMENT_WALLET=Keypair.generate().publicKey.toBase58();process.env.CORS_ORIGIN=origin;
  const mint=Keypair.generate().publicKey.toBase58(),payer=Keypair.generate().publicKey.toBase58();state.launches={[mint]:{cluster:'devnet',onchainVerified:true}};
  const publicRoute=createBoostRoutes({store,solanaCluster:'devnet',boostPurchasesEnabled:true,clientKey:()=> 'test',body:async req=>req.input,
    readSolUsdQuote:async()=>({priceUsd:100,fetchedAt:new Date().toISOString()}),id:()=>`boost_${Date.now()}_${String(++seq).padStart(16,'0')}`,
    respond:(_res,status,data)=>{response={status,data};}});
  const quote=async()=>{await publicRoute({method:'POST',headers:{origin},input:{mint,payer,packageId:'10x',paymentProtocol:'journal-v1'}},{},new URL(origin+'/api/boosts/quote'));assert.equal(response.status,201);return response.data;};
  try{
    const old=await quote(),snapshot=boostPricingSnapshot(state),prices={...snapshot.prices,'10x':1234};
    const input={prices,expectedRevision:snapshot.revision,expectedHash:snapshot.hash,reason:'Update boost pricing for test'};
    const update=async()=>handleAdminBoostPricing({req:{method:'POST'},res:{},url:new URL(origin+'/api/admin/boost-prices'),store,body:async()=>input,
      session:{wallet:payer},json:(_res,status,data)=>{response={status,data};return true;}});
    await update();assert.equal(response.status,200);assert.equal(response.data.revision,1);
    await update();assert.equal(response.status,409);
    const current=await quote();assert.equal(current.usd,12.34);assert.equal(current.pricingRevision,1);
    const pricing=boostPricingSnapshot(state);
    assert.equal(validateBoostQuote(current,{mint,payer,packageId:'10x',pricing}),current);
    assert.throws(()=>validateBoostQuote(current,{mint,payer,packageId:'10x',pricing:snapshot}));
    assert.equal(validateBoostQuote(old,{mint,payer,packageId:'10x',reviewedQuote:{...old}}),old);
    assert.throws(()=>validateBoostQuote({...current,lamports:current.lamports+1},{mint,payer,packageId:'10x',pricing}));
    assert.throws(()=>validateBoostQuote({...current,recipient:payer},{mint,payer,packageId:'10x',reviewedQuote:current}));
    assert.equal(old.usd,49.5);assert.equal(state.boostQuotes[old.id].lamports,old.lamports);assert.equal(state.boostQuotes[old.id].usd,49.5);
  }finally{if(saved.wallet===undefined)delete process.env.FUNDED_BOOST_PAYMENT_WALLET;else process.env.FUNDED_BOOST_PAYMENT_WALLET=saved.wallet;
    if(saved.origin===undefined)delete process.env.CORS_ORIGIN;else process.env.CORS_ORIGIN=saved.origin;}
});
