import {Buffer} from 'buffer';
import {PublicKey,SystemProgram,TransactionInstruction} from '@solana/web3.js';
import {TOKEN_2022_PROGRAM_ID,ASSOCIATED_TOKEN_PROGRAM_ID,getAssociatedTokenAddressSync,createAssociatedTokenAccountIdempotentInstruction} from '@solana/spl-token';
import {DEVELOPER_TOKEN_LOCK_SECONDS,normalizeDeveloperLockSeconds} from './developer-lock-period.js';
export {DEVELOPER_TOKEN_LOCK_SECONDS,DEVELOPER_TOKEN_LOCK_PERIODS} from './developer-lock-period.js';

export const DEVELOPER_TOKEN_LOCK_PROGRAM_ID='EPywNBhXu8QEeukKfwKwo7WPBw6KoSbUGyKgcMFPH9pT';
export const DEVELOPER_TOKEN_LOCK_PROGRAMS=Object.freeze([DEVELOPER_TOKEN_LOCK_PROGRAM_ID,
  '9H1r2nTZs6gQaheYTMaBWpH12JX6dCFj2Rvxg7Lno2Sm','61EQ3onuS2jKzjUDhXdkwKNGiG8Djss3an5vPN3vwYYa']);
export function developerLockProgramId(value=DEVELOPER_TOKEN_LOCK_PROGRAM_ID) {
  const id=new PublicKey(value).toBase58();
  if(!DEVELOPER_TOKEN_LOCK_PROGRAMS.includes(id))throw Error('Unsupported developer token escrow program.');
  return id;
}
const seed=Buffer.from('developer-lock-v1');
const accountDiscriminator=Buffer.from('c9e00b0c19713f1d','hex');
export function developerLockAddresses({mint,creator,programId=DEVELOPER_TOKEN_LOCK_PROGRAM_ID}) {
  mint=new PublicKey(mint);creator=new PublicKey(creator);programId=new PublicKey(programId);
  const [lock,bump]=PublicKey.findProgramAddressSync([seed,mint.toBuffer(),creator.toBuffer()],programId);
  return {lock,bump,vault:getAssociatedTokenAddressSync(mint,lock,true,TOKEN_2022_PROGRAM_ID),
    source:getAssociatedTokenAddressSync(mint,creator,false,TOKEN_2022_PROGRAM_ID)};
}
const key=(pubkey,isWritable=false,isSigner=false)=>({pubkey:new PublicKey(pubkey),isSigner,isWritable});
export function developerLockInstruction({mint,creator,amount,quoteId,lockSeconds=DEVELOPER_TOKEN_LOCK_SECONDS,programId=DEVELOPER_TOKEN_LOCK_PROGRAM_ID}) {
  const addresses=developerLockAddresses({mint,creator,programId});amount=BigInt(amount);
  if(amount<=0n||amount>18446744073709551615n)throw Error('A positive exact developer allocation is required.');
  if(quoteId!=null&&!/^launch_service_\d+_[a-f0-9]{16}$/.test(quoteId))throw Error('A valid launch service quote is required.');
  lockSeconds=normalizeDeveloperLockSeconds(lockSeconds);
  if(String(programId)===DEVELOPER_TOKEN_LOCK_PROGRAM_ID&&lockSeconds!==DEVELOPER_TOKEN_LOCK_SECONDS)
    throw Error('The legacy escrow supports only 12h locks.');
  const selectable=lockSeconds!==DEVELOPER_TOKEN_LOCK_SECONDS,nonceOffset=selectable?20:16;
  // Keep the legacy instruction for 12h, including historical receipt markers.
  const data=Buffer.alloc(nonceOffset+(quoteId?8:0));Buffer.from(selectable?'542f9dcb69f0b6c0':'7997ce5b503ff839','hex').copy(data);data.writeBigUInt64LE(amount,8);
  if(selectable)data.writeUInt32LE(lockSeconds,16);
  if(quoteId)Buffer.from(quoteId.slice(-16),'hex').copy(data,nonceOffset);
  return { ...addresses,amount,instruction:new TransactionInstruction({programId:new PublicKey(programId),data,
    keys:[key(creator,true,true),key(mint),key(addresses.source,true),key(addresses.lock,true),key(addresses.vault,true),
      key(TOKEN_2022_PROGRAM_ID),key(ASSOCIATED_TOKEN_PROGRAM_ID),key(SystemProgram.programId)]}) };
}
export function decodeDeveloperLockInstruction(data) {
  data=Buffer.from(data);
  const discriminator=data.subarray(0,8).toString('hex');
  if(discriminator==='7997ce5b503ff839'&&[16,24].includes(data.length))
    return {amount:data.readBigUInt64LE(8),lockSeconds:DEVELOPER_TOKEN_LOCK_SECONDS};
  if(discriminator==='542f9dcb69f0b6c0'&&[20,28].includes(data.length))
    return {amount:data.readBigUInt64LE(8),lockSeconds:normalizeDeveloperLockSeconds(data.readUInt32LE(16))};
  return null;
}
export function developerReleaseInstruction({mint,creator,payer=creator,programId=DEVELOPER_TOKEN_LOCK_PROGRAM_ID}) {
  const addresses=developerLockAddresses({mint,creator,programId});
  return { ...addresses,instruction:new TransactionInstruction({programId:new PublicKey(programId),data:Buffer.from('fdf90fce1c7fc1f1','hex'),
    keys:[key(payer,true,true),key(creator),key(mint),key(addresses.lock,true),key(addresses.vault,true),key(addresses.source,true),
      key(TOKEN_2022_PROGRAM_ID),key(ASSOCIATED_TOKEN_PROGRAM_ID),key(SystemProgram.programId)]}) };
}
// Setup and custody instructions must be submitted in one atomic transaction.
// Idempotent setup also supports ATAs already created by an earlier launch.
export function developerReleaseInstructions({mint,creator,payer=creator,programId=DEVELOPER_TOKEN_LOCK_PROGRAM_ID}) {
  const built=developerReleaseInstruction({mint,creator,payer,programId});
  return [createAssociatedTokenAccountIdempotentInstruction(new PublicKey(payer),built.source,
    new PublicKey(creator),new PublicKey(mint),TOKEN_2022_PROGRAM_ID),built.instruction];
}
export function decodeDeveloperTokenLock(account,{mint,creator,programId=DEVELOPER_TOKEN_LOCK_PROGRAM_ID}) {
  const {lock,bump}=developerLockAddresses({mint,creator,programId}),data=Buffer.from(account?.data||[]);
  if(account?.owner?.toBase58?.()!==String(programId)||data.length!==105||!data.subarray(0,8).equals(accountDiscriminator)
    ||!data.subarray(8,40).equals(new PublicKey(mint).toBuffer())||!data.subarray(40,72).equals(new PublicKey(creator).toBuffer())||data[104]!==bump)
    throw Error('Developer token escrow identity is not verified.');
  const amount=data.readBigUInt64LE(72),lockedAt=Number(data.readBigInt64LE(80)),unlockAt=Number(data.readBigInt64LE(88)),releasedAt=Number(data.readBigInt64LE(96));
  const lockSeconds=normalizeDeveloperLockSeconds(unlockAt-lockedAt);
  if(amount<=0n||!Number.isSafeInteger(lockedAt)||lockedAt<=0||!Number.isSafeInteger(unlockAt)
    ||String(programId)===DEVELOPER_TOKEN_LOCK_PROGRAM_ID&&lockSeconds!==DEVELOPER_TOKEN_LOCK_SECONDS
    ||!Number.isSafeInteger(releasedAt)||releasedAt!==0&&releasedAt<unlockAt)throw Error('Developer token escrow timing or amount is invalid.');
  return {lock:lock.toBase58(),mint:String(mint),creator:String(creator),amount:amount.toString(),lockedAt,unlockAt,releasedAt,lockSeconds};
}
export function developerLockLaunchInstructions({mint,creator,amount,config,quoteId,lockSeconds=DEVELOPER_TOKEN_LOCK_SECONDS}) {
  lockSeconds=normalizeDeveloperLockSeconds(lockSeconds);
  if(BigInt(amount)===0n)return [];
  if(!config?.ready||!DEVELOPER_TOKEN_LOCK_PROGRAMS.includes(config.programId)
    ||!(config.lockPeriodsSeconds||[config.lockSeconds]).includes(lockSeconds))
    throw Error(`The ${lockSeconds/3600}h developer token lock is unavailable on this deployment. No launch was sent.`);
  const built=developerLockInstruction({mint,creator,amount,quoteId,lockSeconds,programId:config.programId});
  return [createAssociatedTokenAccountIdempotentInstruction(new PublicKey(creator),built.vault,
    built.lock,new PublicKey(mint),TOKEN_2022_PROGRAM_ID),built.instruction];
}
