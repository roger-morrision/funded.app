import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {Keypair} from '@solana/web3.js';
import {NATIVE_MINT} from '@solana/spl-token';
import {PUMP_PROGRAM_ID} from '@pump-fun/pump-sdk';
import {PUMP_AMM_PROGRAM_ID,canonicalPumpPoolPda} from '@pump-fun/pump-swap-sdk';
import bs58 from 'bs58';
import {enqueueLaunchPostEmail,createLaunchPostEmailWorker,launchPostEmailDraft} from '../server/launch-post-email.mjs';
import {createMigrationPostEmailWatcher} from '../server/migration-post-email.mjs';
import {verifyMigrationEmailProof,discoverMigrationEmailProof} from '../server/promotion-migration-proof.mjs';
const key=()=>Keypair.generate().publicKey.toBase58(),sig=n=>bs58.encode(Buffer.alloc(64,n));
const env={FUNDED_LAUNCH_POST_EMAIL_ENABLED:'true',PUBLIC_APP_URL:'https://richpad.fun',FUNDED_ADMIN_EMAIL_PROVIDER:'gmail',
 FUNDED_ADMIN_EMAIL:'admin@richpad.fun',FUNDED_ADMIN_EMAIL_FROM:'fixture@gmail.com',FUNDED_ADMIN_GMAIL_APP_PASSWORD:'abcdefghijklmnop'};
