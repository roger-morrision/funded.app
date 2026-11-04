import {execFileSync} from 'node:child_process';
import {readFile,writeFile} from 'node:fs/promises';
const apply=process.argv.includes('--apply'),path='tmp/automation-release/bonus-reconciliation-review.json';
const input={apply,...(apply?{review:JSON.parse(await readFile(path,'utf8'))}:{})};
const script=String.raw`
import assert from 'node:assert/strict';import{readFileSync}from'node:fs';
import{loadServerEnvironment}from'./server/environment.mjs';import{createPostgresStore}from'./server/postgres-store.mjs';
import{createAutomaticRewardStore}from'./server/automatic-reward-store.mjs';import{rewardLedgerPath}from'./server/reward-ledger-path.mjs';
import{createDailyBonusService}from'./server/daily-bonus-service.mjs';import{bonusSchedule}from'./server/daily-bonus-schedule.mjs';
import{SharedRpcConnection}from'./server/rpc-connection.mjs';import{Keypair}from'@solana/web3.js';import bs58 from'bs58';
loadServerEnvironment();assert.equal(process.env.SOLANA_CLUSTER,'devnet');
assert.equal(process.env.FUNDED_BUILD_ID,'8c2d06f18484ebcb35bc33e9e7bc9eb5498ae693');
const input=JSON.parse(readFileSync(0,'utf8')),store=createPostgresStore(process.env.DATABASE_URL),rewardStore=createAutomaticRewardStore(rewardLedgerPath());
const source='5jwbViNDokSVbUamLhcS3EPs9j4ebRy96hcAMVZ2ew9E3Dw9a7T8RwUWFDdb5y8zfftXDhGuBHxQMhFH47ZcBpfL';
try{
 const app=await store.read(),settled=app.v3Settlements[source],ledger=await rewardStore.read();
 assert.equal(settled.status,'finalized');assert.equal(app.v3CommunityFunding[source].status,'finalized');
 assert.equal(app.v3CommunityFunding[source].amount,'404963');
 const row=Object.values(ledger.dailyBonusSnapshots||{}).find(row=>row.snapshot.qa&&row.snapshot.start<=settled.blockTime&&row.snapshot.end>settled.blockTime);
 assert(row);assert.equal(row.snapshot.sources.length,0);assert.equal(Object.keys(row.payouts||{}).length,0);assert(!ledger.dailyBonusAssignments?.[source]);
 const authority=Keypair.fromSecretKey(bs58.decode(process.env.FUNDED_V3_ROUTER_AUTHORITY_SECRET_KEY));
 assert.equal(authority.publicKey.toBase58(),'7epA9KQ5wkwo5wZ5kcY8CfVUvpwVJoAMz2RNqt2ZwK5Y');
 const service=createDailyBonusService({store,rewardStore,connection:new SharedRpcConnection(process.env.SOLANA_RPC_URL,'finalized'),
   programId:process.env.FUNDED_V3_FEE_ROUTER_PROGRAM_ID,authority,cluster:'devnet',
   expectedProgramDataSha256:process.env.FUNDED_V3_PROGRAM_DATA_SHA256,payoutEnabled:true,schedule:bonusSchedule({cluster:'devnet',env:process.env})});
 const review=await service.review(row.snapshot.day,row.snapshot.hash);assert.equal(review.mode,'replace-unused-v1');assert.equal(review.sources,1);
 assert.equal(review.rankings.creators[0].wallet,app.launches[settled.mint].creatorWallet);
 if(input.apply){
   assert.equal(review.expectedHash,input.review.expectedHash);assert.equal(review.expectedNewHash,input.review.expectedNewHash);
   await service.reconcile(row.snapshot.day,{expectedHash:review.expectedHash,expectedNewHash:review.expectedNewHash,
     actor:'devnet-automation-acceptance',reason:'Repair an unused empty QA snapshot after verified automatic settlement discriminator detection; preserve the original snapshot in its audit revision.'});
 }
 console.log(JSON.stringify({...review,source,applied:input.apply,at:new Date().toISOString()}));
}finally{await store.close()}
`;
try{
  const result=JSON.parse(execFileSync('docker',['exec','-i','fundedapp-app-1','node','--input-type=module','-e',script],{
    input:JSON.stringify(input),encoding:'utf8',timeout:180000,maxBuffer:2*1024*1024}));
  await writeFile(apply?'tmp/automation-release/bonus-reconciliation-applied.json':path,JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}catch(error){console.error(String(error.stderr||error.message).replace(/https?:\/\/[^\s"']+/g,'[redacted-url]'));process.exitCode=1;}
