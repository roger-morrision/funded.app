import test from 'node:test';
import assert from 'node:assert/strict';
import {Connection,Keypair,SystemProgram} from '@solana/web3.js';
import {activeBoosts,boostMemo,boostPackage,BOOST_MEMO_PROGRAM} from '../boost-offer.js';
import {projectBoostReceipts,STACKED_BOOST_POLICY} from '../boost-timeline.js';
import {boostPackageBadgesMarkup} from '../boost-card-badges.js';
import {featuredTokens} from '../src/features/home/featured-data.js';
import {top100Records,rankTop100} from '../src/features/explore/top100-model.js';
import {createBoostRoutes} from '../server/routes/boost.mjs';
import {DEVNET_GENESIS_HASH} from '../server/automatic-reward-chain.mjs';

const hour=3600000,start=Date.parse('2026-11-08T00:00:00Z'),mint=Keypair.generate().publicKey.toBase58();
const receipt=(index,at,packageId='10x',extra={})=>({mint,cluster:'devnet',status:'finalized',packageId,
 multiplier:boostPackage(packageId).multiplier,hours:boostPackage(packageId).hours,durationPolicy:STACKED_BOOST_POLICY,
 signature:String(index+2).repeat(64),quoteId:`boost_${at}_${String(index).padStart(16,'0')}`,slot:index+1,
 startsAt:new Date(at).toISOString(),expiresAt:new Date(at+boostPackage(packageId).hours*hour).toISOString(),...extra});

test('repeat purchases add quantity and hours to remaining time across API, badges and ranking',()=>{
 const receipts=[receipt(0,start),receipt(1,start+7*hour)];
 const saved=JSON.stringify(receipts),at=start+7*hour,boost=activeBoosts(receipts,at)[mint];
 assert.equal(boost.multiplier,20);assert.equal(boost.count,2);
 assert.equal(Date.parse(boost.expiresAt)-at,17*hour);assert.equal(boost.nextExpiry,boost.expiresAt);
 assert.match(boostPackageBadgesMarkup(boost,at),/20x/);
 const rows=top100Records([{address:mint},{address:'B'.repeat(32),marketCapUsd:1000000}],{boosts:{[mint]:boost},now:at});
 assert.equal(rankTop100(rows).rows[0].mint,mint);assert.equal(rows[0].boost,20);
 assert.equal(activeBoosts(receipts,start+20*hour)[mint].multiplier,20);
 assert.deepEqual(activeBoosts(receipts,start+24*hour),{});
 assert.equal(JSON.stringify(receipts),saved);
 assert.ok(projectBoostReceipts(receipts,{now:at}).every(row=>row.expiresAt===boost.expiresAt));
});

test('chain ordering, simultaneous purchases and duplicate receipts cannot shorten or double-extend a boost',()=>{
 const a=receipt(0,start),b=receipt(1,start+hour,'30x'),c=receipt(2,start+hour,'100x');
 const expected=activeBoosts([a,b,c],start+hour)[mint];
 assert.equal(expected.multiplier,140);assert.equal(Date.parse(expected.expiresAt),start+48*hour);
 assert.deepEqual(activeBoosts([c,b,a,b,{...a,signature:'8'.repeat(64)}],start+hour)[mint],expected);
 assert.equal(activeBoosts([a,b,c],start+hour-1)[mint].multiplier,10);
});

test('new purchases extend still-active legacy packs, while expired packs never revive',()=>{
 const old=receipt(0,start,'10x',{durationPolicy:undefined}),expired=receipt(1,start-20*hour,'500x',{durationPolicy:undefined});
 const fresh=receipt(2,start+7*hour,'30x');
 const boost=activeBoosts([old,expired,fresh],start+7*hour)[mint];
 assert.equal(boost.multiplier,40);assert.equal(Date.parse(boost.expiresAt),start+24*hour);
 const after=receipt(3,start+24*hour,'50x');
 const reset=activeBoosts([old,fresh,after],start+24*hour)[mint];
 assert.equal(reset.multiplier,50);assert.equal(reset.count,1);assert.equal(Date.parse(reset.expiresAt),start+36*hour);
 assert.deepEqual(activeBoosts([fresh,{...after,status:'pending'},{...after,cluster:'mainnet-beta'}],start+25*hour),{});
});

test('Featured honors purchased extensions beyond 48 hours and ends at the shared deadline',()=>{
 const receipts=[receipt(0,start,'100x'),receipt(1,start+hour,'100x'),receipt(2,start+2*hour,'100x')];
 const launch={mint,cluster:'devnet',onchainVerified:true,blockTime:(start-10*24*hour)/1000,name:'Coin',symbol:'COIN'};
 const items=featuredTokens({launches:[launch],boosts:receipts,cluster:'devnet',now:start+60*hour});
 assert.equal(items.length,1);assert.equal(items[0].label,'Paid boost');assert.equal(items[0].expiresAt,start+72*hour);
 assert.equal(items[0].boost.packages.reduce((sum,row)=>sum+row.multiplier,0),300);
 assert.deepEqual(featuredTokens({launches:[launch],boosts:receipts,cluster:'devnet',now:start+72*hour}),[]);
});

