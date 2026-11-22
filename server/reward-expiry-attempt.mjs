import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import bs58 from 'bs58';
import {PublicKey,Transaction} from '@solana/web3.js';
import {SOLANA_GENESIS} from '../solana-network.js';
import {finalizedProgramContext} from './finalized-program-context.mjs';
import {readRewardExpiryContext,verifyRewardExpiryTransition} from './reward-expiry-context.mjs';
import {parseCycleFields,parseReserve} from './reward-account-codec.mjs';

export const expiryDigest=bytes=>createHash('sha256').update(bytes).digest('hex');
const sorted=value=>Array.isArray(value)?value.map(sorted):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,sorted(value[k])])):value;
export const expiryObjectHash=value=>expiryDigest(JSON.stringify(sorted(value)));
export const expiryPlanHash=plan=>expiryDigest(JSON.stringify(sorted({cluster:plan.cluster,genesisHash:plan.genesisHash,mint:plan.mint,asset:plan.asset,cycle:plan.cycle,
  cutoffAt:plan.cutoffAt,payoutAt:plan.payoutAt,manifest:plan.manifest})));
const goodSlot=(n,floor)=>Number.isSafeInteger(n)&&n>=floor;

export function expirySnapshot(context){
  const out=structuredClone(Object.fromEntries(['cycle','vault','reserve','originalAuthority','currentAuthority','slot','record','liability','unpaidAmount'].map(k=>[k,context[k]])));
  for(const name of ['cycleInfo','vaultInfo','reserveInfo']){
    const a=context[name];out[name]={owner:String(a.owner),executable:a.executable,lamports:a.lamports,dataBase64:Buffer.from(a.data).toString('base64')};
  }
  return out;
}
function restore(snapshot){
  const out=structuredClone(snapshot);
  for(const name of ['cycleInfo','vaultInfo','reserveInfo']){
    const a=out[name];assert(typeof a?.dataBase64==='string'&&a.dataBase64.length<=12000,'Invalid saved expiry account.');
    a.data=Buffer.from(a.dataBase64,'base64');assert(a.data.toString('base64')===a.dataBase64,'Noncanonical expiry account bytes.');a.owner=new PublicKey(a.owner);delete a.dataBase64;
  }
  return out;
}

// Authenticate durable signed bytes; reconstructing the canonical single expiry
// instruction also rejects extra transfers, compute changes and altered flags.
export function requireExpiryAttempt(attempt,{plan,programId,currentAuthority,cluster,expectedProgramDataSha256}){
  assert(attempt?.version===1&&attempt.cluster===cluster&&attempt.genesisHash===SOLANA_GENESIS[cluster]
    &&attempt.programId===String(programId)&&attempt.programDataSha256===expectedProgramDataSha256
    &&attempt.planHash===expiryPlanHash(plan)&&attempt.snapshotHash===expiryDigest(JSON.stringify(sorted(attempt.before)))
    &&['prepared','verified'].includes(attempt.state),'Saved expiry attempt context differs.');
  const before=restore(attempt.before);
  for(const field of ['cycleInfo','vaultInfo','reserveInfo'])assert(before[field].owner.equals(new PublicKey(programId))
    &&before[field].executable===false&&Number.isSafeInteger(before[field].lamports)&&before[field].lamports>=0,'Saved expiry account identity differs.');
  const cycle=parseCycleFields(before.cycleInfo),record={...before.record};if(cycle)delete cycle.bitmap;delete record.bitmap;
  assert(cycle&&expiryObjectHash(cycle)===expiryObjectHash(record)&&before.vaultInfo.data.length===73
    &&expiryObjectHash(parseReserve(before.reserveInfo))===expiryObjectHash(before.liability),'Saved expiry accounting bytes differ.');
  assert(before.cycle===plan.cycle&&before.currentAuthority===String(currentAuthority)&&goodSlot(before.slot,1)
    &&before.record?.reserved===true&&BigInt(before.unpaidAmount)>=0n&&BigInt(before.liability.outstanding)>=BigInt(before.unpaidAmount)
    &&before.unpaidAmount===String(BigInt(before.record.totalAmount)-BigInt(before.record.distributedAmount)),'Saved expiry state differs.');
  assert(typeof attempt.transactionBase64==='string'&&attempt.transactionBase64.length<=1644,'Bounded saved expiry transaction required.');
  const raw=Buffer.from(attempt.transactionBase64,'base64');assert(raw.length<=1232&&raw.toString('base64')===attempt.transactionBase64,'Noncanonical saved expiry wire.');
  const tx=Transaction.from(raw),message=tx.serializeMessage();
  assert(tx.verifySignatures()&&tx.signatures.length===1&&String(tx.signatures[0].publicKey)===String(currentAuthority)
    &&tx.feePayer.equals(new PublicKey(currentAuthority))&&bs58.encode(tx.signature)===attempt.signature
    &&expiryDigest(message)===attempt.messageHash&&tx.recentBlockhash===attempt.blockhash,'Saved expiry signature or message differs.');
  assert(tx.instructions.length===1&&tx.instructions[0].programId.equals(new PublicKey(programId)),'Unexpected saved expiry instructions.');
  const ix=tx.instructions[0],name=before.record.receiptMode==='bitmap'?'expire_bitmap_cycle':'expire_reward_cycle';
  const wanted=createHash('sha256').update('global:'+name).digest().subarray(0,8);
  assert(ix.data.equals(wanted)&&ix.keys.length===5&&ix.keys.map(k=>String(k.pubkey)).join(',')===
    [String(currentAuthority),before.vault,before.reserve,before.cycle,String(PublicKey.findProgramAddressSync([Buffer.from('funded-fee-router-v1')],new PublicKey(programId))[0])].join(',')
    &&ix.keys.every((k,i)=>k.isSigner===(i===0)&&k.isWritable===[true,false,true,true,false][i]),'Saved expiry account geometry differs.');
  assert(Number.isSafeInteger(attempt.lastValidBlockHeight)&&attempt.lastValidBlockHeight>0,'Saved expiry validity is missing.');
  return {before,transaction:tx,message};
}

