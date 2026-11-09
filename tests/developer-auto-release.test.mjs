import test from 'node:test';
import assert from 'node:assert/strict';
import {Keypair,PublicKey,TransactionMessage,VersionedTransaction} from '@solana/web3.js';
import {AccountLayout,TOKEN_2022_PROGRAM_ID} from '@solana/spl-token';
import {createDeveloperAutoRelease} from '../server/developer-auto-release.mjs';
import {executeDeveloperRelease} from '../server/developer-release-journal.mjs';
import {DEVELOPER_TOKEN_LOCK_PROGRAMS,developerLockAddresses,developerReleaseInstructions} from '../developer-token-lock.js';
const payer=Keypair.fromSeed(new Uint8Array(32).fill(5)),creator=Keypair.fromSeed(new Uint8Array(32).fill(6)).publicKey.toBase58(),mint=Keypair.fromSeed(new Uint8Array(32).fill(7)).publicKey.toBase58();
const programId=DEVELOPER_TOKEN_LOCK_PROGRAMS[1],genesis='EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG',hash='ab'.repeat(32);
const intent={cluster:'devnet',programId,mint,creator,payer:payer.publicKey.toBase58(),amount:'123',unlockAt:50000,approvedHash:hash};
function fixture(){
 const state={launches:{},developerTokenReleases:{}},sent=[];let prepares=0,finalized=false,time=1000000;
 const store={read:async()=>structuredClone(state),update:async fn=>fn(state)};
 const connection={getGenesisHash:async()=>genesis,getFeeForMessage:async()=>({value:5000}),getBalance:async()=>1e9,
  isBlockhashValid:async()=>({value:true}),getBlockHeight:async()=>90,getSignatureStatuses:async()=>({value:[null]}),
  sendRawTransaction:async bytes=>{assert(Object.values(state.developerTokenReleases).some(r=>r.signedTransaction));sent.push(Buffer.from(bytes));throw Error('timeout after submit');}};
 const options={store,connection,authority:payer,intent,now:()=>time,
  prepare:async()=>{prepares++;return {transaction:new VersionedTransaction(new TransactionMessage({payerKey:payer.publicKey,recentBlockhash:mint,instructions:developerReleaseInstructions({mint,creator,programId,payer:payer.publicKey})}).compileToV0Message()),lastValidBlockHeight:100,rentLamports:0};},
  prove:async row=>finalized?{status:'finalized',signature:row.signature,amount:'123'}:{status:'pending'}};
 return {state,sent,store,connection,options,get prepares(){return prepares;},finalize(){finalized=true;},advance(){time+=61000;}};
}
test('ambiguous sends persist and rebroadcast identical bytes; finalization never creates a second debit',async()=>{
 const f=fixture();const first=await executeDeveloperRelease(f.options);assert.equal(first.status,'pending');
 await executeDeveloperRelease(f.options);assert.equal(f.prepares,1);assert(f.sent[0].equals(f.sent[1]));
 f.finalize();assert.equal((await executeDeveloperRelease(f.options)).status,'finalized');assert.equal(f.sent.length,2);
 assert(!f.state.developerTokenReleases[`${programId}:${mint}`].signedTransaction);
});
test('Mainnet, changed intent, fee cap, low payer balance and daily budget all fail before broadcast',async()=>{
 for(const mode of ['network','fee','balance','budget']){
  const f=fixture();if(mode==='network')f.connection.getGenesisHash=async()=>'mainnet';
  if(mode==='fee')f.connection.getFeeForMessage=async()=>({value:100001});
  if(mode==='balance')f.connection.getBalance=async()=>100000000;
  if(mode==='budget')f.state.developerTokenReleases.old={preparedAt:1000000,reservedLamports:20000000};
  await assert.rejects(()=>executeDeveloperRelease(f.options));assert.equal(f.sent.length,0);
 }
 const f=fixture();await executeDeveloperRelease(f.options);
 await assert.rejects(()=>executeDeveloperRelease({...f.options,intent:{...intent,creator:mint}}),/intent changed/);
});
test('expiry needs finalized height and absent historical signature; pending confirmation prevents replacement',async()=>{
 const f=fixture();await executeDeveloperRelease(f.options);f.connection.getBlockHeight=async()=>101;
 f.connection.getSignatureStatuses=async()=>({value:[{confirmationStatus:'confirmed',err:null}]});
 await executeDeveloperRelease(f.options);assert.equal(f.prepares,1);
 f.connection.getSignatureStatuses=async()=>({value:[null]});
 assert.equal((await executeDeveloperRelease(f.options)).status,'expired');
 f.connection.getBlockHeight=async()=>90;await executeDeveloperRelease(f.options);assert.equal(f.prepares,2);
 assert.equal(f.state.developerTokenReleases[`${programId}:${mint}`].attempts.length,1);
});
test('release construction uses only the service signer and binds the original creator destination',()=>{
 const ixs=developerReleaseInstructions({mint,creator,programId,payer:payer.publicKey});
 const message=new TransactionMessage({payerKey:payer.publicKey,recentBlockhash:mint,instructions:ixs}).compileToV0Message();
 assert.equal(message.header.numRequiredSignatures,1);
 assert.equal(ixs[1].keys[1].pubkey.toBase58(),creator);
 assert(ixs[1].keys[5].pubkey.equals(developerLockAddresses({mint,creator,programId}).source));
});
function workerFixture(){
 const f=fixture(),addresses=developerLockAddresses({mint,creator,programId});
 const data=Buffer.alloc(105);Buffer.from('c9e00b0c19713f1d','hex').copy(data);new PublicKey(mint).toBuffer().copy(data,8);new PublicKey(creator).toBuffer().copy(data,40);
 data.writeBigUInt64LE(123n,72);data.writeBigInt64LE(6800n,80);data.writeBigInt64LE(50000n,88);data[104]=addresses.bump;
 const vault=Buffer.alloc(AccountLayout.span);AccountLayout.encode({mint:new PublicKey(mint),owner:addresses.lock,amount:123n,delegateOption:0,delegate:new PublicKey(mint),state:1,isNativeOption:0,isNative:0n,delegatedAmount:0n,closeAuthorityOption:0,closeAuthority:new PublicKey(mint)},vault);
 f.state.launches[mint]={mint,creatorWallet:creator,cluster:'devnet',onchainVerified:true,developerTokenLock:{verified:true,amount:'123',programId}};
 Object.assign(f.connection,{getAccountInfo:async key=>key.equals(addresses.lock)?{owner:new PublicKey(programId),data}:{owner:TOKEN_2022_PROGRAM_ID,data:vault},getSlot:async()=>1,getBlockTime:async()=>50000});
 let calls=0;const args={store:f.store,connection:f.connection,solanaCluster:'devnet',solanaRpcUrl:'http://localhost',v3AuthorityKeypair:()=>payer,
  env:{FUNDED_DEVELOPER_AUTO_RELEASE_ENABLED:'true'},logger:{error(){}},configReader:async()=>({ready:true,programId,programDataSha256:hash}),
  execute:async options=>{calls++;assert.equal(options.intent.creator,creator);return {status:'pending'};}};
 return {...f,args,data,get calls(){return calls;}};
}
test('automatic worker requires finalized deadline, custody, matching deployment and Devnet primary role',async()=>{
 for(const mode of ['before','wrong-amount','unverified','mainnet','api-only','wrong-deployment']){
  const f=workerFixture();if(mode==='before')f.connection.getBlockTime=async()=>49999;
  if(mode==='wrong-amount')f.state.launches[mint].developerTokenLock.amount='124';
  if(mode==='unverified')f.state.launches[mint].onchainVerified=false;
  if(mode==='mainnet')f.args.solanaCluster='mainnet-beta';
  if(mode==='api-only')f.args.env.FUNDED_API_ONLY='true';
  if(mode==='wrong-deployment')f.args.configReader=async()=>({ready:false});
  await createDeveloperAutoRelease(f.args).tick();assert.equal(f.calls,0,mode);
 }
 const f=workerFixture();await createDeveloperAutoRelease(f.args).tick();assert.equal(f.calls,1);assert.equal(f.state.developerTokenReleases.worker.status,'ready');
});
