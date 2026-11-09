import test from 'node:test';
import assert from 'node:assert/strict';
import {Connection,Keypair,SystemProgram,Transaction,TransactionInstruction} from '@solana/web3.js';
import bs58 from 'bs58';
import {createBoostRoutes} from '../server/routes/boost.mjs';
import {registerBoostPayment,expiredBoostPayment,decodeBoostPayment} from '../server/boost-payment-journal.mjs';
import {verifyBoostPayment} from '../server/boost-proof.mjs';
import {BOOST_MEMO_PROGRAM,boostMemo,boostPackage} from '../boost-offer.js';
import {PublicKey} from '@solana/web3.js';
import {DEVNET_GENESIS_HASH} from '../server/automatic-reward-chain.mjs';
import {saveSignedBoostPayment,readPendingBoost,archiveBoostPayment,boostPaymentResolution} from '../boost-checkout-recovery.js';

const now=Date.parse('2026-11-09T00:00:00Z');
function fixture(){
  const payer=Keypair.generate(),recipient=Keypair.generate().publicKey.toBase58(),mint=Keypair.generate().publicKey.toBase58();
  const blockhash=Keypair.generate().publicKey.toBase58();
  const quote={...boostPackage('10x'),packageId:'10x',id:'boost_123_1234567890123456',mint,payer:payer.publicKey.toBase58(),recipient,
    cluster:'devnet',paymentProtocol:'journal-v1',lamports:495000000,solUsd:100,pricingRevision:0,
    createdAt:new Date(now-1000).toISOString(),expiresAt:new Date(now+300000).toISOString()};
  quote.memo=boostMemo(quote.id);
  const tx=new Transaction({feePayer:payer.publicKey,recentBlockhash:blockhash}).add(
    SystemProgram.transfer({fromPubkey:payer.publicKey,toPubkey:new PublicKey(recipient),lamports:quote.lamports}),
    new TransactionInstruction({programId:new PublicKey(BOOST_MEMO_PROGRAM),keys:[],data:Buffer.from(quote.memo)}));
  tx.sign(payer);const signature=bs58.encode(tx.signature),signedTransaction=tx.serialize().toString('base64');
  const state={boostQuotes:{[quote.id]:quote},boostPayments:{[`window:${quote.id}:${blockhash}`]:{
    kind:'prepared',quoteId:quote.id,blockhash,expiryUpperBound:200,observedSlot:11}}},store={read:async()=>state,update:async fn=>fn(state),chargeRpcRate:async()=>true};
  const rpc={isBlockhashValid:async()=>({context:{slot:10},value:true}),
    getLatestBlockhashAndContext:async()=>({context:{slot:11},value:{lastValidBlockHeight:200,blockhash}})};
  const parsed={slot:40,blockTime:(now+331000)/1000,meta:{err:null},transaction:{signatures:[signature],message:{recentBlockhash:blockhash,
    accountKeys:[{pubkey:payer.publicKey,signer:true}],instructions:[
      {programId:SystemProgram.programId,parsed:{type:'transfer',info:{source:quote.payer,destination:recipient,lamports:quote.lamports}}},
      {programId:BOOST_MEMO_PROGRAM,parsed:quote.memo}]}}};
  return {quote,signature,signedTransaction,blockhash,state,store,rpc,parsed,tx,payer};
}
const storage=()=>{const data=new Map();return{getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)};};

test('signed identity is immutable, rejects altered payments and cannot gain a new expiry on retry',async()=>{
  const f=fixture(),row=await registerBoostPayment({...f,now});
  assert.equal(row.expiryUpperBound,200);assert.equal(row.broadcastAllowed,true);
  f.rpc.getLatestBlockhashAndContext=async()=>{throw Error('must not extend expiry');};
  assert.deepEqual(await registerBoostPayment({...f,now:now+900000}),row);
  assert.throws(()=>decodeBoostPayment(f.signedTransaction,{...f.quote,lamports:1},f.signature));
  assert.throws(()=>decodeBoostPayment(f.signedTransaction,{...f.quote,recipient:f.quote.payer},f.signature));
  assert.throws(()=>decodeBoostPayment(f.signedTransaction,f.quote,'2'.repeat(88)));
  const bytes=Buffer.from(f.signedTransaction,'base64');bytes[2]^=1;
  assert.throws(()=>decodeBoostPayment(bytes.toString('base64'),f.quote,f.signature));
  const late=fixture();assert.equal((await registerBoostPayment({...late,now:now+400000})).broadcastAllowed,false);
  const unprepared=fixture();unprepared.state.boostPayments={};await assert.rejects(registerBoostPayment({...unprepared,now}),/preparation record/);
});

