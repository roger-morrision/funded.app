import {createHash} from 'node:crypto';
import {PublicKey,SystemProgram,Transaction} from '@solana/web3.js';
import bs58 from 'bs58';
export const withdrawalSessionHash=value=>createHash('sha256').update(String(value)).digest('hex');
export function adminWithdrawalTransaction(plan){
  return new Transaction({feePayer:new PublicKey(plan.destination),recentBlockhash:plan.blockhash})
    .add(SystemProgram.transfer({fromPubkey:new PublicKey(plan.source),toPubkey:new PublicKey(plan.destination),lamports:plan.amountLamports}));
}
export function verifyAdminWithdrawalSignature(plan,wire){
  if(typeof wire!=='string'||wire.length>3000)throw Error('Invalid signed withdrawal.');
  const transaction=Transaction.from(Buffer.from(wire,'base64'));
  if(plan.feePayer!==plan.destination||!transaction.serializeMessage().equals(adminWithdrawalTransaction(plan).serializeMessage())
    ||transaction.signatures.length!==2||!transaction.verifySignatures()
    ||bs58.encode(transaction.signatures.find(row=>row.publicKey.toBase58()===plan.source)?.signature||[])!==plan.sourceSignature)
    throw Error('The admin signature, source signature or reviewed transaction changed.');
  return{transaction,signature:bs58.encode(transaction.signature)};
}
