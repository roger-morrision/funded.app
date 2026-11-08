import test from 'node:test';
import assert from 'node:assert/strict';
import {PublicKey,Transaction} from '@solana/web3.js';
import {normalizeDeveloperLockSeconds,DEVELOPER_TOKEN_LOCK_PERIODS} from '../developer-lock-period.js';
import {developerLockInstruction,decodeDeveloperLockInstruction,developerLockLaunchInstructions,developerLockAddresses,
  decodeDeveloperTokenLock,DEVELOPER_TOKEN_LOCK_PROGRAMS} from '../developer-token-lock.js';
import {developerLockProgramFromTransaction,developerLockConfig} from '../server/developer-token-lock.mjs';
import {verifyLaunchServiceFee} from '../server/launch-service-fee-proof.mjs';
import {canonicalLaunchPolicy,launchPolicyStatement} from '../launch-policy-auth.js';
import {buildFeeDistributionPolicy} from '../distribution-policy.js';

const [legacy,programId]=DEVELOPER_TOKEN_LOCK_PROGRAMS;
const mint=new PublicKey(new Uint8Array(32).fill(21)).toBase58(),creator=new PublicKey(new Uint8Array(32).fill(22)).toBase58();
const now=1_800_000_000,quote={id:`launch_service_${now*1000}_1122334455667788`,payer:creator,recipient:mint,
  amountLamports:'0',policyHash:'ab'.repeat(32),createdAt:new Date(now*1000).toISOString(),expiresAt:new Date((now+600)*1000).toISOString()};
const transaction=instruction=>({slot:12,blockTime:now,meta:{err:null,preBalances:[],postBalances:[]},transaction:{signatures:['signature'],
  message:new Transaction({feePayer:new PublicKey(creator),recentBlockhash:mint}).add(instruction).compileMessage()}});

for(const lockSeconds of DEVELOPER_TOKEN_LOCK_PERIODS)test(`${lockSeconds/3600}h encodes exact custody, quote binding and immutable deadline`,()=>{
  const ix=developerLockInstruction({mint,creator,amount:123n,quoteId:quote.id,programId,lockSeconds}).instruction;
  assert.deepEqual(decodeDeveloperLockInstruction(ix.data),{amount:123n,lockSeconds});
  assert.equal(developerLockProgramFromTransaction(transaction(ix)),programId);
  assert.equal(verifyLaunchServiceFee({transaction:transaction(ix),signature:'signature',mint,payer:creator,quote}).finalized,true);
  assert.equal(developerLockLaunchInstructions({mint,creator,amount:123n,lockSeconds,config:{ready:true,programId,lockPeriodsSeconds:DEVELOPER_TOKEN_LOCK_PERIODS}}).length,2);
  const data=Buffer.alloc(105);Buffer.from('c9e00b0c19713f1d','hex').copy(data);new PublicKey(mint).toBuffer().copy(data,8);new PublicKey(creator).toBuffer().copy(data,40);
  data.writeBigUInt64LE(123n,72);data.writeBigInt64LE(BigInt(now),80);data.writeBigInt64LE(BigInt(now+lockSeconds),88);
  data[104]=developerLockAddresses({mint,creator,programId}).bump;
  const account={owner:new PublicKey(programId),data};
  assert.equal(decodeDeveloperTokenLock(account,{mint,creator,programId}).lockSeconds,lockSeconds);
  data.writeBigInt64LE(BigInt(now+lockSeconds-1),96);
  assert.throws(()=>decodeDeveloperTokenLock(account,{mint,creator,programId}),/timing/);
  ix.data[ix.data.length-1]^=1;
  assert.throws(()=>verifyLaunchServiceFee({transaction:transaction(ix),signature:'signature',mint,payer:creator,quote}),/not verified/);
});

test('invalid periods and unavailable deployed instructions stop before signing; zero buys need no escrow',()=>{
  assert.equal(normalizeDeveloperLockSeconds(),43200);
  for(const value of [0,-1,21601,43200.5,604800,null,'',NaN])assert.throws(()=>normalizeDeveloperLockSeconds(value),/Choose/);
  for(const seconds of [21600,86400,172800]){
    assert.throws(()=>developerLockLaunchInstructions({mint,creator,amount:1n,lockSeconds:seconds,config:{ready:true,programId,lockSeconds:43200}}),/unavailable/);
    assert.throws(()=>developerLockInstruction({mint,creator,amount:1n,lockSeconds:seconds,programId:legacy}),/legacy/);
    assert.deepEqual(developerLockLaunchInstructions({mint,creator,amount:0n,lockSeconds:seconds}),[]);
  }
});

test('the signed launch policy binds the chosen period while preserving old signatures',()=>{
  const policy={mint,creatorWallet:creator,cluster:'devnet',signature:'signature',communityAllocation:3,pumpFeeRoute:{router:programId},
    feeDistribution:buildFeeDistributionPolicy({creatorWalletPercent:80,holderAirdropPercent:0,solClaimPercent:0,feeRouterAddress:programId})};
  assert.equal(Object.hasOwn(canonicalLaunchPolicy(policy),'developerLockSeconds'),false);
  const statements=DEVELOPER_TOKEN_LOCK_PERIODS.map(developerLockSeconds=>launchPolicyStatement({...policy,developerLockSeconds}));
  assert.equal(new Set(statements).size,4);
  assert.throws(()=>launchPolicyStatement({...policy,developerLockSeconds:3600}),/Choose/);
});

test('a configured hash alone cannot advertise selectable periods for old program bytes',async()=>{
  const hash='ab'.repeat(32),env={FUNDED_DEVELOPER_LOCK_PROGRAM_ID:programId,FUNDED_V3_FEE_ROUTER_PROGRAM_ID:programId,
    FUNDED_DEVELOPER_LOCK_PROGRAM_DATA_SHA256:hash,FUNDED_V3_PROGRAM_DATA_SHA256:hash};
  const config=await developerLockConfig({env,connection:{getGenesisHash:async()=>'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG'},
    readEvidence:async()=>({sha256:hash,account:{executable:true},programData:{data:Buffer.alloc(50)}})});
  assert.equal(config.ready,true);assert.deepEqual(config.lockPeriodsSeconds,[43200]);
});