test('late finalized transfer is fulfilled once, new quotes require registration, legacy payments remain recoverable',async()=>{
  const f=fixture(),row=await registerBoostPayment({...f,now});
  assert.equal(verifyBoostPayment(f.parsed,f.quote,row).slot,40);
  assert.throws(()=>verifyBoostPayment(f.parsed,f.quote),/registered/);
  assert.throws(()=>verifyBoostPayment(f.parsed,f.quote,{...row,blockhash:f.quote.mint}),/registered/);
  assert.throws(()=>verifyBoostPayment(f.parsed,f.quote,{...row,broadcastAllowed:false}),/registered/);
  assert.equal(verifyBoostPayment(f.parsed,{...f.quote,paymentProtocol:undefined}).slot,40);
});

test('expiry requires finalized height, invalid blockhash, fresh history and no confirmed transaction',async()=>{
  const f=fixture(),payment=await registerBoostPayment({...f,now});
  const rpc={getBlockHeight:async()=>233,isBlockhashValid:async()=>({context:{slot:100},value:false}),
    getSignatureStatuses:async()=>({context:{slot:101},value:[null]}),getTransaction:async()=>null};
  const proof=await expiredBoostPayment(rpc,payment);assert.equal(proof.status,'expired');
  for(const changes of [
    {getBlockHeight:async()=>232}, {isBlockhashValid:async()=>({context:{slot:100},value:true})},
    {isBlockhashValid:async()=>({context:{slot:1},value:false})},
    {getSignatureStatuses:async()=>({context:{slot:99},value:[null]})},
    {getSignatureStatuses:async()=>({context:{slot:101},value:[{confirmationStatus:'confirmed',err:null}]})},
    {getTransaction:async()=>f.parsed},
  ])assert.equal(await expiredBoostPayment({...rpc,...changes},payment),null);
  await assert.rejects(expiredBoostPayment({...rpc,getTransaction:async()=>{throw Error('RPC timeout');}},payment));
  const s=storage(),record={quote:f.quote,signature:f.signature,blockhash:f.blockhash,signedTransaction:f.signedTransaction};
  await saveSignedBoostPayment(record,s,null);
  const pending={...record,pendingSignature:f.signature};
  assert.throws(()=>archiveBoostPayment(pending,{...proof,blockhash:f.quote.mint},s));
  assert.equal(boostPaymentResolution({status:'pending'},pending),'pending');
  assert.equal(archiveBoostPayment(pending,proof,s),'expired');
  assert.equal(readPendingBoost(f.quote.mint,s,f.quote),null);
  await saveSignedBoostPayment({...record,signature:'3'.repeat(88),quote:{...f.quote,id:'boost_456_1234567890123456',packageId:'30x'}},s,null);
  assert.equal(readPendingBoost(f.quote.mint,s,f.quote).quote.packageId,'30x');
});

test('wallet scopes, legacy migration and cross-tab locking preserve unresolved payment identities',async()=>{
  const f=fixture(),s=storage(),record={quote:f.quote,signature:f.signature};
  s.setItem(`funded.boost.pending.${f.quote.mint}`,JSON.stringify(record));
  const other={...f.quote,payer:Keypair.generate().publicKey.toBase58()};
  assert.equal(readPendingBoost(f.quote.mint,s,other),null);
  assert.equal(readPendingBoost(f.quote.mint,s,f.quote).signature,f.signature);
  assert.equal(s.getItem(`funded.boost.pending.${f.quote.mint}`),null);
  await saveSignedBoostPayment({...record,quote:other,signature:'3'.repeat(88)},s,null);
  assert.equal(readPendingBoost(f.quote.mint,s,f.quote).signature,f.signature);
  let queue=Promise.resolve();const locks={request:(_key,fn)=>{const p=queue.then(fn);queue=p.catch(()=>{});return p;}};
  const clean=storage(),results=await Promise.allSettled([saveSignedBoostPayment(record,clean,locks),saveSignedBoostPayment({...record,signature:'4'.repeat(88)},clean,locks)]);
  assert.deepEqual(results.map(r=>r.status),['fulfilled','rejected']);
});