function fixture(){
 const launch={cluster:'devnet',mint:key(),signature:sig(2),slot:100,name:'Test coin',symbol:'TEST',creator:key(),creatorWallet:key(),onchainVerified:true,
 pumpFeeRoute:{verified:true,scope:'per-mint-v3',transaction:sig(2)},creatorLaunchBurn:{status:'verified',tier:'pro',amountTokens:100000,fundedMint:key()},
 feeDistribution:{creatorDirected:{shares:{creatorWalletPercent:30,holderAirdropPercent:50,solClaimPercent:0}}},
 communityAllocation:3,developerTokenLock:{verified:true,amount:'100',lockSeconds:43200}};
 let state={launches:{[launch.mint]:launch}},time=1794290000000;
 const store={read:async()=>structuredClone(state),update:async fn=>fn(state)};
 enqueueLaunchPostEmail(state,launch,{env,cluster:'devnet',now:time});
 const proof={mint:launch.mint,cluster:'devnet',signature:sig(3),slot:200,verified:true,commitment:'finalized'};
 return {launch,store,proof,state,advance:()=>time+=300001,options:{store,env,cluster:'devnet',now:()=>time,logger:{error(){}},
 connection:{getGenesisHash:async()=> 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG'}}};
}
test('paid registration queues distinct launch and migration events without duplicate registration emails',()=>{
 const f=fixture();enqueueLaunchPostEmail(f.state,f.launch,{env,cluster:'devnet'});
 assert.equal(Object.keys(f.state.launchPostEmails).length,2);
 const rows=Object.values(f.state.launchPostEmails);assert.equal(rows[0].status,'pending');assert.equal(rows[1].status,'awaiting-migration');
 assert.match(rows[0].text,/New launch: \$TEST/);assert.match(rows[0].text,/100,000/);
});
test('migration watcher waits, survives restart, and parallel replicas enqueue once',async()=>{
 const f=fixture();let reads=0;
 const options={...f.options,discover:async()=>{reads++;return {before:'cursor'};}};
 assert.equal((await createMigrationPostEmailWatcher(options).tick()).status,'waiting');
 f.advance();options.discover=async input=>{assert.equal(input.before,'cursor');return {proof:f.proof};};
 const results=await Promise.all([createMigrationPostEmailWatcher(options).tick(),createMigrationPostEmailWatcher(options).tick()]);
 assert.equal(results.filter(r=>r.status==='queued').length,1);
 const row=Object.values(f.state.launchPostEmails).find(r=>r.event==='migration');
 assert.equal(row.status,'pending');assert.match(row.text,/^\$TEST is migrated/);
 assert.equal((await createMigrationPostEmailWatcher(options).tick()).status,'idle');
});
test('invalid migration never queues a draft and absent watches are not backfilled',async()=>{
 const f=fixture();const options={...f.options,discover:async()=>({proof:{...f.proof,mint:key()}})};
 assert.equal((await createMigrationPostEmailWatcher(options).tick()).status,'unavailable');
 assert.equal(Object.values(f.state.launchPostEmails)[1].status,'awaiting-migration');
 f.state.launchPostEmails={};assert.equal((await createMigrationPostEmailWatcher(options).tick()).status,'idle');
 for(const change of [{cluster:'mainnet-beta'},{env:{...env,FUNDED_API_ONLY:'true'}}])assert.equal((await createMigrationPostEmailWatcher({...options,...change}).tick()).status,'disabled');
});
test('migration dispatch re-verifies both event proof and paid burn, then never resends',async()=>{
 const f=fixture();Object.values(f.state.launchPostEmails)[0].status='sent';
 await createMigrationPostEmailWatcher({...f.options,discover:async()=>({proof:f.proof})}).tick();
 let sent=0;const options={...f.options,verifyMigration:async()=>({...f.proof,slot:201}),
 verifyLaunch:async()=>({...f.launch,feePayer:f.launch.creatorWallet}),deliver:async()=>{sent++;return {accepted:true};}};
 assert.equal((await createLaunchPostEmailWorker(options).tick()).status,'verification-pending');assert.equal(sent,0);
 f.advance();options.verifyMigration=async()=>f.proof;
 assert.equal((await createLaunchPostEmailWorker(options).tick()).status,'sent');
 f.advance();assert.equal((await createLaunchPostEmailWorker(options).tick()).status,'idle');assert.equal(sent,1);
});
test('legacy queued draft remains verifiable after the content upgrade',async()=>{
 const f=fixture();const draft=launchPostEmailDraft(f.launch,{cluster:'devnet',origin:env.PUBLIC_APP_URL,version:1});
 f.state.launchPostEmails={[draft.id]:{...draft,status:'pending',createdAt:0,nextAttemptAt:0,attempts:0}};
 const result=await createLaunchPostEmailWorker({...f.options,verifyLaunch:async()=>({...f.launch,feePayer:f.launch.creatorWallet}),deliver:async()=>({accepted:true})}).tick();
 assert.equal(result.status,'sent');
});
test('only finalized canonical pool creation proves migration; failed and no-op receipts do not',async()=>{
 const mint=Keypair.generate().publicKey,pool=canonicalPumpPoolPda(mint,NATIVE_MINT),signature=sig(6);
 const disc=name=>bs58.encode(createHash('sha256').update('global:'+name).digest().subarray(0,8));
 const transaction={slot:200,blockTime:1794290000,transaction:{signatures:[signature],message:{accountKeys:[PUMP_PROGRAM_ID,PUMP_AMM_PROGRAM_ID,pool,mint,NATIVE_MINT],
 instructions:[{programIdIndex:0,accounts:[3,2],data:disc('migrate_v2')}]}},meta:{err:null,innerInstructions:[{index:0,instructions:[{programIdIndex:1,accounts:[2,0,0,3,4],data:disc('create_pool')}]}]}};
 const connection={getGenesisHash:async()=> 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG',getTransaction:async()=>transaction,
 getAccountInfo:async()=>({owner:PUMP_AMM_PROGRAM_ID}),getSignaturesForAddress:async()=>[{signature,slot:200,err:null}]};
 const input={connection,cluster:'devnet',mint:mint.toBase58(),signature,launchSlot:100};
 assert((await verifyMigrationEmailProof(input)).verified);assert((await discoverMigrationEmailProof(input)).proof);
 transaction.meta.innerInstructions=[];
 await assert.rejects(verifyMigrationEmailProof(input));assert(!(await discoverMigrationEmailProof(input)).proof);
 transaction.meta.err={InstructionError:[0,'failed']};await assert.rejects(verifyMigrationEmailProof(input));
});
