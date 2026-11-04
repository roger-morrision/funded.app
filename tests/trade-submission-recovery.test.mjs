import test from 'node:test';
import assert from 'node:assert/strict';
import bs58 from 'bs58';
import BN from 'bn.js';
import {Keypair,Transaction,SystemProgram} from '@solana/web3.js';
import {submitTrade} from '../pump-trading.js';
import {expiredUnlandedTrade} from '../src/features/experience/trade-expiry.js';
import {recordTradeRecovery,readTradeRecovery,uncertainTrade} from '../src/features/experience/trade-recovery-store.js';
function fixture({mutate=false,lostAck=false,wrongAck=false,mobile=false}={}){
 const payer=Keypair.generate(),mint=Keypair.generate().publicKey,recipient=Keypair.generate().publicKey,hash=Keypair.generate().publicKey.toBase58();
 const state={sent:0,prepared:null,signature:null};
 const provider={remoteMobile:mobile,signTransaction:async tx=>{
  if(mobile){tx.recentBlockhash=Keypair.generate().publicKey.toBase58();tx.fundedLastValidBlockHeight=101;}
  if(mutate)tx.instructions[0].data[4]^=1;tx.sign(payer);return tx;
 }};
 const connection={getLatestBlockhash:async()=>({blockhash:hash,lastValidBlockHeight:100}),getBlockHeight:async()=>50,
  sendRawTransaction:async wire=>{state.sent++;assert(state.prepared,'Known identity must be recorded before broadcast');state.signature=bs58.encode(Transaction.from(wire).signature);
   if(lostAck)throw Error('Lost RPC acknowledgement');return wrongAck?'3'.repeat(64):state.signature;},confirmTransaction:async()=>({value:{err:null}})};
 const trade={side:'buy',mint,user:payer.publicKey,inputAmount:.01,slippagePercent:1,outputAmount:new BN(1),quoteAmount:new BN(10000000),tokenDecimals:6,feeLamports:0,
  instructions:[SystemProgram.transfer({fromPubkey:payer.publicKey,toPubkey:recipient,lamports:1000})]};
 return{state,run:()=>submitTrade({connection,provider,side:'buy',mint,user:payer.publicKey,amount:.01,slippagePercent:1,preparedTrade:trade,onPrepared:row=>{state.prepared=row;}})};
}
for(const mobile of [false,true]){
 test(`unchanged ${mobile?'mobile':'desktop'} trade records its identity before one broadcast`,async()=>{
  const {run,state}=fixture({mobile});const result=await run();assert.equal(result.signature,state.signature);assert.equal(state.sent,1);assert.equal(state.prepared.signature,state.signature);
 });
 test(`same-object ${mobile?'mobile':'desktop'} trade mutation cannot broadcast`,async()=>{
  const {run,state}=fixture({mobile,mutate:true});await assert.rejects(run,/changed the reviewed trade/);assert.equal(state.sent,0);
 });
}
for(const mode of ['lostAck','wrongAck'])test(`${mode} retains the exact signed trade and expiry`,async()=>{
 const {run,state}=fixture({[mode]:true});await assert.rejects(run,error=>error.signature===state.signature&&error.lastValidBlockHeight===100);
 assert.equal(state.sent,1);assert.equal(state.prepared.signature,state.signature);
});
test('non-landing needs finalized absence, sufficient block height and Devnet',async()=>{
 const row={signature:'3'.repeat(64),lastValidBlockHeight:100};let height=132,status=null,genesis='EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
 const rpc={getGenesisHash:async()=>genesis,getBlockHeight:async commitment=>{assert.equal(commitment,'finalized');return height;},getSignatureStatuses:async(_s,options)=>{assert(options.searchTransactionHistory);return{value:[status]};}};
 assert.equal(await expiredUnlandedTrade(rpc,row,null),false);height=133;assert.equal(await expiredUnlandedTrade(rpc,row,null),true);
 status={confirmationStatus:'confirmed'};assert.equal(await expiredUnlandedTrade(rpc,row,null),false);status=null;
 assert.equal(await expiredUnlandedTrade(rpc,row,{meta:{err:null}}),false);assert.equal(await expiredUnlandedTrade(rpc,{signature:row.signature},null),false);
 genesis='wrong';await assert.rejects(expiredUnlandedTrade(rpc,row,null),/not Devnet/);
});
test('public recovery survives reload, blocks only the matching wallet/coin and keeps no signed wire',()=>{
 const values=new Map(),storage={getItem:key=>values.get(key),setItem:(key,value)=>values.set(key,value)},wallet=Keypair.generate().publicKey.toBase58(),mint=Keypair.generate().publicKey.toBase58();
 const row={signature:'4'.repeat(64),walletAddress:wallet,mint,side:'buy',lastValidBlockHeight:123,broadcastUncertain:true};
 assert(recordTradeRecovery(row,storage));assert.equal(readTradeRecovery(storage)[0].lastValidBlockHeight,123);
 assert(uncertainTrade(wallet,mint));assert.equal(uncertainTrade(Keypair.generate().publicKey.toBase58(),mint),null);
 const saved=JSON.parse([...values.values()][0])[0];assert(!('wire'in saved));assert(!('secretKey'in saved));
 recordTradeRecovery({...row,broadcastUncertain:false},storage);assert.equal(uncertainTrade(wallet,mint),null);
});