test('quote/confirm retries and concurrent confirmations store each verified payment once and return extended history',async t=>{
 t.mock.timers.enable({apis:['Date'],now:start});
 const payer=Keypair.generate().publicKey.toBase58(),recipient=Keypair.generate().publicKey.toBase58();
 const oldWallet=process.env.FUNDED_BOOST_PAYMENT_WALLET,oldOrigin=process.env.CORS_ORIGIN;
 process.env.FUNDED_BOOST_PAYMENT_WALLET=recipient;process.env.CORS_ORIGIN='https://funded.test';
 const state={launches:{[mint]:{onchainVerified:true,cluster:'devnet'}}},transactions=new Map();let sequence=0,queue=Promise.resolve();
 const store={read:async()=>state,chargeRpcRate:async()=>true,update:fn=>{const result=queue.then(()=>fn(state));queue=result.catch(()=>{});return result;}};
 const route=createBoostRoutes({store,solanaCluster:'devnet',boostPurchasesEnabled:true,clientKey:()=>payer,body:async req=>req.input,
  readSolUsdQuote:async()=>({priceUsd:100,fetchedAt:new Date().toISOString()}),id:()=>`boost_${Date.now()}_${String(++sequence).padStart(16,'0')}`,
  solanaRpcUrl:'https://rpc.invalid',respond:(res,status,data)=>Object.assign(res,{status,data})});
 t.mock.method(Connection.prototype,'getGenesisHash',async()=>DEVNET_GENESIS_HASH);
 const proofRead=t.mock.method(Connection.prototype,'getParsedTransaction',async signature=>transactions.get(signature));
 const call=async(path,input,method='POST')=>{const res={};await route({method,headers:{origin:'https://funded.test'},input},res,new URL('https://funded.test'+path));return res;};
 const quote=async()=>{const res=await call('/api/boosts/quote',{mint,payer,packageId:'10x',paymentProtocol:'journal-v1'});assert.equal(res.status,201);assert.equal(res.data.durationPolicy,STACKED_BOOST_POLICY);return res.data;};
 const payment=(q,signature)=>{(state.boostPayments||={})[signature]={quoteId:q.id,broadcastAllowed:true,blockhash:mint,registeredAt:q.createdAt};return transactions.set(signature,{blockTime:Date.now()/1000,slot:100+sequence,meta:{err:null},transaction:{signatures:[signature],message:{recentBlockhash:mint,accountKeys:[{pubkey:payer,signer:true}],instructions:[
  {programId:SystemProgram.programId,parsed:{type:'transfer',info:{source:payer,destination:recipient,lamports:q.lamports}}},
  {programId:BOOST_MEMO_PROGRAM,parsed:boostMemo(q.id)}]}}});};
 try {
  const first=await quote(),sig1='2'.repeat(64);payment(first,sig1);
  assert.equal((await call('/api/boosts/confirm',{quoteId:first.id,signature:sig1})).status,201);
  t.mock.timers.setTime(start+7*hour);
  const second=await quote(),sig2='3'.repeat(64);payment(second,sig2);
  const both=await Promise.all([call('/api/boosts/confirm',{quoteId:second.id,signature:sig2}),call('/api/boosts/confirm',{quoteId:second.id,signature:sig2})]);
  assert.deepEqual(both.map(r=>r.status).sort(),[200,201]);
  assert.ok(both.every(r=>Date.parse(r.data.expiresAt)===start+24*hour));
  const reads=proofRead.mock.callCount();
  assert.equal((await call('/api/boosts/confirm',{quoteId:second.id,signature:sig2})).status,200);
  assert.equal(proofRead.mock.callCount(),reads);
  payment(second,'4'.repeat(64));assert.equal((await call('/api/boosts/confirm',{quoteId:second.id,signature:'4'.repeat(64)})).status,409);
  assert.equal(Object.keys(state.boostReceipts).length,2);
  const result=await call('/api/boosts?mint='+mint,null,'GET');
  assert.equal(result.data.active[mint].multiplier,20);assert.equal(result.data.active[mint].count,2);
  assert.ok(result.data.history.every(row=>Date.parse(row.expiresAt)===start+24*hour));
  assert.equal(Date.parse(state.boostReceipts[sig1].expiresAt),start+12*hour);
  assert.equal(Date.parse(state.boostReceipts[sig2].expiresAt),start+19*hour);
 } finally {
  if(oldWallet===undefined)delete process.env.FUNDED_BOOST_PAYMENT_WALLET;else process.env.FUNDED_BOOST_PAYMENT_WALLET=oldWallet;
  if(oldOrigin===undefined)delete process.env.CORS_ORIGIN;else process.env.CORS_ORIGIN=oldOrigin;
 }
});
