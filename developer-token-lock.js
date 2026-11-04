import {Buffer} from 'buffer';
import {PublicKey,SystemProgram,TransactionInstruction} from '@solana/web3.js';
import {TOKEN_2022_PROGRAM_ID,ASSOCIATED_TOKEN_PROGRAM_ID,getAssociatedTokenAddressSync} from '@solana/spl-token';

export const DEVELOPER_TOKEN_LOCK_PROGRAM_ID='EPywNBhXu8QEeukKfwKwo7WPBw6KoSbUGyKgcMFPH9pT';
export const DEVELOPER_TOKEN_LOCK_SECONDS=43_200;
const seed=Buffer.from('developer-lock-v1');
const accountDiscriminator=Buffer.from('c9e00b0c19713f1d','hex');
export function developerLockAddresses({mint,creator,programId=DEVELOPER_TOKEN_LOCK_PROGRAM_ID}) {
  mint=new PublicKey(mint);creator=new PublicKey(creator);programId=new PublicKey(programId);
  const [lock,bump]=PublicKey.findProgramAddressSync([seed,mint.toBuffer(),creator.toBuffer()],programId);
  return {lock,bump,vault:getAssociatedTokenAddressSync(mint,lock,true,TOKEN_2022_PROGRAM_ID),
    source:getAssociatedTokenAddressSync(mint,creator,false,TOKEN_2022_PROGRAM_ID)};
}
const key=(pubkey,isWritable=false,isSigner=false)=>({pubkey:new PublicKey(pubkey),isSigner,isWritable});
export function developerLockInstruction({mint,creator,amount,quoteId,programId=DEVELOPER_TOKEN_LOCK_PROGRAM_ID}) {
  const addresses=developerLockAddresses({mint,creator,programId});amount=BigInt(amount);
  if(amount<=0n||amount>18446744073709551615n)throw Error('A positive exact developer allocation is required.');
  if(quoteId!=null&&!/^launch_service_\d+_[a-f0-9]{16}$/.test(quoteId))throw Error('A valid launch service quote is required.');
  // Anchor reads the fixed amount; the optional trailing nonce is a receipt
  // marker verified by the API, replacing a separate Memo instruction.
  const data=Buffer.alloc(quoteId?24:16);Buffer.from('7997ce5b503ff839','hex').copy(data);data.writeBigUInt64LE(amount,8);
  if(quoteId)Buffer.from(quoteId.slice(-16),'hex').copy(data,16);
  return { ...addresses,amount,instruction:new TransactionInstruction({programId:new PublicKey(programId),data,
    keys:[key(creator,true,true),key(mint),key(addresses.source,true),key(addresses.lock,true),key(addresses.vault,true),
      key(TOKEN_2022_PROGRAM_ID),key(ASSOCIATED_TOKEN_PROGRAM_ID),key(SystemProgram.programId)]}) };
}
export function developerReleaseInstruction({mint,creator,payer=creator,programId=DEVELOPER_TOKEN_LOCK_PROGRAM_ID}) {
  const addresses=developerLockAddresses({mint,creator,programId});
  return { ...addresses,instruction:new TransactionInstruction({programId:new PublicKey(programId),data:Buffer.from('fdf90fce1c7fc1f1','hex'),
    keys:[key(payer,true,true),key(creator),key(mint),key(addresses.lock,true),key(addresses.vault,true),key(addresses.source,true),
      key(TOKEN_2022_PROGRAM_ID),key(ASSOCIATED_TOKEN_PROGRAM_ID),key(SystemProgram.programId)]}) };
}
export function decodeDeveloperTokenLock(account,{mint,creator,programId=DEVELOPER_TOKEN_LOCK_PROGRAM_ID}) {
  const {lock,bump}=developerLockAddresses({mint,creator,programId}),data=Buffer.from(account?.data||[]);
  if(account?.owner?.toBase58?.()!==String(programId)||data.length!==105||!data.subarray(0,8).equals(accountDiscriminator)
    ||!data.subarray(8,40).equals(new PublicKey(mint).toBuffer())||!data.subarray(40,72).equals(new PublicKey(creator).toBuffer())||data[104]!==bump)
    throw Error('Developer token escrow identity is not verified.');
  const amount=data.readBigUInt64LE(72),lockedAt=Number(data.readBigInt64LE(80)),unlockAt=Number(data.readBigInt64LE(88)),releasedAt=Number(data.readBigInt64LE(96));
  if(amount<=0n||!Number.isSafeInteger(lockedAt)||lockedAt<=0||unlockAt!==lockedAt+DEVELOPER_TOKEN_LOCK_SECONDS
    ||!Number.isSafeInteger(releasedAt)||releasedAt!==0&&releasedAt<unlockAt)throw Error('Developer token escrow timing or amount is invalid.');
  return {lock:lock.toBase58(),mint:String(mint),creator:String(creator),amount:amount.toString(),lockedAt,unlockAt,releasedAt};
}
export function developerLockLaunchInstructions({mint,creator,amount,config,quoteId}) {
  if(BigInt(amount)===0n)return [];
  if(!config?.ready||config.programId!==DEVELOPER_TOKEN_LOCK_PROGRAM_ID||config.lockSeconds!==DEVELOPER_TOKEN_LOCK_SECONDS)
    throw Error('The 12-hour developer token escrow is unavailable. No launch was sent.');
  return [developerLockInstruction({mint,creator,amount,quoteId}).instruction];
}
