import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { parseEnv } from 'node:util';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import BN from 'bn.js';
import bs58 from 'bs58';
import { Connection, Keypair, PublicKey, Transaction, VersionedTransaction, ComputeBudgetProgram } from '@solana/web3.js';
import { OnlinePumpSdk, PUMP_SDK, getBuyTokenAmountFromSolAmount } from '@pump-fun/pump-sdk';
import { NATIVE_MINT, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { canonicalPumpPoolPda, PUMP_AMM_PROGRAM_ID } from '@pump-fun/pump-swap-sdk';
import { buildTradeTransaction } from '../pump-trading.js';
import { DEVNET_GENESIS_HASH, readProgramDataEvidence, rewardAddresses } from '../server/automatic-reward-chain.mjs';
import { captureExactCommunitySnapshot, verifyPumpMigrationTransaction } from '../server/community-snapshot.mjs';
import { communityAddresses } from '../server/community-claim-chain.mjs';
import { buildCommunityManifest } from '../community-merkle.js';

// One existing disposable QA coin only. New keys, faucet requests and live wallets are unnecessary.
const mint=new PublicKey('52TdgMLp41CtiLrAqqZ1N889RPfWMMzxwpF8MoaZFvN1');
const creator=new PublicKey('8ZCtLWxvBGwniEgybr1k89wS9NSaKrgxF4kPDvGvn1Wk');
const authority=new PublicKey('7epA9KQ5wkwo5wZ5kcY8CfVUvpwVJoAMz2RNqt2ZwK5Y');
const program=new PublicKey('9H1r2nTZs6gQaheYTMaBWpH12JX6dCFj2Rvxg7Lno2Sm');
const execute=process.argv.includes('--execute');
const maxSol=Number(process.argv.find(v=>v.startsWith('--max-sol='))?.slice(10));
assert(Number.isFinite(maxSol)&&maxSol>0&&maxSol<=0.33,'Supply --max-sol=<at most 0.33 Devnet SOL>.');
const cap=BigInt(Math.floor(maxSol*1e9)),base='https://funded.vip';
const env=parseEnv(readFileSync('.env.deploy','utf8'));
const c=new Connection(readFileSync('.secrets/solana-devnet-rpc-url','utf8').trim(),'finalized');
assert.equal(await c.getGenesisHash(),DEVNET_GENESIS_HASH);
assert.equal((await readProgramDataEvidence(c,program)).sha256,env.FUNDED_V3_PROGRAM_DATA_SHA256);
async function get(path){const r=await fetch(base+path,{signal:AbortSignal.timeout(30000)});assert(r.ok,path);return r.json();}
const capabilities=await get('/api/capabilities');assert.equal(capabilities.cluster,'devnet');
if(execute)assert.equal(capabilities.build,execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),'Deploy the exact reviewed source first.');
const launch=(await get('/api/launches')).find(r=>r.mint===mint.toBase58());
assert(launch?.onchainVerified&&launch.creatorWallet===creator.toBase58()&&launch.pumpFeeRoute?.scope==='per-mint-v3');
assert.equal(launch.pumpFeeRoute.programId,program.toBase58());
assert.equal(launch.communityAirdrop.reservedTokens,30_000_000);
const sdk=new OnlinePumpSdk(c),global=await sdk.fetchGlobal(),buyState=await sdk.fetchBuyState(mint,creator);
const pool=canonicalPumpPoolPda(mint,NATIVE_MINT),poolInfo=await c.getAccountInfo(pool,'finalized');
const journalPath='tmp/genuine-migration-52-journal.json';
const journal=existsSync(journalPath)?JSON.parse(readFileSync(journalPath,'utf8')):{mint:mint.toBase58(),startedAt:new Date().toISOString()};
assert.equal(journal.mint,mint.toBase58());
if(poolInfo?.owner.equals(PUMP_AMM_PROGRAM_ID))assert(journal.migrationSignature,'Existing migrations need their original archived evidence; do not invent a new cutoff.');
const startBalance=await c.getBalance(creator,'finalized');
let buy=null,reviewedBuy=0n;
if(!buyState.bondingCurve.complete){
  const remaining=BigInt(buyState.bondingCurve.realTokenReserves.toString());
  let low=0n,high=cap;
  const output=amount=>BigInt(getBuyTokenAmountFromSolAmount({global,bondingCurve:buyState.bondingCurve,amount:new BN(amount.toString())}).toString());
  assert(output(high)>=remaining,'Finishing the curve exceeds the bounded QA budget.');
  while(low<high){const mid=(low+high)>>1n;if(output(mid)>=remaining)high=mid;else low=mid+1n;}
  buy=await buildTradeTransaction({connection:c,side:'buy',mint,user:creator,amount:Number(low+2_000_000n)/1e9,
    slippagePercent:3,feeOwner:new PublicKey('CmhmRtKYExJC76R5nsPV9ovPYacoEQFEL7VhaKRZmLy2')});
  reviewedBuy=BigInt(buy.quoteAmount.toString())*10300n/10000n+BigInt(buy.feeLamports)+10_000_000n;
}
const migrationReserve=poolInfo?.owner.equals(PUMP_AMM_PROGRAM_ID)?0n:150_000_000n;
assert(reviewedBuy+migrationReserve<=cap,'Quoted buy plus migration reserve exceeds the cap.');
assert(BigInt(startBalance)>reviewedBuy+migrationReserve+10_000n,'QA creator needs the bounded budget and fee buffer.');
console.log(JSON.stringify({stage:'preflight',execute,mint:mint.toBase58(),creator:creator.toBase58(),capLamports:String(cap),
  balanceLamports:String(startBalance),reviewedMaxBuyLamports:String(reviewedBuy),migrationReserveLamports:String(migrationReserve)}));
