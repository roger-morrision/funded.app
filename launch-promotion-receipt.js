import { Buffer } from 'buffer';
import { PublicKey, Transaction, TransactionInstruction } from '@solana/web3.js';
import bs58 from 'bs58';

export const PROMOTION_MEMO_PROGRAM = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
export function promotionBurnMemo(mint, quoteId) {
  if (!quoteId || !/^launch_tier_\d+_[0-9a-f]{16}$/.test(quoteId)) throw Error('A saved promotion quote is required before burning.');
  return `funded:launch-promotion:v1:${new PublicKey(mint).toBase58()}:${quoteId}`;
}
export function promotionBurnStep({ payer, mint, burnInstruction, quoteId, blockhash }) {
  const transaction = new Transaction({ feePayer:payer, recentBlockhash:blockhash }).add(burnInstruction,
    new TransactionInstruction({ programId:PROMOTION_MEMO_PROGRAM,
      keys:[{pubkey:mint.publicKey,isSigner:true,isWritable:false}],
      data:Buffer.from(promotionBurnMemo(mint.publicKey, quoteId)) }));
  return {kind:'promotion-burn',transaction};
}
export function verifyPromotionBurnBinding({ transaction, payer, mint, quoteId, launchSlot }) {
  if (!transaction?.meta || transaction.meta.err || !Number.isSafeInteger(transaction.slot)
    || (launchSlot != null && transaction.slot >= launchSlot)) throw Error('Promotion burn must finalize before coin creation.');
  const message=transaction.transaction.message;
  if(message.header.numRequiredSignatures!==2)throw Error('Promotion burn must be signed only by its payer and launch mint.');
  const keys=[...(message.accountKeys||message.staticAccountKeys||[]),...(transaction.meta.loadedAddresses?.writable||[]),...(transaction.meta.loadedAddresses?.readonly||[])].map(k=>new PublicKey(k.pubkey||k));
  if(keys[0]?.toBase58()!==String(payer))throw Error('Promotion burn payer does not match the launch wallet.');
  const mintIndex=keys.findIndex(k=>k.toBase58()===String(mint));
  if(mintIndex<0||mintIndex>=message.header.numRequiredSignatures)throw Error('Promotion burn is not signed for this launch mint.');
  const expected=promotionBurnMemo(mint,quoteId);
  const bound=(message.instructions||message.compiledInstructions||[]).some(ix=>keys[ix.programIdIndex]?.equals(PROMOTION_MEMO_PROGRAM)
    &&Buffer.from(typeof ix.data==='string'?bs58.decode(ix.data):ix.data).toString('utf8')===expected
    &&Array.from(ix.accounts||ix.accountKeyIndexes||[]).includes(mintIndex));
  if(!bound)throw Error('Promotion burn does not match this launch mint and quote.');
}
