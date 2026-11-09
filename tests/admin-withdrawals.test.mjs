import test from 'node:test';
import assert from 'node:assert/strict';
import {Keypair,SystemProgram,Transaction} from '@solana/web3.js';
import {createAdminWithdrawals,withdrawalMaximum,finalizedAdminTransfer} from '../server/admin-withdrawals.mjs';
import {createAdminWallets} from '../server/admin-wallets.mjs';
import {DEVNET_GENESIS_HASH} from '../server/automatic-reward-chain.mjs';
import {ADMIN_EMAIL_AUTHORIZED} from '../server/admin-email-verification.mjs';
import bs58 from 'bs58';
function fixture(){
  const source=Keypair.generate(),adminKey=Keypair.generate(),admin=adminKey.publicKey.toBase58(),state={};let balance=2000000000,adminBalance=1000000000,fee=10000,genesis=DEVNET_GENESIS_HASH,owner=SystemProgram.programId,time=Date.now();
  const transactions=new Map(),rpc={getGenesisHash:async()=>genesis,getAccountInfo:async key=>({owner:key.toBase58()===admin?SystemProgram.programId:owner,data:Buffer.alloc(0),lamports:key.toBase58()===admin?adminBalance:balance}),
    getLatestBlockhash:async()=>({blockhash:Keypair.generate().publicKey.toBase58(),lastValidBlockHeight:1000}),
    getFeeForMessage:async()=>({value:fee}),getMinimumBalanceForRentExemption:async()=>890880,getParsedTransaction:async sig=>transactions.get(sig)||null,
    getSignatureStatuses:async()=>({value:[null]}),getBlockHeight:async()=>1000,getTransaction:async()=>null};
  const store={read:async()=>structuredClone(state),update:async fn=>fn(state)};
  const inventory=createAdminWallets({env:{FUNDED_V3_OPERATIONS_RECIPIENT:source.publicKey.toBase58()},v3AuthorityKeypair:()=>source});
  const handler=createAdminWithdrawals({store,env:{},connection:()=>rpc,roles:inventory.roles,signerFor:inventory.signerFor,now:()=>time});
  async function request(path,input,method='POST',wallet=admin){let response;
    await handler({method,[ADMIN_EMAIL_AUTHORIZED]:{id:'mock-email-approval'}},{},new URL('https://funded.test/api/admin/withdrawals/'+path),{session:{wallet},sessionId:'mock-admin-session',body:async()=>input,
      json:(_res,status,data)=>{response={status,data};return true;}});return response;}
  return{source,admin,adminKey,state,request,transactions,rpc,inventory,handler,setBalance:value=>{balance=value;},setAdminBalance:value=>{adminBalance=value;},setFee:value=>{fee=value;},setOwner:value=>{owner=value;},setGenesis:value=>{genesis=value;},tick:value=>{time+=value;}};
}
test('Max is exact and destination is server-bound; excessive amounts and unavailable fee stop signing',async()=>{
  const f=fixture(),source=f.source.publicKey.toBase58();
  assert.equal(f.inventory.roles().length,1);assert.equal(f.inventory.roles()[0].signingMode,'server');
  let result=await f.request('maximum?source='+source,null,'GET');assert.equal(result.status,200);
  assert.equal(result.data.destination,f.admin);assert.equal(result.data.feePayer,f.admin);assert.equal(result.data.maximumLamports,'1900000000');
  assert.equal(withdrawalMaximum(100,50,70),0);
  assert.equal((await f.request('prepare',{source,destination:Keypair.generate().publicKey.toBase58(),amountLamports:1})).status,403);
  assert.equal((await f.request('prepare',{source,amountLamports:1900000001})).status,409);
  f.setAdminBalance(9999);assert.equal((await f.request('prepare',{source,amountLamports:1})).status,409);f.setAdminBalance(1000000000);
  f.setFee(null);assert.equal((await f.request('prepare',{source,amountLamports:1})).status,503);
  assert.equal(f.state.adminWithdrawalIntents,undefined);
});
test('server preparation is persisted before issuing signed bytes and pending recovery reuses exactly one transaction',async()=>{
  const f=fixture(),source=f.source.publicKey.toBase58(),input={source,amountLamports:1000000};
  const responses=await Promise.all([f.request('prepare',input),f.request('prepare',input)]);
  assert.equal(responses.filter(r=>r.status===200).length,1);
  const plan=responses.find(r=>r.status===200).data,tx=Transaction.from(Buffer.from(plan.signedTransaction,'base64'));
  assert(tx.verifySignatures(false));assert.equal(tx.verifySignatures(),false);assert.equal(tx.feePayer.toBase58(),f.admin);assert.equal(tx.instructions.length,1);
  assert.equal(tx.instructions[0].keys[1].pubkey.toBase58(),f.admin);
  assert.equal(f.state.adminWithdrawalIntents[source].sourceSignature,plan.sourceSignature);
  assert.equal(f.state.adminWithdrawalIntents[source].signature,undefined);
  const again=await f.request('prepare',input);assert.equal(again.data.signedTransaction,plan.signedTransaction);assert.equal(again.data.recovery,true);
  assert.equal((await f.request('prepare',{source,amountLamports:2000000})).status,409);
  assert.equal((await f.request('prepare',input,'POST',Keypair.generate().publicKey.toBase58())).status,409);
  f.rpc.getBlockHeight=async()=>1033;
  const replacement=await f.request('prepare',input);assert.equal(replacement.status,200);assert.notEqual(replacement.data.sourceSignature,plan.sourceSignature);
});