test('confirm journals before broadcast, survives route restart, resolves expired absence and retains old quotes',async t=>{
  const f=fixture(),origin='https://funded.test',priorOrigin=process.env.CORS_ORIGIN,priorWallet=process.env.FUNDED_BOOST_PAYMENT_WALLET;
  process.env.CORS_ORIGIN=origin;process.env.FUNDED_BOOST_PAYMENT_WALLET=f.quote.recipient;
  t.mock.timers.enable({apis:['Date'],now});
  let transaction=null,height=100,valid=true;
  t.mock.method(Connection.prototype,'getGenesisHash',async()=>DEVNET_GENESIS_HASH);
  t.mock.method(Connection.prototype,'getParsedTransaction',async()=>transaction);
  t.mock.method(Connection.prototype,'isBlockhashValid',async()=>({context:{slot:valid?100:102},value:valid}));
  t.mock.method(Connection.prototype,'getLatestBlockhashAndContext',async()=>({context:{slot:101},value:{lastValidBlockHeight:200,blockhash:f.blockhash}}));
  t.mock.method(Connection.prototype,'getSignatureStatuses',async()=>({context:{slot:102},value:[null]}));
  t.mock.method(Connection.prototype,'getTransaction',async()=>transaction);
  const make=()=>createBoostRoutes({store:f.store,solanaCluster:'devnet',boostPurchasesEnabled:true,clientKey:()=> 'test',body:async req=>req.input,
    connectionFactory:()=>{const rpc=new Connection('https://rpc.invalid');rpc.getBlockHeight=async()=>height;return rpc;},
    readSolUsdQuote:async()=>({priceUsd:100,fetchedAt:new Date().toISOString()}),id:()=> 'boost_999_1234567890123456',solanaRpcUrl:'https://rpc.invalid',
    respond:(res,status,data)=>Object.assign(res,{status,data})});
  let route=make();const call=async(path,input)=>{const res={};await route({method:'POST',headers:{origin},input},res,new URL(origin+path));return res;};
  const input={quoteId:f.quote.id,signature:f.signature,signedTransaction:f.signedTransaction};
  try{
    f.state.boostPayments={};
    const preparation=await call('/api/boosts/prepare',{quoteId:f.quote.id});assert.equal(preparation.status,200);assert.equal(preparation.data.expiryUpperBound,200);
    const saved=await call('/api/boosts/confirm',input);assert.equal(saved.status,202);assert.equal(saved.data.broadcastAllowed,true);assert.equal(saved.data.journaled,true);
    route=make();t.mock.timers.setTime(now+331000);transaction=f.parsed;
    const late=await call('/api/boosts/confirm',input);assert.equal(late.status,201);assert.equal(late.data.status,'finalized');
    assert.equal((await call('/api/boosts/confirm',input)).status,200);assert.equal(Object.keys(f.state.boostReceipts).length,1);
    delete f.state.boostReceipts[f.signature];transaction=null;height=233;valid=false;
    const expired=await call('/api/boosts/confirm',input);assert.equal(expired.data.status,'expired');
    f.state.launches={[f.quote.mint]:{cluster:'devnet',onchainVerified:true}};
    t.mock.timers.setTime(now+72*3600000);
    assert.equal((await call('/api/boosts/quote',{mint:f.quote.mint,payer:f.quote.payer,packageId:'10x'})).status,409);
    assert.equal((await call('/api/boosts/quote',{mint:f.quote.mint,payer:f.quote.payer,packageId:'10x',paymentProtocol:'journal-v1'})).status,201);
    assert.ok(f.state.boostQuotes[f.quote.id]);
  }finally{
    if(priorOrigin===undefined)delete process.env.CORS_ORIGIN;else process.env.CORS_ORIGIN=priorOrigin;
    if(priorWallet===undefined)delete process.env.FUNDED_BOOST_PAYMENT_WALLET;else process.env.FUNDED_BOOST_PAYMENT_WALLET=priorWallet;
  }
});
