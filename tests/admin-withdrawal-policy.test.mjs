import test from 'node:test';
import assert from 'node:assert/strict';
import {Keypair,SystemProgram} from '@solana/web3.js';
import {createAdminWithdrawals} from '../server/admin-withdrawals.mjs';
import {createAdminWallets} from '../server/admin-wallets.mjs';
import {DEVNET_GENESIS_HASH} from '../server/automatic-reward-chain.mjs';
import {ADMIN_EMAIL_AUTHORIZED} from '../server/admin-email-verification.mjs';

const SOL=1_000_000_000;
const env={FUNDED_ADMIN_WITHDRAW_MAX_LAMPORTS:String(5*SOL),FUNDED_ADMIN_WITHDRAW_DAILY_LAMPORTS:String(6*SOL),
  FUNDED_ADMIN_WITHDRAW_REVIEW_LAMPORTS:String(1*SOL),FUNDED_ADMIN_WITHDRAW_DELAY_SECONDS:'3600'};

function fixture(){
  const source=Keypair.generate(),first=Keypair.generate().publicKey.toBase58(),second=Keypair.generate().publicKey.toBase58();
  const state={};let time=Date.parse('2026-11-16T00:00:00Z');
  const rpc={getGenesisHash:async()=>DEVNET_GENESIS_HASH,
    getAccountInfo:async()=>({owner:SystemProgram.programId,data:Buffer.alloc(0),lamports:100*SOL}),
    getLatestBlockhash:async()=>({blockhash:Keypair.generate().publicKey.toBase58(),lastValidBlockHeight:1000}),
    getFeeForMessage:async()=>({value:5000}),getMinimumBalanceForRentExemption:async()=>890880,getParsedTransaction:async()=>null,
    getSignatureStatuses:async()=>({value:[null]}),getBlockHeight:async()=>1000,getTransaction:async()=>null};
  const store={read:async()=>structuredClone(state),update:async fn=>fn(state)};
  const inventory=createAdminWallets({env:{FUNDED_V3_OPERATIONS_RECIPIENT:source.publicKey.toBase58()},v3AuthorityKeypair:()=>source});
  const handler=createAdminWithdrawals({store,env,connection:()=>rpc,roles:inventory.roles,signerFor:inventory.signerFor,now:()=>time});
  async function call(path,input,wallet=first,method='POST'){let response;
    await handler({method,[ADMIN_EMAIL_AUTHORIZED]:{id:'email'}},{},new URL('https://funded.test/api/admin/withdrawals/'+path),
      {session:{wallet},sessionId:'session-'+wallet,body:async()=>input,json:(_res,status,data)=>{response={status,data};return true;}});
    return response;}
  return{source:source.publicKey.toBase58(),first,second,state,call,advance:ms=>{time+=ms;}};
}

test('each withdrawal and each rolling 24 hours are capped before any source signature',async()=>{
  const f=fixture();
  assert.equal((await f.call('prepare',{source:f.source,amountLamports:5*SOL+1})).status,409);
  f.state.adminAudit={old:{action:'wallet-withdrawal',amountLamports:String(5.5*SOL),at:new Date(Date.parse('2026-11-15T12:00:00Z')).toISOString()}};
  const over=await f.call('prepare',{source:f.source,amountLamports:SOL});
  assert.equal(over.status,409);assert.match(over.data.error,/24-hour/);
  assert.equal(f.state.adminWithdrawalIntents,undefined);
  f.advance(13*60*60*1000);
  assert.equal((await f.call('prepare',{source:f.source,amountLamports:SOL})).status,200,'older receipts leave the window');
});

test('a large withdrawal needs a second admin and the delay, and its approval is used once',async()=>{
  const f=fixture(),amount=3*SOL;
  assert.equal((await f.call('prepare',{source:f.source,amountLamports:amount})).status,403);
  assert.equal((await f.call('request',{source:f.source,amountLamports:SOL})).status,400,'small amounts need no request');
  const created=await f.call('request',{source:f.source,amountLamports:amount});
  assert.equal(created.status,201);const requestId=created.data.id;
  assert.equal((await f.call('approve',{requestId})).status,403,'requester cannot approve');
  assert.equal((await f.call('prepare',{source:f.source,amountLamports:amount,requestId})).status,403,'not approved yet');
  assert.equal((await f.call('approve',{requestId},f.second)).status,200);
  assert.equal((await f.call('prepare',{source:f.source,amountLamports:amount,requestId})).status,409,'delay not over');
  f.advance(3600*1000);
  assert.equal((await f.call('prepare',{source:f.source,amountLamports:amount,requestId},f.second)).status,409,'only the requester withdraws');
  assert.equal((await f.call('prepare',{source:f.source,amountLamports:2*SOL,requestId})).status,409,'amount must match');
  const ok=await f.call('prepare',{source:f.source,amountLamports:amount,requestId});
  assert.equal(ok.status,200);
  assert.equal(f.state.adminWithdrawalRequests[requestId].status,'used');
  const listed=await f.call('requests',null,f.first,'GET');
  assert.equal(listed.data.requests[0].status,'used');assert.equal(listed.data.limits.reviewLamports,SOL);
});

test('any admin can cancel an open request',async()=>{
  const f=fixture();
  const {data}=await f.call('request',{source:f.source,amountLamports:2*SOL});
  assert.equal((await f.call('request',{source:f.source,amountLamports:2*SOL})).status,409,'one open request per source');
  assert.equal((await f.call('cancel',{requestId:data.id},f.second)).status,200);
  assert.equal((await f.call('approve',{requestId:data.id},f.second)).status,409);
});