if(!execute)process.exit(0);
const signer=Keypair.fromSecretKey(bs58.decode(readFileSync('.secrets/solana-devnet-creator-secret-key','utf8').trim()));
assert(signer.publicKey.equals(creator));
const save=()=>writeFileSync(journalPath,JSON.stringify(journal,null,2));
journal.initialBalanceLamports??=String(startBalance);save();
async function send(instructions,step){
  assert(!journal[step+'Pending'],'Reconcile the recorded pending transaction before retrying.');
  const latest=await c.getLatestBlockhash('finalized');
  const tx=new Transaction({feePayer:creator,recentBlockhash:latest.blockhash}).add(...instructions);tx.sign(signer);
  const versioned=new VersionedTransaction(tx.compileMessage());versioned.sign([signer]);
  const before=await c.getBalance(creator,'confirmed');
  const simulation=await c.simulateTransaction(versioned,{sigVerify:true,commitment:'confirmed',accounts:{encoding:'base64',addresses:[creator.toBase58()]}});
  assert.equal(simulation.value.err,null,'QA transaction simulation failed.');
  const projected=simulation.value.accounts?.[0]?.lamports;assert(Number.isSafeInteger(projected));
  const alreadySpent=BigInt(journal.initialBalanceLamports)-BigInt(before);
  const fee=(await c.getFeeForMessage(tx.compileMessage(),'confirmed')).value;assert(Number.isSafeInteger(fee));
  assert(alreadySpent+BigInt(Math.max(0,before-projected))+BigInt(fee)+10_000n<=cap,'Simulated total debit exceeds the QA cap.');
  const signature=bs58.encode(tx.signature);journal[step+'Pending']=signature;save();
  assert.equal(await c.sendRawTransaction(tx.serialize(),{skipPreflight:false}),signature);
  const confirmed=await c.confirmTransaction({signature,...latest},'finalized');assert.equal(confirmed.value.err,null);
  journal[step+'Signature']=signature;delete journal[step+'Pending'];save();
  const spent=BigInt(journal.initialBalanceLamports)-BigInt(await c.getBalance(creator,'finalized'));assert(spent<=cap);
  console.log(JSON.stringify({stage:step+'-finalized',signature,creatorDebitLamports:String(spent)}));return signature;
}
if(buy)await send(buy.instructions,'buy');
assert((await sdk.fetchBuyState(mint,creator)).bondingCurve.complete,'The finishing buy did not complete the curve.');
if(!poolInfo?.owner.equals(PUMP_AMM_PROGRAM_ID)){
  const ix=await PUMP_SDK.migrateV2Instruction({withdrawAuthority:global.withdrawAuthority,mint,user:creator,
    quoteMint:NATIVE_MINT,baseTokenProgram:buyState.tokenProgram|| (await c.getAccountInfo(mint,'finalized')).owner,quoteTokenProgram:TOKEN_PROGRAM_ID});
  await send([ComputeBudgetProgram.setComputeUnitLimit({units:500_000}),ix],'migration');
}
const migration=await c.getTransaction(journal.migrationSignature,{commitment:'finalized',maxSupportedTransactionVersion:0});
verifyPumpMigrationTransaction({transaction:migration,launchMint:mint});
const eligibilityMint=new PublicKey(env.FUNDED_TOKEN_MINT||env.VITE_FUNDED_TOKEN_MINT||'C5JFX2W3YtLDmiZeUTcYjfLqXPWmW2GZZC5fbxv7ut64');
const archivePath='tmp/genuine-migration-52-replay.json.gz';
const snapshot=await captureExactCommunitySnapshot({connection:c,mint:eligibilityMint,launchMint:mint,migrationSignature:journal.migrationSignature,
  onEvidence:packet=>{const bytes=gzipSync(JSON.stringify(packet,(_k,v)=>typeof v==='bigint'?String(v):v));writeFileSync(archivePath,bytes);
    journal.archiveSha256=createHash('sha256').update(bytes).digest('hex');journal.archivePath=archivePath;save();}});
