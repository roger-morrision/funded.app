import {Buffer} from 'buffer';
import {PublicKey,SystemProgram,TransactionInstruction} from '@solana/web3.js';
import {deriveFeeRouter} from './fee-router.js';

const key=value=>new PublicKey(value);
export const deriveMintAutomationV3=(programId,mint)=>PublicKey.findProgramAddressSync(
  [Buffer.from('mint-automation-v3'),key(mint).toBuffer()],key(programId))[0];

export function automaticPayoutInstruction(instruction,{programId,mint,auto}) {
  if(!auto)return instruction;
  instruction.keys[1]={...instruction.keys[1],isSigner:false};
  instruction.keys.push({pubkey:deriveMintAutomationV3(programId,mint),isSigner:false,isWritable:false});
  return instruction;
}

export function buildInitializeMintAutomationV3({programId,mint,authority,creator,policy,recipients}) {
  if(!Array.isArray(recipients)||recipients.length!==4)throw new Error('Four immutable protocol recipients are required.');
  const addresses=recipients.map(value=>key(value||PublicKey.default));
  if(addresses[0].equals(PublicKey.default))throw new Error('The operations recipient is required.');
  const automation=deriveMintAutomationV3(programId,mint);
  return {automation,instruction:new TransactionInstruction({programId:key(programId),
    data:Buffer.concat([Buffer.from('eb5ffb58dc9a8635','hex'),...addresses.map(value=>value.toBuffer())]),
    keys:[{pubkey:key(authority),isSigner:true,isWritable:true},
      {pubkey:key(creator),isSigner:false,isWritable:false},{pubkey:key(mint),isSigner:false,isWritable:false},
      {pubkey:deriveFeeRouter(programId).address,isSigner:false,isWritable:false},
      {pubkey:key(policy),isSigner:false,isWritable:false},{pubkey:automation,isSigner:false,isWritable:true},
      {pubkey:SystemProgram.programId,isSigner:false,isWritable:false}]})};
}

export function verifyMintAutomationV3(info,{programId,mint,creator,policy,recipients}) {
  const data=Buffer.from(info?.data||[]);
  if(!info?.owner?.equals(key(programId))||data.length!==233
    ||data.subarray(0,8).toString('hex')!=='668959b59cb1e7ba')return false;
  const expected=[mint,creator,policy,...recipients.map(value=>value||PublicKey.default)];
  if(expected.some((value,index)=>!data.subarray(8+index*32,40+index*32).equals(key(value).toBuffer())))return false;
  const [,bump]=PublicKey.findProgramAddressSync([Buffer.from('mint-automation-v3'),key(mint).toBuffer()],key(programId));
  return data[232]===bump;
}
