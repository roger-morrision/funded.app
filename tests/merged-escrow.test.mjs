import test from 'node:test';
import assert from 'node:assert/strict';
import {PublicKey,Keypair,Transaction,TransactionMessage,VersionedTransaction} from '@solana/web3.js';
import {TOKEN_2022_PROGRAM_ID,AccountLayout} from '@solana/spl-token';
import {DEVELOPER_TOKEN_LOCK_PROGRAM_ID as legacy,DEVELOPER_TOKEN_LOCK_PROGRAMS,developerLockAddresses,
  developerLockLaunchInstructions,developerLockInstruction,developerReleaseInstruction,decodeDeveloperTokenLock} from '../developer-token-lock.js';
import {developerLockConfig,developerLockProgramFromTransaction} from '../server/developer-token-lock.mjs';
import {developerReleaseStorageKey,verifyDeveloperRelease,releaseDeveloperTokens} from '../developer-token-release.js';
import {verifyLaunchServiceFee} from '../server/launch-service-fee-proof.mjs';
import {createLaunchProtectionRoutes} from '../server/routes/launch-protection.mjs';

const router=DEVELOPER_TOKEN_LOCK_PROGRAMS[1],creator=Keypair.fromSeed(new Uint8Array(32).fill(21)).publicKey.toBase58();
const mint=Keypair.fromSeed(new Uint8Array(32).fill(22)).publicKey.toBase58(),genesis='EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
const now=1_800_000_000,amount='123',hash='ab'.repeat(32),oldHash='cd'.repeat(32);
const env={FUNDED_DEVELOPER_LOCK_PROGRAM_ID:router,FUNDED_DEVELOPER_LOCK_PROGRAM_DATA_SHA256:hash,
  FUNDED_V3_FEE_ROUTER_PROGRAM_ID:router,FUNDED_V3_PROGRAM_DATA_SHA256:hash,FUNDED_DEVELOPER_LOCK_LEGACY_PROGRAM_DATA_SHA256:oldHash};
function account(programId,released=true){
  const data=Buffer.alloc(105),{bump}=developerLockAddresses({mint,creator,programId});
  Buffer.from('c9e00b0c19713f1d','hex').copy(data);new PublicKey(mint).toBuffer().copy(data,8);new PublicKey(creator).toBuffer().copy(data,40);
  data.writeBigUInt64LE(BigInt(amount),72);data.writeBigInt64LE(BigInt(now),80);data.writeBigInt64LE(BigInt(now+43200),88);
  data.writeBigInt64LE(BigInt(released?now+43200:0),96);data[104]=bump;return {owner:new PublicKey(programId),data};
}
function transaction(ixs){return {slot:12,blockTime:now,meta:{err:null,preBalances:[],postBalances:[]},
  transaction:{signatures:['signature'],message:new Transaction({feePayer:new PublicKey(creator),recentBlockhash:mint}).add(...ixs).compileMessage()}};}

test('merged launch targets the configured router and retains atomic ATA setup',()=>{
  for(const programId of DEVELOPER_TOKEN_LOCK_PROGRAMS){
    const instructions=developerLockLaunchInstructions({mint,creator,amount,config:{ready:true,programId,lockSeconds:43200}});
    assert.equal(instructions[1].programId.toBase58(),programId);
    assert(instructions[1].keys[3].pubkey.equals(developerLockAddresses({mint,creator,programId}).lock));
    assert(new VersionedTransaction(new TransactionMessage({payerKey:new PublicKey(creator),recentBlockhash:mint,instructions}).compileToV0Message()).serialize().length<=1232);
  }
  assert.throws(()=>developerLockLaunchInstructions({mint,creator,amount,config:{ready:true,programId:mint,lockSeconds:43200}}),/unavailable/);
  assert(!developerLockAddresses({mint,creator,programId:router}).lock.equals(developerLockAddresses({mint,creator}).lock));
});

test('merged readiness pins the router; legacy readiness uses its separate commitment',async()=>{
  const connection={getGenesisHash:async()=>genesis},seen=[];
  const readEvidence=async(_c,p)=>{seen.push(p.toBase58());return {account:{executable:true},sha256:p.toBase58()===legacy?oldHash:hash};};
  assert.equal((await developerLockConfig({connection,env,readEvidence})).ready,true);
  assert.equal((await developerLockConfig({connection,env,readEvidence,programId:legacy})).ready,true);
  assert.deepEqual(seen,[router,legacy]);
  for(const changed of [{FUNDED_V3_PROGRAM_DATA_SHA256:oldHash},{FUNDED_DEVELOPER_LOCK_LEGACY_PROGRAM_DATA_SHA256:''}]){
    assert.equal((await developerLockConfig({connection,env:{...env,...changed},readEvidence,
      programId:'FUNDED_V3_PROGRAM_DATA_SHA256' in changed?router:legacy})).ready,false);
  }
  assert.equal((await developerLockConfig({connection:{getGenesisHash:async()=>'mainnet'},env,readEvidence})).ready,false);
});