test('finalized failed transfer releases its source for a different withdrawal amount',async()=>{
  const f=fixture(),source=f.source.publicKey.toBase58();
  const plan=(await f.request('prepare',{source,amountLamports:1000000})).data;
  const tx=Transaction.from(Buffer.from(plan.signedTransaction,'base64'));tx.partialSign(f.adminKey);
  const signature=bs58.encode(tx.signature);
  await f.request('submit',{intentId:plan.id,signedTransaction:tx.serialize().toString('base64')});
  const err={InstructionError:[0,'InsufficientFunds']};
  f.rpc.getSignatureStatuses=async()=>({value:[{confirmationStatus:'finalized',err}]});
  f.rpc.getTransaction=async()=>({meta:{err},transaction:{signatures:[signature]}});
  const replacement=await f.request('prepare',{source,amountLamports:2500000});
  assert.equal(replacement.status,200);assert.equal(replacement.data.amountLamports,2500000);
  assert.notEqual(replacement.data.id,plan.id);assert.equal(replacement.data.signature,undefined);
});
test('reconciliation proves exact source/destination deltas and returns a prior finalized transfer instead of paying twice',async()=>{
  const f=fixture(),source=f.source.publicKey.toBase58(),input={source,amountLamports:1000000};
  const plan=(await f.request('prepare',input)).data;
  const signed=Transaction.from(Buffer.from(plan.signedTransaction,'base64'));signed.partialSign(f.adminKey);plan.signature=bs58.encode(signed.signature);
  assert.equal((await f.request('submit',{intentId:plan.id,signedTransaction:signed.serialize().toString('base64')})).status,200);
  const tx={slot:55,meta:{err:null,fee:10000,preBalances:[1000000000,2000000000],postBalances:[1000990000,1999000000]},
    transaction:{signatures:[plan.signature,plan.sourceSignature],message:{recentBlockhash:plan.blockhash,accountKeys:[{pubkey:f.adminKey.publicKey,signer:true},{pubkey:f.source.publicKey,signer:true}],
      instructions:[{program:'system',parsed:{type:'transfer',info:{source,destination:f.admin,lamports:1000000}}}]}}};
  f.transactions.set(plan.signature,tx);
  assert.equal((await f.request('reconcile',{signature:plan.signature},'POST',Keypair.generate().publicKey.toBase58())).status,409);
  const recovered=await f.request('prepare',input);assert.equal(recovered.status,200);assert.equal(recovered.data.finalized,true);
  assert.equal(recovered.data.signature,plan.signature);assert.equal(f.state.adminWithdrawalIntents[source].status,'finalized');
  tx.meta.postBalances[1]--;assert.equal((await f.request('reconcile',{signature:plan.signature})).status,409);
});
test('wrong network, program accounts and sources outside the inventory cannot be withdrawn',async()=>{
  const f=fixture(),source=f.source.publicKey.toBase58();f.setGenesis('wrong');
  assert.equal((await f.request('prepare',{source,amountLamports:1})).status,503);
  f.setGenesis(DEVNET_GENESIS_HASH);f.setOwner(Keypair.generate().publicKey);
  assert.equal((await f.request('prepare',{source,amountLamports:1})).status,409);
  assert.equal((await f.request('prepare',{source:Keypair.generate().publicKey.toBase58(),amountLamports:1})).status,400);
});
test('only the same admin session and exact Phantom-signed transaction can continue the OTP-approved withdrawal',async()=>{
 const f=fixture(),source=f.source.publicKey.toBase58(),plan=(await f.request('prepare',{source,amountLamports:1000000})).data;
 const input={intentId:plan.id,signedTransaction:plan.signedTransaction};
 const authorize=changes=>f.handler.authorizeContinuation({session:{wallet:f.admin},sessionId:'mock-admin-session',path:'/api/admin/withdrawals/submit',input,...changes});
 assert.equal(await authorize(),null,'source signature alone must not authorize broadcast');
 const tx=Transaction.from(Buffer.from(plan.signedTransaction,'base64'));tx.partialSign(f.adminKey);input.signedTransaction=tx.serialize().toString('base64');
 assert.equal((await authorize()).continuation,true);
 assert.equal(await authorize({sessionId:'another-session'}),null);
 assert.equal(await authorize({session:{wallet:Keypair.generate().publicKey.toBase58()}}),null);
 assert.equal(await authorize({input:{...input,destination:Keypair.generate().publicKey.toBase58()}}),null);
 const recorded=await f.request('submit',input);assert.equal(recorded.status,200);assert.equal(recorded.data.signature,bs58.encode(tx.signature));
 assert.equal(f.state.adminWithdrawalIntents[source].signature,recorded.data.signature);
 assert.deepEqual((await f.request('submit',input)).data,recorded.data,'same identity is idempotent');
 assert.equal((await f.handler.authorizeContinuation({session:{wallet:f.admin},sessionId:'mock-admin-session',
  path:'/api/admin/withdrawals/reconcile',input:{intentId:plan.id,signature:recorded.data.signature}})).continuation,true);
 assert.equal(await f.handler.authorizeContinuation({session:{wallet:f.admin},sessionId:'mock-admin-session',
  path:'/api/admin/withdrawals/reconcile',input:{intentId:plan.id,signature:'wrong'}}),null);
});
test('historical source-paid withdrawals still reconcile without treating the admin as their fee payer',async()=>{
 const f=fixture(),source=f.source.publicKey.toBase58(),signature='2'.repeat(88);
 f.transactions.set(signature,{slot:55,meta:{err:null,fee:5000,preBalances:[2000000000,1000000000],postBalances:[1998995000,1001000000]},
  transaction:{signatures:[signature],message:{accountKeys:[{pubkey:f.source.publicKey,signer:true},{pubkey:f.adminKey.publicKey,signer:false}],
   instructions:[{program:'system',parsed:{type:'transfer',info:{source,destination:f.admin,lamports:1000000}}}]}}});
 const proof=await finalizedAdminTransfer(f.rpc,signature);assert.equal(proof.feePayer,source);assert.equal(proof.amount,1000000);
});