const {drop}=communityAddresses({programId:program,authority,mint});
const {vault}=rewardAddresses({programId:program,authority,mint});
const mintInfo=await c.getAccountInfo(mint,'finalized');
const manifest=buildCommunityManifest({drop:drop.toBase58(),launchMint:mint.toBase58(),eligibilityMint:eligibilityMint.toBase58(),
  migrationSignature:journal.migrationSignature,migrationSlot:snapshot.slot,migrationBlockTime:snapshot.blockTime,snapshot,
  amountBaseUnits:String(30_000_000n*10n**BigInt(mintInfo.data[44])),excludedWallets:[authority.toBase58(),vault.toBase58(),drop.toBase58()]});
const response=await fetch(base+'/api/airdrops/claims/prepare',{method:'POST',headers:{origin:base,'content-type':'application/json',
  authorization:'Bearer '+readFileSync('.secrets/funded-api-token','utf8').trim()},
  body:JSON.stringify({mint:mint.toBase58(),migrationSignature:journal.migrationSignature}),signal:AbortSignal.timeout(90000)});
const prepared=await response.json();assert(response.ok,prepared.error);assert.equal(prepared.snapshotBasis,'pump-migration');
assert.equal(prepared.root,manifest.root);assert.equal(prepared.snapshotHash,manifest.snapshotHash);
assert.equal(prepared.migrationSlot,snapshot.slot);assert.equal(prepared.recipients,manifest.leaves.length);
journal.reviewedManifest=manifest;journal.snapshot=snapshot;journal.prepared=prepared;journal.finishedAt=new Date().toISOString();save();
console.log(JSON.stringify({stage:'genuine-migration-manifest-independently-matched',migrationSignature:journal.migrationSignature,
  migrationSlot:snapshot.slot,root:manifest.root,snapshotHash:manifest.snapshotHash,recipients:manifest.leaves.length,archivePath}));
process.exit(0);