async function programAtTransaction({connection,cluster,programId,expectedProgramDataSha256,release,transactionSlot}){
  if(cluster==='mainnet-beta')return finalizedProgramContext({connection,release,transactionSlot});
  const program=new PublicKey(programId),loader=new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111');
  const address=PublicKey.findProgramAddressSync([program.toBuffer()],loader)[0];
  const executable=await connection.getAccountInfoAndContext(program,{commitment:'finalized',minContextSlot:transactionSlot});
  assert(goodSlot(executable.context?.slot,transactionSlot)&&executable.value?.executable&&executable.value.owner.equals(loader)
    &&executable.value.data.length===36&&executable.value.data.readUInt32LE(0)===2&&executable.value.data.subarray(4).equals(address.toBuffer()),'Expiry executable context differs.');
  const pd=await connection.getAccountInfoAndContext(address,{commitment:'finalized',minContextSlot:executable.context.slot});
  assert(goodSlot(pd.context?.slot,executable.context.slot)&&pd.value?.owner.equals(loader)&&pd.value.executable===false
    &&pd.value.data.length>=45&&pd.value.data.readUInt32LE(0)===3&&pd.value.data.readBigUInt64LE(4)<BigInt(transactionSlot)
    &&expiryDigest(pd.value.data)===expectedProgramDataSha256,'Expiry ProgramData context differs.');
  return {programDataContextSlot:pd.context.slot};
}

// A finalized status or inactive cycle alone is insufficient. This attributes
// the exact successful transaction, frozen message and resulting unpaid release.
export async function finalizedExpiryAttempt(options){
  try{
    const {connection,attempt,plan,programId,currentAuthority,cluster,release}=options;
    const saved=requireExpiryAttempt(attempt,options);
    if(await connection.getGenesisHash()!==SOLANA_GENESIS[cluster])return null;
    const [statuses,tx]=await Promise.all([connection.getSignatureStatuses([attempt.signature],{searchTransactionHistory:true}),
      connection.getTransaction(attempt.signature,{commitment:'finalized',maxSupportedTransactionVersion:0})]);
    const status=statuses.value?.[0];
    if(!tx||!goodSlot(tx.slot,saved.before.slot)||status?.confirmationStatus!=='finalized'||status.err!==null||status.slot!==tx.slot
      ||!goodSlot(statuses.context?.slot,tx.slot)||tx.meta?.err!==null||tx.transaction.signatures?.length!==1
      ||tx.transaction.signatures[0]!==attempt.signature||!Buffer.from(tx.transaction.message.serialize()).equals(saved.message))return null;
    const keys=tx.transaction.message.accountKeys||tx.transaction.message.staticAccountKeys;
    const pre=tx.meta.preBalances,post=tx.meta.postBalances,fee=tx.meta.fee;
    if(!Array.isArray(pre)||pre.length!==keys.length||post?.length!==pre.length||!Number.isSafeInteger(fee)||fee<=0
      ||!pre.every(n=>Number.isSafeInteger(n)&&n>=0)||!post.every(n=>Number.isSafeInteger(n)&&n>=0)
      ||!pre.every((n,i)=>post[i]===n-(i===0?fee:0))||tx.meta.innerInstructions?.some(group=>group.instructions.length))return null;
    const context=await programAtTransaction({...options,transactionSlot:tx.slot});
    const after=await readRewardExpiryContext({connection,programId,currentAuthority,plan,cluster,release,readOnlyRecovery:true});
    if(after.slot<context.programDataContextSlot)return null;
    const delta=verifyRewardExpiryTransition(saved.before,after);
    return {...delta,signature:attempt.signature,messageHash:attempt.messageHash,transactionSlot:tx.slot,
      accountContextSlot:after.slot,programDataContextSlot:context.programDataContextSlot,feeLamports:String(fee),
      programId:String(programId),genesisHash:SOLANA_GENESIS[cluster],programDataSha256:options.expectedProgramDataSha256,expiryTransactionVerified:true};
  }catch{return null;}
}
