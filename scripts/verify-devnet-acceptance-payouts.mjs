// Run in the Devnet app container, with explicit mint and collection signature.
// Reads public chain receipts and a read-only database snapshot; never signs.
import assert from 'node:assert/strict';
import {isDeepStrictEqual} from 'node:util';
import {readFileSync} from 'node:fs';
import pg from 'pg';
import {Connection,PublicKey} from '@solana/web3.js';
import {DEVNET_GENESIS_HASH,readProgramDataEvidence} from '../server/automatic-reward-chain.mjs';
import {loadFinalizedV3Settlement} from '../server/v3-settlement-proof.mjs';
import {loadFinalizedV3RewardFunding} from '../server/v3-reward-funding-proof.mjs';
import {v3AllocationPlan} from '../server/v3-allocation-plan.mjs';
import {v3DisbursementId} from '../server/v3-disbursement-id.mjs';
import {v3ReferralEntitlement} from '../server/v3-referral-entitlement.mjs';
import {creatorFeeLock} from '../server/launch-protections.mjs';

const [mintInput,collectionSignature,...extra]=process.argv.slice(2);
const mint=new PublicKey(mintInput).toBase58();
assert(!extra.length&&/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(collectionSignature));
assert.equal(process.env.SOLANA_CLUSTER,'devnet');
const programId=new PublicKey(process.env.FUNDED_V3_FEE_ROUTER_PROGRAM_ID);
const connection=new Connection(process.env.SOLANA_RPC_URL,{commitment:'finalized',disableRetryOnRateLimit:true});
assert.equal(await connection.getGenesisHash(),DEVNET_GENESIS_HASH);
const program=await readProgramDataEvidence(connection,programId);
assert(program.account?.executable&&program.sha256===process.env.FUNDED_V3_PROGRAM_DATA_SHA256);
const kinds=[['creator-wallet','v3CreatorWalletPayout'],['creator-reward','v3CreatorRewardFunding'],
 ['community','v3CommunityFunding'],['operations','v3OperationsPayout'],['referral','v3ReferralPayouts']];
const db=new pg.Client({connectionString:readFileSync(process.env.DATABASE_URL_FILE,'utf8').trim()});
await db.connect();let rows;
try{
 await db.query('BEGIN READ ONLY');
 rows=(await db.query('SELECT bucket,entity_key,payload FROM state_entities WHERE bucket = ANY($1::text[]) AND payload->>\'mint\' = $2',
  [['launches','collections','v3Settlements',...kinds.map(([,bucket])=>bucket)],mint])).rows;
 await db.query('COMMIT');
}catch(error){await db.query('ROLLBACK');throw error;}finally{await db.end();}
const pick=(bucket,key)=>rows.find(row=>row.bucket===bucket&&row.entity_key===key)?.payload;
const launch=pick('launches',mint),collection=pick('collections',collectionSignature),settled=pick('v3Settlements',collectionSignature);
assert(launch?.onchainVerified&&launch.cluster==='devnet'&&collection?.signature===collectionSignature&&settled?.status==='finalized');
const authority=launch.pumpFeeRoute.initialAuthority,split=launch.pumpFeeRoute.protocolSplit;
const proof=await loadFinalizedV3Settlement({connection,signature:settled.settlementSignature,cluster:'devnet',programId,mint,authority,
 creator:launch.creatorWallet,claimId:Buffer.from(collection.claimId,'hex'),expectedLamports:collection.collectedLamports,split,
 includePosition:settled.allocationPlan?.allocationVersion===2});
assert(proof?.signature===settled.settlementSignature);
const plan=v3AllocationPlan({launch,cluster:'devnet',settlement:{...proof,
 position:settled.allocationPlan?.allocationVersion===2?proof.position:undefined,programId:programId.toBase58(),
 collectionSignature,settlementSignature:settled.settlementSignature}});
assert(isDeepStrictEqual(plan,settled.allocationPlan));
const payouts=[];
for(const [kind,bucket] of kinds)for(const level of kind==='referral'?[1,2,3]:[null]){
 const saved=pick(bucket,level?`${collectionSignature}:${level}`:collectionSignature);
 assert(saved?.status==='finalized'&&saved.mint===mint);
 const category=kind==='community'?5:kind==='operations'?1:kind==='referral'?level+1:0;
 const amount=kind==='creator-wallet'?BigInt(plan.creatorDirected.walletLamports):kind==='creator-reward'
  ?BigInt(plan.creatorDirected.holderLamports)+BigInt(plan.creatorDirected.xLamports):kind==='community'
  ?BigInt(plan.protocol.communityLamports):kind==='operations'?BigInt(plan.protocol.operationsLamports):BigInt(proof.categoryLamports[category]);
 assert.equal(saved.amount,String(amount));
 if(kind==='creator-wallet')assert.equal(saved.recipient,launch.creatorWallet);
 if(kind==='creator-reward'||kind==='community')assert.equal(saved.recipient,launch.communityReserve.vault);
 if(kind==='operations')assert.equal(saved.recipient,new PublicKey(process.env.FUNDED_V3_OPERATIONS_RECIPIENT).toBase58());
 if(kind==='referral'){
  const entitlement=v3ReferralEntitlement({settlement:settled,plan,level});
  assert(entitlement&&entitlement.recipient===saved.recipient&&BigInt(entitlement.amount)===amount);
 }
 const verified=await loadFinalizedV3RewardFunding({connection,signature:saved.signature,programId,mint,authority,
  creator:launch.creatorWallet,initialAuthority:authority,withdrawalId:v3DisbursementId(level?`referral-${level}`:kind,settled.settlementSignature),
  category,amount,recipient:saved.recipient,split,protectedPolicy:true,beneficiary:kind==='creator-wallet'?0:kind==='creator-reward'?1:category+2,
  holderAmount:kind==='creator-reward'?BigInt(plan.creatorDirected.holderLamports):0n,cluster:'devnet'});
 assert(verified?.balanceDeltaVerified&&verified.signature===saved.signature,`${kind} finalized payout proof unavailable`);
 payouts.push({kind,...(level?{level}:{}),...verified});
}
console.log(JSON.stringify({schemaVersion:1,scope:'read-only finalized Devnet payout re-verification',checkedAt:new Date().toISOString(),
 mint,collectionSignature,settlementSignature:settled.settlementSignature,programId:programId.toBase58(),programDataSha256:program.sha256,
 creatorFeeLock:creatorFeeLock(launch),payouts,transactionsSigned:0,transactionsSubmitted:0},null,2));
