import { PublicKey, SystemProgram, TransactionInstruction } from '@solana/web3.js';
import { Buffer } from 'buffer';
const MEMO = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
// Full mint identity comes from the independently verified Pump create event
// in this same transaction. The short tag and random quote nonce identify its
// service payment without exhausting the packet budget for longer coin names.
export const launchServiceMemo = (mint,quoteId) => `fl:${mint.slice(0,8)}:${quoteId.slice(-16)}`;
export function launchServiceFeeInstructions({ payer, mint, quote }) {
  if (!quote || typeof quote.amountLamports !== 'string' || !/^(0|[1-9]\d{0,9})$/.test(quote.amountLamports)
    || BigInt(quote.amountLamports) > 5_000_000_000n || !/^launch_service_\d+_[a-f0-9]{16}$/.test(quote.id)
    || quote.payer !== new PublicKey(payer).toBase58() || !/^[a-f0-9]{64}$/.test(quote.policyHash || '')
    || !Number.isFinite(Date.parse(quote.expiresAt)) || Date.parse(quote.expiresAt) <= Date.now()) throw new Error('A current launch service fee quote is required.');
  const recipient = new PublicKey(quote.recipient);
  if (recipient.equals(new PublicKey(payer))) throw new Error('The launch fee treasury cannot be the paying wallet.');
  return [ ...(BigInt(quote.amountLamports) ? [SystemProgram.transfer({ fromPubkey:new PublicKey(payer),
    toPubkey:recipient, lamports:BigInt(quote.amountLamports) })] : []),
    new TransactionInstruction({ programId:MEMO, keys:[], data:Buffer.from(launchServiceMemo(new PublicKey(mint).toBase58(),quote.id)) }) ];
}
