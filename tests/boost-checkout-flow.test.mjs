import test from 'node:test';
import assert from 'node:assert/strict';
import * as solana from '@solana/web3.js';
import bs58 from 'bs58';
import {Buffer} from 'node:buffer';
import {createBoostCheckoutController} from '../src/app/controllers/boost-checkout.js';
import * as recovery from '../boost-checkout-recovery.js';
import {BOOST_MEMO_PROGRAM,boostMemo,boostLamports} from '../boost-offer.js';
import {pricedBoostPackages,DEFAULT_BOOST_PRICES} from '../boost-pricing.js';

for(const walletAddsPriority of [false,true])test(`changed price and wallet priority=${walletAddsPriority}: failed broadcast survives restart and verified expiry permits another package`,async()=>{
  const payer=solana.Keypair.generate(),recipient=solana.Keypair.generate().publicKey.toBase58(),mint=solana.Keypair.generate().publicKey.toBase58();
  const blockhash=solana.Keypair.generate().publicKey.toBase58(),data=new Map(),events=[],feeMessages=[];
  const storage={getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)};
  const packages=pricedBoostPackages({...DEFAULT_BOOST_PRICES,'10x':1234});
  let sequence=0,expire=false,confirmCalls=0;
  const wallet={publicKey:payer.publicKey,signTransaction:async tx=>{events.push('sign');
    if(walletAddsPriority)tx.instructions.unshift(solana.ComputeBudgetProgram.setComputeUnitLimit({units:100000}),solana.ComputeBudgetProgram.setComputeUnitPrice({microLamports:150000}));
    tx.sign(payer);return solana.Transaction.from(tx.serialize());}};
  const session={address:payer.publicKey.toBase58(),provider:wallet};
  const app={wallet,connectedWalletAddress:session.address,boostCheckout:{mint,packageId:'10x'},verifiedBoosts:{},Buffer,bs58,BOOST_MEMO_PROGRAM,
    captureWalletSession:()=>session,assertWalletSessionCurrent:()=>{},canSignTransactions:()=>true,getSolana:async()=>solana,
    connection:{getLatestBlockhash:async()=>({blockhash,lastValidBlockHeight:200}),getBalance:async()=>10000000000,
      getFeeForMessage:async message=>{feeMessages.push(message);return{value:feeMessages.length===1?5000:20000};},sendRawTransaction:async()=>{events.push('broadcast');throw Error('Preflight rejected');}},
    validateBoostQuote:recovery.validateBoostQuote,boostPaymentResolution:recovery.boostPaymentResolution,
    readPendingBoost:(mint,_storage,scope)=>recovery.readPendingBoost(mint,storage,scope),
    saveSignedBoostPayment:async row=>{events.push('persist');await recovery.saveSignedBoostPayment(row,storage,null);},
    archiveBoostPayment:(pending,proof)=>recovery.archiveBoostPayment(pending,proof,storage),archiveVerifiedBoostFromHistory:()=>false,
    scheduleBoostExpiryRefresh:()=>{},apiRequest:async(path,{body}={})=>{
      if(path.startsWith('/api/boosts?'))return{available:true,data:{packages,pricingRevision:1,history:[],active:{}}};
      if(path==='/api/boosts/prepare'){events.push('prepare');return{available:true,data:{quoteId:body.quoteId,cluster:'devnet',blockhash,expiryUpperBound:200,expiresAt:app.boostCheckout.quote.expiresAt}};}
      if(path==='/api/boosts/quote'){
        events.push('quote');const pack=packages.find(p=>p.id===body.packageId),id=`boost_123_${String(++sequence).padStart(16,'0')}`;
        return{available:true,data:{...pack,id,memo:boostMemo(id),mint,payer:session.address,recipient,packageId:pack.id,cluster:'devnet',
          usd:pack.usd,solUsd:100,lamports:boostLamports(pack.usd,100),pricingRevision:1,paymentProtocol:'journal-v1',
          createdAt:new Date().toISOString(),expiresAt:new Date(Date.now()+300000).toISOString()}};
      }
      assert.equal(path,'/api/boosts/confirm');confirmCalls++;events.push('journal');
      assert.ok(body.signedTransaction);const tx=solana.Transaction.from(Buffer.from(body.signedTransaction,'base64'));assert(tx.verifySignatures());
      return{available:true,data:expire?{status:'expired',signature:body.signature,quoteId:body.quoteId,cluster:'devnet',commitment:'finalized',slot:300,
        blockhash,transactionAbsent:true,expiryUpperBound:200,finalizedBlockHeight:233}
        :{status:'pending',signature:body.signature,quoteId:body.quoteId,journaled:true,broadcastAllowed:true}};
    }};
  const install=()=>{Object.assign(app,createBoostCheckoutController(app));app.renderExploreBoostDialog=()=>{};};
  install();await app.loadExploreBoostHistory(mint);
  await app.handleExploreBoostPay();assert.equal(app.boostCheckout.quote.usd,12.34);assert.deepEqual(events,['quote']);
  await app.handleExploreBoostPay();assert.deepEqual(events,['quote','prepare','sign','persist','journal','broadcast']);
  assert.equal(feeMessages.length,2);
  assert.equal(feeMessages[1].instructions.length,walletAddsPriority?4:2);
  const saved=recovery.readPendingBoost(mint,storage,{payer:session.address});assert.ok(saved.signedTransaction);assert.ok(app.boostCheckout.pendingSignature);
  // A new controller models reload; no wallet prompt or replacement send during recovery.
  app.boostCheckout={mint,packageId:'10x'};install();expire=true;await app.loadExploreBoostHistory(mint);
  await app.handleExploreBoostPay();assert.equal(app.boostCheckout.failureProof.status,'expired');assert.equal(confirmCalls,2);
  assert.equal(events.filter(e=>e==='sign').length,1);assert.equal(events.filter(e=>e==='broadcast').length,1);
  await app.handleExploreBoostPay();assert.equal(recovery.readPendingBoost(mint,storage,{payer:session.address}),null);
  app.boostCheckout.packageId='30x';await app.handleExploreBoostPay();assert.equal(app.boostCheckout.quote.packageId,'30x');
});
