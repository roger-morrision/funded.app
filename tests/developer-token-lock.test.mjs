import test from 'node:test';
import assert from 'node:assert/strict';
import {Keypair,PublicKey,Transaction} from '@solana/web3.js';
import {developerLockAddresses,developerLockInstruction,developerLockLaunchInstructions,developerReleaseInstruction,decodeDeveloperTokenLock,DEVELOPER_TOKEN_LOCK_PROGRAM_ID} from '../developer-token-lock.js';
import {verifyLaunchDeveloperLock,developerLockConfig} from '../server/developer-token-lock.mjs';
import {verifyDeveloperRelease,releaseDeveloperTokens,developerReleaseStorageKey} from '../developer-token-release.js';
import {mint,creator,signature,time,lockAccount,launchReceipt,eventLogs} from './fixtures/developer-protection.mjs';
const config={ready:true,programId:DEVELOPER_TOKEN_LOCK_PROGRAM_ID,lockSeconds:43200,programDataSha256:'a'.repeat(64)};
const genesis='EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
const verify=transaction=>verifyLaunchDeveloperLock({connection:{getAccountInfo:async()=>lockAccount()},proof:{mint,feePayer:creator,signature,slot:100,createdTimestamp:time},reserve:{fundedTokens:100,vault:Keypair.generate().publicKey.toBase58()},transaction,config});
test('lock client binds exact atomic amount, mint and creator and fails closed on missing deployment',()=>{
 const instruction=developerLockInstruction({mint,creator,amount:123n}).instruction;
 assert.equal(instruction.data.readBigUInt64LE(8),123n);assert.equal(instruction.keys[0].pubkey.toBase58(),creator);assert(instruction.keys[0].isSigner);
 assert.throws(()=>developerLockInstruction({mint,creator,amount:0}),/positive/);
 assert.throws(()=>developerLockLaunchInstructions({mint,creator,amount:1,config:{...config,ready:false}}),/unavailable/);
 assert.deepEqual(developerLockLaunchInstructions({mint,creator,amount:0}),[]);
 assert.equal(developerLockLaunchInstructions({mint,creator,amount:1,config}).length,1);
});
test('escrow decoder rejects a wrong owner, beneficiary, malformed account and altered deadline',()=>{
 assert.equal(decodeDeveloperTokenLock(lockAccount(),{mint,creator}).unlockAt,time+43200);
 for(const account of [{...lockAccount(),owner:PublicKey.default},{...lockAccount(),data:Buffer.alloc(105)},lockAccount()]){
  if(account.data[0]===201)account.data.writeBigInt64LE(BigInt(time+1),88);
  assert.throws(()=>decodeDeveloperTokenLock(account,{mint,creator}));
 }
 assert.throws(()=>decodeDeveloperTokenLock(lockAccount(),{mint,creator:Keypair.generate().publicKey.toBase58()}));
});
test('deployment readiness requires the exact program-data hash and Devnet',async()=>{
 const connection={getGenesisHash:async()=>genesis};const readEvidence=async()=>({account:{executable:true},sha256:'a'.repeat(64)});
 assert.equal((await developerLockConfig({connection,readEvidence,env:{}})).ready,false);
 assert.equal((await developerLockConfig({connection,readEvidence,env:{FUNDED_DEVELOPER_LOCK_PROGRAM_DATA_SHA256:'a'.repeat(64)}})).ready,true);
 connection.getGenesisHash=async()=>'mainnet';assert.equal((await developerLockConfig({connection,readEvidence,env:{FUNDED_DEVELOPER_LOCK_PROGRAM_DATA_SHA256:'a'.repeat(64)}})).ready,false);
});
test('registration verifies the atomic purchase-minus-reserve amount and exact escrow instruction',async()=>{
 const result=await verify(launchReceipt());assert.equal(result.amount,'1');assert.equal(result.atomicWithLaunch,true);
 const altered=launchReceipt();altered.transaction.message.instructions[0].data='1';await assert.rejects(verify(altered),/exact developer escrow/);
 const retained=launchReceipt();retained.meta.postTokenBalances[0].uiTokenAmount.amount='1';await assert.rejects(verify(retained),/unexpected launch token recipients/);
 const reused=launchReceipt();reused.meta.preBalances.fill(1);await assert.rejects(verify(reused),/initialized in the launch/);
 const foreign=launchReceipt();foreign.meta.logMessages=eventLogs({wallet:Keypair.generate().publicKey.toBase58()});await assert.rejects(verify(foreign),/unexpected buyer/);
 const unsafe=launchReceipt();unsafe.meta.err={InstructionError:[0,'Custom']};await assert.rejects(verify(unsafe),/finalized launch/);
});
test('registration binds a compact escrow marker to the exact saved service quote',async()=>{
 const quoteId='launch_service_1_0123456789abcdef',tx=launchReceipt();
 tx.transaction.message=new Transaction({feePayer:new PublicKey(creator),recentBlockhash:PublicKey.default.toBase58()})
  .add(developerLockInstruction({mint,creator,amount:1n,quoteId}).instruction).compileMessage();
 const input={connection:{getAccountInfo:async()=>lockAccount()},proof:{mint,feePayer:creator,signature,slot:100,createdTimestamp:time},reserve:{fundedTokens:100,vault:Keypair.generate().publicKey.toBase58()},transaction:tx,config,serviceQuote:{id:quoteId}};
 assert.equal((await verifyLaunchDeveloperLock(input)).amount,'1');
 input.serviceQuote.id='launch_service_1_1123456789abcdef';await assert.rejects(verifyLaunchDeveloperLock(input),/exact developer escrow/);
});
test('release receipt requires escrow state, exact instruction and both token balance changes',async()=>{
 const message=new Transaction({feePayer:new PublicKey(creator),recentBlockhash:PublicKey.default.toBase58()}).add(developerReleaseInstruction({mint,creator}).instruction).compileMessage();
 const owner=developerLockAddresses({mint,creator}).lock.toBase58(),row=(owner,amount)=>({mint,owner,uiTokenAmount:{amount}});
 const tx={transaction:{signatures:[signature],message},meta:{err:null,preTokenBalances:[row(owner,'1'),row(creator,'0')],postTokenBalances:[row(owner,'0'),row(creator,'1')]}};
 const connection={getTransaction:async()=>tx,getAccountInfo:async()=>lockAccount({releasedAt:time+43200})},receipt={signature,amount:'1'};
 assert.equal((await verifyDeveloperRelease({connection,mint,creator,receipt})).status,'finalized');
 tx.meta.postTokenBalances[1].uiTokenAmount.amount='0';await assert.rejects(verifyDeveloperRelease({connection,mint,creator,receipt}),/balance changes/);
 tx.meta.postTokenBalances[1].uiTokenAmount.amount='1';message.instructions=[];await assert.rejects(verifyDeveloperRelease({connection,mint,creator,receipt}),/instruction is missing/);
});
test('pending token release is reconciled without signing again, and only finalized expiry clears it',async()=>{
 const values=new Map(),key=developerReleaseStorageKey(mint,creator),receipt={mint,creator,signature,amount:'1',lastValidBlockHeight:100};
 const storage={getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};storage.setItem(key,JSON.stringify(receipt));
 const connection={getGenesisHash:async()=>genesis,getTransaction:async()=>null,getBlockHeight:async()=>99,getSignatureStatuses:async()=>({value:[null]})};
 const provider={signTransaction:async()=>{throw Error('Must not sign again');}};
 assert.equal((await releaseDeveloperTokens({connection,provider,mint,creator,amount:1,storage})).status,'pending');assert(values.has(key));
 connection.getBlockHeight=async()=>101;assert.equal((await releaseDeveloperTokens({connection,provider,mint,creator,amount:1,storage})).reason,'expired-unlanded');assert(!values.has(key));
});
