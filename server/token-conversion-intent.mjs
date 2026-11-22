import assert from 'node:assert/strict';
import {PublicKey,TransactionInstruction} from '@solana/web3.js';
import {buildReviewedUsdcSellConversion} from './token-conversion-sell.mjs';

// Public immutable evidence only: no signer secrets or provider URLs. Persisted
// snapshots must originate from the actual independent review, never HTTP hints.
export function encodeTokenSellIntent(expected){
  const swap=expected.pumpSellInstruction,pool=expected.poolAccount;
  return {version:1,programId:String(expected.programId),mint:String(expected.mint),authority:String(expected.authority),priceSigner:String(expected.priceSigner),
    conversionId:Buffer.from(expected.conversionId).toString('hex'),category:Number(expected.category),amountIn:expected.amountIn,minSolOut:expected.minSolOut,messageHash:expected.messageHash,
    swap:{programId:String(swap.programId),dataHex:Buffer.from(swap.data).toString('hex'),keys:swap.keys.map(k=>({address:String(k.pubkey),signer:k.isSigner,writable:k.isWritable}))},
    pool:{owner:String(pool.owner),executable:pool.executable,dataBase64:Buffer.from(pool.data).toString('base64')},
    protocolRecipients:expected.protocolRecipients.map(String),buybackRecipients:expected.buybackRecipients.map(String)};
}

export function decodeTokenSellIntent(row){
  assert(row?.version===1&&/^[a-f0-9]{64}$/.test(row.conversionId)&&/^[a-f0-9]{64}$/.test(row.messageHash)
    &&typeof row.pool?.dataBase64==='string'&&row.pool.dataBase64.length<=8192&&row.swap?.keys?.length===23,'Invalid durable conversion intent.');
  const poolBytes=Buffer.from(row.pool.dataBase64,'base64');assert(poolBytes.toString('base64')===row.pool.dataBase64,'Noncanonical durable pool encoding.');
  assert(/^[a-f0-9]{48}$/.test(row.swap.dataHex),'Invalid durable sell encoding.');
  const expected={programId:new PublicKey(row.programId),mint:new PublicKey(row.mint),authority:new PublicKey(row.authority),priceSigner:new PublicKey(row.priceSigner),
    conversionId:Buffer.from(row.conversionId,'hex'),category:row.category,amountIn:row.amountIn,minSolOut:row.minSolOut,messageHash:row.messageHash,
    poolAccount:{owner:new PublicKey(row.pool.owner),executable:row.pool.executable,data:poolBytes},
    pumpSellInstruction:new TransactionInstruction({programId:new PublicKey(row.swap.programId),data:Buffer.from(row.swap.dataHex,'hex'),
      keys:row.swap.keys.map(k=>({pubkey:new PublicKey(k.address),isSigner:k.signer,isWritable:k.writable}))}),
    protocolRecipients:row.protocolRecipients,buybackRecipients:row.buybackRecipients};
  buildReviewedUsdcSellConversion(expected);return expected;
}