test('launch receipt markers identify both programs and reject duplicate escrow instructions',()=>{
  const quote={id:`launch_service_${now*1000}_1122334455667788`,payer:creator,recipient:mint,amountLamports:'0',
    policyHash:hash,createdAt:new Date(now*1000).toISOString(),expiresAt:new Date((now+600)*1000).toISOString()};
  for(const programId of [legacy,router]){
    const ix=developerLockInstruction({mint,creator,amount,quoteId:quote.id,programId}).instruction,tx=transaction([ix]);
    assert.equal(developerLockProgramFromTransaction(tx),programId);
    assert.equal(verifyLaunchServiceFee({transaction:tx,signature:'signature',mint,payer:creator,quote}).finalized,true);
    assert.throws(()=>developerLockProgramFromTransaction(transaction([ix,ix])),/Ambiguous/);
    ix.programId=new PublicKey(mint);
    assert.throws(()=>verifyLaunchServiceFee({transaction:transaction([ix]),signature:'signature',mint,payer:creator,quote}),/not verified/);
  }
});

for(const programId of [legacy,router])test(`release receipts verify state and token deltas for ${programId}`,async()=>{
  const addresses=developerLockAddresses({mint,creator,programId}),tx=transaction([developerReleaseInstruction({mint,creator,programId}).instruction]);
  const row=(owner,value)=>({mint,owner,uiTokenAmount:{amount:String(value)}});
  tx.meta.preTokenBalances=[row(addresses.lock.toBase58(),amount),row(creator,0)];
  tx.meta.postTokenBalances=[row(addresses.lock.toBase58(),0),row(creator,amount)];
  const connection={getTransaction:async()=>tx,getAccountInfo:async address=>{assert(address.equals(addresses.lock));return account(programId);}};
  // Old persisted receipts have no programId. They must still reconcile.
  const receipt={mint,creator,amount,signature:'signature',...(programId===legacy?{}:{programId})};
  assert.equal((await verifyDeveloperRelease({connection,mint,creator,receipt})).status,'finalized');
  assert.throws(()=>decodeDeveloperTokenLock(account(programId),{mint,creator,programId:programId===legacy?router:legacy}),/identity/);
  tx.meta.postTokenBalances=[row(addresses.lock.toBase58(),0),row(creator,0)];
  await assert.rejects(()=>verifyDeveloperRelease({connection,mint,creator,receipt}),/balance changes/);
});

test('pending releases are separated by program and never silently retargeted',async()=>{
  assert.equal(developerReleaseStorageKey(mint,creator),`funded.developer-release.devnet:${mint}:${creator}`);
  assert.notEqual(developerReleaseStorageKey(mint,creator),developerReleaseStorageKey(mint,creator,router));
  await assert.rejects(()=>releaseDeveloperTokens({connection:{getGenesisHash:async()=>genesis},mint,creator,amount,programId:router,
    storage:{getItem:()=>JSON.stringify({mint,creator,amount,signature:'old'})}}),/identity differs/);
});

for(const programId of [legacy,router])test(`protection endpoint reads the saved program after cutover: ${programId}`,async()=>{
  const addresses=developerLockAddresses({mint,creator,programId});
  const vault=Buffer.alloc(AccountLayout.span);AccountLayout.encode({mint:new PublicKey(mint),owner:addresses.lock,amount:BigInt(amount),
    delegateOption:0,delegate:new PublicKey(mint),state:1,isNativeOption:0,isNative:0n,delegatedAmount:0n,closeAuthorityOption:0,closeAuthority:new PublicKey(mint)},vault);
  let response;
  const handler=createLaunchProtectionRoutes({solanaCluster:'devnet',env,clientKey:()=>'',
    store:{readLaunch:async()=>({onchainVerified:true,cluster:'devnet',creatorWallet:creator,developerTokenLock:{verified:true,amount,...(programId===router?{programId}:{})}})},
    configReader:async args=>{assert.equal(args.programId,programId);return {ready:true,programId};},
    connectionFactory:()=>({getAccountInfo:async address=>address.equals(addresses.lock)?account(programId,false):{owner:TOKEN_2022_PROGRAM_ID,data:vault},
      getSlot:async()=>100,getBlockTime:async()=>now+43200}),respond:(_res,status,body)=>{response={status,body};}});
  await handler({method:'GET'},{},new URL(`https://example.test/api/tokens/${mint}/launch-protection`));
  assert.equal(response.status,200);assert.equal(response.body.tokenLock.programId,programId);assert.equal(response.body.tokenLock.status,'claimable');
});
