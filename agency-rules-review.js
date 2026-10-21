import {Buffer} from 'buffer';
import {PublicKey,Transaction} from '@solana/web3.js';
import {buildAgencyRulesV3Instruction} from './agency-mint-router-v3.js';
import {protocolGrossUnits} from './mint-router-v3.js';

// Rebuild from the reviewed form, not fields supplied by the preparation API.
export function verifyPreparedAgencyRules(prepared,{programId,authority,split,rules,promotionRecipient,expectedRevision}){
  const tx=Transaction.from(Buffer.from(prepared.transaction,'base64'));
  const expected=buildAgencyRulesV3Instruction({programId,authority,protocolUnits:protocolGrossUnits(split),
    rules,promotionRecipient,expectedRevision}).instruction,actual=tx.instructions[0];
  if(prepared.authority!==String(authority)||prepared.configRevision!==String(expectedRevision)
    ||!tx.feePayer?.equals(new PublicKey(authority))||tx.recentBlockhash!==prepared.blockhash
    ||!Number.isSafeInteger(prepared.lastValidBlockHeight)||prepared.lastValidBlockHeight<1
    ||tx.signatures.length!==1||tx.signatures[0].signature!==null||tx.instructions.length!==1
    ||!actual?.programId.equals(expected.programId)||!Buffer.from(actual.data).equals(expected.data)
    ||actual.keys.length!==expected.keys.length||actual.keys.some((row,i)=>!row.pubkey.equals(expected.keys[i].pubkey)
      ||row.isSigner!==expected.keys[i].isSigner||row.isWritable!==expected.keys[i].isWritable))
    throw new Error('Prepared transaction differs from the reviewed future-launch settings.');
  return tx;
}
