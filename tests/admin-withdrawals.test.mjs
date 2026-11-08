import test from 'node:test';
import assert from 'node:assert/strict';
import {Keypair,SystemProgram,Transaction} from '@solana/web3.js';
import {createAdminWithdrawals,withdrawalMaximum} from '../server/admin-withdrawals.mjs';
import {createAdminWallets} from '../server/admin-wallets.mjs';
import {DEVNET_GENESIS_HASH} from '../server/automatic-reward-chain.mjs';
function fixture(){
  const source=Keypair.generate(),admin=Keypair.generate().publicKey.toBase58(),state={};let balance=2000000000,fee=5000,genesis=DEVNET_GENESIS_HASH,owner=SystemProgram.programId,time=Date.now();
  const transactions=new Map(),rpc={getGenesisHash:async()=>genesis,getAccountInfo:async()=>({owner,data:Buffer.alloc(0),lamports:balance}),
    getLatestBlockhash:async()=>({blockhash:Keypair.generate().publicKey.toBase58(),lastValidBlockHeight:1000}),
    getFeeForMessage:async()=>({value:fee}),getParsedTransaction:async sig=>transactions.get(sig)||null,
    getSignatureStatuses:async()=>({value:[null]}),getBlockHeight:async()=>1000,getTransaction:async()=>null};
  const store={read:async()=>structuredClone(state),update:async fn=>fn(state)};
  const inventory=createAdminWallets({env:{FUNDED_V3_OPERATIONS_RECIPIENT:source.publicKey.toBase58()},v3AuthorityKeypair:()=>source});
  const handler=createAdminWithdrawals({store,env:{},connection:()=>rpc,roles:inventory.roles,signerFor:inventory.signerFor,now:()=>time});
  async function request(path,input,method='POST',wallet=admin){let response;
    await handler({method},{},new URL('https://funded.test/api/admin/withdrawals/'+path),{session:{wallet},body:async()=>input,
      json:(_res,status,data)=>{response={status,data};return true;}});return response;}
  return{source,admin,state,request,transactions,rpc,inventory,setBalance:value=>{balance=value;},setFee:value=>{fee=value;},setOwner:value=>{owner=value;},setGenesis:value=>{genesis=value;},tick:value=>{time+=value;}};
}
test('Max is exact and destination is server-bound; excessive amounts and unavailable fee stop signing',async()=>{
  const f=fixture(),source=f.source.publicKey.toBase58();
  assert.equal(f.inventory.roles().length,1);assert.equal(f.inventory.roles()[0].signingMode,'server');
  let result=await f.request('maximum?source='+source,null,'GET');assert.equal(result.status,200);
  assert.equal(result.data.destination,f.admin);assert.equal(result.data.maximumLamports,'1899995000');
  assert.equal(withdrawalMaximum(100,50,70),0);
  assert.equal((await f.request('prepare',{source,destination:Keypair.generate().publicKey.toBase58(),amountLamports:1})).status,403);
  assert.equal((await f.request('prepare',{source,amountLamports:1900000000})).status,409);
  f.setFee(null);assert.equal((await f.request('prepare',{source,amountLamports:1})).status,503);
  assert.equal(f.state.adminWithdrawalIntents,undefined);
});
test('server preparation is persisted before issuing signed bytes and pending recovery reuses exactly one transaction',async()=>{
  const f=fixture(),source=f.source.publicKey.toBase58(),input={source,amountLamports:1000000};
  const responses=await Promise.all([f.request('prepare',input),f.request('prepare',input)]);
  assert.equal(responses.filter(r=>r.status===200).length,1);
  const plan=responses.find(r=>r.status===200).data,tx=Transaction.from(Buffer.from(plan.signedTransaction,'base64'));
  assert(tx.verifySignatures());assert.equal(tx.feePayer.toBase58(),source);assert.equal(tx.instructions.length,1);
  assert.equal(tx.instructions[0].keys[1].pubkey.toBase58(),f.admin);
  assert.equal(f.state.adminWithdrawalIntents[source].signature,plan.signature);
  const again=await f.request('prepare',input);assert.equal(again.data.signedTransaction,plan.signedTransaction);assert.equal(again.data.recovery,true);
  assert.equal((await f.request('prepare',{source,amountLamports:2000000})).status,409);
  assert.equal((await f.request('prepare',input,'POST',Keypair.generate().publicKey.toBase58())).status,409);
  f.rpc.getBlockHeight=async()=>1033;
  const replacement=await f.request('prepare',input);assert.equal(replacement.status,200);assert.notEqual(replacement.data.signature,plan.signature);
});
test('reconciliation proves exact source/destination deltas and returns a prior finalized transfer instead of paying twice',async()=>{
  const f=fixture(),source=f.source.publicKey.toBase58(),input={source,amountLamports:1000000};
  const plan=(await f.request('prepare',input)).data;
  const tx={slot:55,meta:{err:null,fee:5000,preBalances:[2000000000,1000000000],postBalances:[1998995000,1001000000]},
    transaction:{signatures:[plan.signature],message:{recentBlockhash:plan.blockhash,accountKeys:[{pubkey:f.source.publicKey,signer:true},{pubkey:{toBase58:()=>f.admin},signer:false}],
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
