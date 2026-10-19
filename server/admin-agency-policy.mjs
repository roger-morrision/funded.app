import {PublicKey,Transaction} from '@solana/web3.js';
import bs58 from 'bs58';
import nacl from 'tweetnacl';
import {buildAgencyConfigV3Instruction} from '../agency-mint-router-v3.js';
import {readAgencyDeployment} from './agency-deployment.mjs';

// Publishing changes future launches only. The authority must first finalize
// the exact configuration transaction; an admin session cannot replace it.
export async function publishAgencyFeePolicy({store,connection,programId,approvedHash,authority,actor,input,
  readDeployment=readAgencyDeployment}) {
  if(!Number.isSafeInteger(input.expectedRevision)||input.expectedRevision<0
    ||!/^[1-9]\d{0,19}$/.test(String(input.configRevision))
    ||!/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(String(input.signature))
    ||typeof input.reason!=='string'||input.reason.trim().length<10||input.reason.length>500)
    throw new Error('Policy revision, configuration revision, finalized signature and audit reason are required.');
  const deployment=await readDeployment({connection,programId,approvedHash,authority});
  if(!deployment.verified||deployment.revision!==String(input.configRevision))
    throw new Error('The finalized configuration revision changed; review it again.');
  const tx=await connection.getTransaction(input.signature,{commitment:'finalized',maxSupportedTransactionVersion:0});
  if(!tx?.meta||tx.meta.err||!Number.isSafeInteger(tx.slot)||!Number.isSafeInteger(tx.blockTime))
    throw new Error('A successful finalized configuration transaction is required.');
  const revision=BigInt(deployment.revision);
  const built=buildAgencyConfigV3Instruction({programId,authority,protocolUnits:deployment.protocolUnits,
    promotionRecipient:deployment.promotionRecipient,...(revision===1n?{}:{expectedRevision:String(revision-1n)})});
  const message=tx.transaction.message;
  const expected=new Transaction({feePayer:new PublicKey(authority),recentBlockhash:message.recentBlockhash})
    .add(built.instruction).compileMessage();
  if(!Buffer.from(message.serialize()).equals(Buffer.from(expected.serialize())))
    throw new Error('The authority-signed transaction does not match the exact configuration instruction.');
  if(tx.transaction.signatures?.length!==1||tx.transaction.signatures[0]!==input.signature
    ||!nacl.sign.detached.verify(message.serialize(),bs58.decode(input.signature),new PublicKey(authority).toBytes()))
    throw new Error('The configuration authority signature is invalid.');
  const saved=await store.update(state=>{
    const current=state.adminSettings?.protocolFeePolicy;
    if(current?.configurationSignature===input.signature
      &&JSON.stringify(current.split)===JSON.stringify(deployment.protocolSplit))return current;
    if((current?.revision||0)!==input.expectedRevision)return null;
    state.adminSettings||={};state.adminAudit||={};
    const policy={split:deployment.protocolSplit,revision:input.expectedRevision+1,updatedAt:new Date().toISOString(),
      updatedBy:actor,configurationSignature:input.signature,configRevision:deployment.revision,
      programId:String(programId),approvedHash,configSlot:tx.slot};
    state.adminSettings.protocolFeePolicy=policy;
    state.adminAudit[`agency-fee-policy:${policy.revision}`]={...policy,action:'agency-fee-policy-published',wallet:actor,
      signature:input.signature,reason:input.reason.trim(),at:policy.updatedAt};
    return policy;
  });
  if(!saved)throw new Error('The published policy changed. Refresh and review it again.');
  return {...saved,creatorPercent:80,protocolPercent:20,effectiveFor:'future launches only'};
}
