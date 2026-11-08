import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {Keypair,SystemProgram,Transaction} from '@solana/web3.js';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import {createAdminRoutes} from '../server/routes/admin.mjs';
import {SOLANA_GENESIS} from '../solana-network.js';
test('HTTP withdrawal uses one OTP then exact admin co-signature; no second code or new transfer is authorized',{timeout:15000},async()=>{
 const admin=Keypair.generate(),source=Keypair.generate(),state={},mail=[];let cookie='',finalized=null;
 const env={FUNDED_ADMIN_WALLETS:admin.publicKey.toBase58(),FUNDED_ADMIN_EMAIL:'fixture@test.invalid',FUNDED_V3_OPERATIONS_RECIPIENT:source.publicKey.toBase58()};
 const rpc={getGenesisHash:async()=>SOLANA_GENESIS.devnet,getAccountInfo:async()=>({owner:SystemProgram.programId,data:Buffer.alloc(0),lamports:1000000000}),
  getLatestBlockhash:async()=>({blockhash:Keypair.generate().publicKey.toBase58(),lastValidBlockHeight:1000}),getMinimumBalanceForRentExemption:async()=>890880,
  getFeeForMessage:async message=>{assert.equal(message.header.numRequiredSignatures,2);return{value:10000};},getParsedTransaction:async()=>finalized};
 const handler=createAdminRoutes({env,store:{read:async()=>structuredClone(state),update:async fn=>fn(state)},solanaCluster:'devnet',
  solanaRpcUrl:'http://unused.invalid',v3AuthorityKeypair:()=>source,connectionFactory:()=>rpc,
  body:async req=>{let value='';for await(const chunk of req)value+=chunk;return JSON.parse(value||'{}');},
  respond:(res,status,value)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(value));},
  emailVerificationOptions:{configuration:()=>({to:env.FUNDED_ADMIN_EMAIL}),send:async message=>mail.push(message)}});
 const server=createServer(async(req,res)=>{try{await handler(req,res,new URL(req.url,env.PUBLIC_APP_URL));}catch{res.writeHead(500);res.end('{}');}});
 server.listen(0,'127.0.0.1');await once(server,'listening');env.PUBLIC_APP_URL=`http://127.0.0.1:${server.address().port}`;
 async function request(path,payload,headers={}){
  const response=await fetch(env.PUBLIC_APP_URL+'/api/admin/'+path,{method:'POST',headers:{origin:env.PUBLIC_APP_URL,cookie,'content-type':'application/json',...headers},body:JSON.stringify(payload)});
  if(response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];
  return{status:response.status,data:await response.json()};
 }
 async function login(){const {data}=await request('challenge',{wallet:admin.publicKey.toBase58()});
  assert.equal((await request('session',{wallet:admin.publicKey.toBase58(),nonce:data.nonce,signature:bs58.encode(nacl.sign.detached(new TextEncoder().encode(data.message),admin.secretKey))})).status,200);}
 try{
  await login();const payload={source:source.publicKey.toBase58(),destination:admin.publicKey.toBase58(),amountLamports:1000000};
  assert.equal((await request('withdrawals/prepare',payload)).status,403);
  const confirmation=await request('email-confirmation',{method:'POST',path:'/api/admin/withdrawals/prepare',payload});
  const proof={'x-admin-confirmation-id':confirmation.data.id,'x-admin-confirmation-code':mail[0].code};
  const prepared=await request('withdrawals/prepare',payload,proof);assert.equal(prepared.status,200);
  const plan=prepared.data,tx=Transaction.from(Buffer.from(plan.signedTransaction,'base64'));
  assert.equal(tx.feePayer.toBase58(),payload.destination);assert.equal(tx.verifySignatures(),false);
  assert.equal((await request('withdrawals/submit',{intentId:plan.id,signedTransaction:plan.signedTransaction})).status,403);
  // Phantom's signature is emulated with an ephemeral admin key; no chain or email provider is used.
  tx.partialSign(admin);const signedTransaction=tx.serialize().toString('base64'),signature=bs58.encode(tx.signature);
  assert.equal((await request('withdrawals/submit',{intentId:plan.id,signedTransaction,destination:Keypair.generate().publicKey.toBase58()})).status,403);
  assert.equal((await request('withdrawals/submit',{intentId:plan.id,signedTransaction})).status,200);
  assert.equal(state.adminWithdrawalIntents[payload.source].signature,signature);
  finalized={slot:77,meta:{err:null,fee:10000,preBalances:[1000000000,1000000000],postBalances:[1000990000,999000000]},transaction:{
   signatures:[signature,plan.sourceSignature],message:{recentBlockhash:plan.blockhash,accountKeys:[{pubkey:admin.publicKey,signer:true},{pubkey:source.publicKey,signer:true}],
    instructions:[{program:'system',parsed:{type:'transfer',info:{source:payload.source,destination:payload.destination,lamports:payload.amountLamports}}}]}}};
  const receipt=await request('withdrawals/reconcile',{intentId:plan.id,signature});assert.equal(receipt.status,200);assert.equal(receipt.data.feePayer,payload.destination);
  assert.equal(receipt.data.sourceDebitLamports,'1000000');assert.equal(receipt.data.recipientCreditLamports,'990000');assert.equal(mail.length,1);
  assert.equal((await request('withdrawals/prepare',payload,proof)).status,403,'consumed OTP cannot authorize another withdrawal');
  await login();assert.equal((await request('withdrawals/submit',{intentId:plan.id,signedTransaction})).status,403,'new session must not inherit the continuation');
 }finally{await new Promise(resolve=>server.close(resolve));}
});
