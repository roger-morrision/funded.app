import {Buffer} from 'buffer';
import {PublicKey,SystemProgram,TransactionInstruction} from '@solana/web3.js';
import {TOKEN_PROGRAM_ID,TOKEN_2022_PROGRAM_ID} from '@solana/spl-token';

const key=value=>new PublicKey(value);
const discriminator=Buffer.from('aac69639f52c60c5','hex');
const u64=value=>{const bytes=Buffer.alloc(8);bytes.writeBigUInt64LE(BigInt(value));return bytes;};
export function richAssetsAddress(programId,revision=null){
  const seeds=revision===null?[Buffer.from('rich-assets-v1')]:[Buffer.from('rich-assets-revision-v1'),u64(revision)];
  return PublicKey.findProgramAddressSync(seeds,key(programId))[0];
}
export function decodeRichAssets(info,{programId,revision=null}={}){
  const data=Buffer.from(info?.data||[]);
  if(!info?.owner?.equals(key(programId))||info.executable||data.length!==177||!data.subarray(0,8).equals(discriminator))
    throw Error('Primary RICH configuration is unavailable or invalid.');
  const mint=key(data.subarray(8,40)),pool=key(data.subarray(40,72)),tokenProgram=key(data.subarray(72,104));
  const version=data.readBigUInt64LE(104),venue=data[112];
  const authority=key(data.subarray(113,145)),pendingAuthority=key(data.subarray(145,177));
  if(authority.equals(SystemProgram.programId)||version===0n||revision!==null&&version!==BigInt(revision)||![0,1].includes(venue)
    ||![TOKEN_PROGRAM_ID,TOKEN_2022_PROGRAM_ID].some(p=>p.equals(tokenProgram)))
    throw Error('Primary RICH configuration revision is invalid.');
  return{mint,pool,tokenProgram,revision:String(version),venue,authority,pendingAuthority,configAddress:richAssetsAddress(programId)};
}
export async function readRichAssets(connection,programId,{revision=null}={}){
  const info=await connection.getAccountInfo(richAssetsAddress(programId,revision),'finalized');
  return decodeRichAssets(info,{programId,revision});
}
// The RICH administrator signs; the upgrade owner bootstraps revision 1.
// nextRevision is current revision + 1 (or 1 for first initialization).
export function buildConfigureRichAssets({programId,owner,mint,market,venue,nextRevision}){
  const program=key(programId),loader=key('BPFLoaderUpgradeab1e11111111111111111111111');
  if(![0,1].includes(venue)||BigInt(nextRevision)<1n)throw Error('Invalid RICH market configuration.');
  const addresses=[key(owner),program,PublicKey.findProgramAddressSync([program.toBuffer()],loader)[0],
    richAssetsAddress(program),richAssetsAddress(program,nextRevision),key(mint),key(market),SystemProgram.programId];
  return new TransactionInstruction({programId:program,
    keys:addresses.map((pubkey,i)=>({pubkey,isSigner:i===0,isWritable:[0,3,4].includes(i)})),
    data:Buffer.concat([Buffer.from('340a47441468b59c','hex'),u64(nextRevision),Buffer.from([venue])])});
}

export function buildProposeRichAuthority({programId,authority,successor}){
  if(key(successor).equals(SystemProgram.programId))throw Error('RICH administrator cannot be zero.');
  return new TransactionInstruction({programId:key(programId),
    keys:[{pubkey:key(authority),isSigner:true,isWritable:false},
      {pubkey:richAssetsAddress(programId),isSigner:false,isWritable:true}],
    data:Buffer.concat([Buffer.from('82a739d528b3b9ff','hex'),key(successor).toBuffer()])});
}

export function buildAcceptRichAuthority({programId,authority}){
  return new TransactionInstruction({programId:key(programId),
    keys:[{pubkey:key(authority),isSigner:true,isWritable:false},
      {pubkey:richAssetsAddress(programId),isSigner:false,isWritable:true}],
    data:Buffer.concat([Buffer.from('c7957ef3409bb62a','hex')])});
}
