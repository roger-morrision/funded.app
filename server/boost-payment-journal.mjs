import {Transaction, SystemInstruction, SystemProgram, ComputeBudgetProgram} from '@solana/web3.js';
import bs58 from 'bs58';
import {BOOST_MEMO_PROGRAM, boostMemo} from '../boost-offer.js';

const windowKey=(quoteId,blockhash)=>`window:${quoteId}:${blockhash}`;
export async function prepareBoostPayment({store,rpc,quote,now=Date.now()}) {
  if (now >= Date.parse(quote.expiresAt)) throw Error('The quote expired. Request a fresh quote before signing.');
  const latest=await rpc.getLatestBlockhashAndContext('confirmed');
  if (!Number.isSafeInteger(latest?.value?.lastValidBlockHeight) || latest.value.lastValidBlockHeight < 1
    || !Number.isSafeInteger(latest?.context?.slot) || typeof latest.value.blockhash!=='string') throw Error('Payment expiry verification is unavailable.');
  const record={quoteId:quote.id,blockhash:latest.value.blockhash,expiryUpperBound:latest.value.lastValidBlockHeight,
    observedSlot:latest.context.slot,kind:'prepared',cluster:quote.cluster,expiresAt:quote.expiresAt};
  await store.update(state=>{state.boostPayments||={};state.boostPayments[windowKey(quote.id,record.blockhash)] ||= record;});
  return record;
}

// Verify possession of the actual signed payment, not client-supplied expiry hints.
export function decodeBoostPayment(encoded, quote, signature) {
  if (typeof encoded !== 'string' || encoded.length > 1800 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded))
    throw Error('A valid signed boost transaction is required.');
  const tx = Transaction.from(Buffer.from(encoded, 'base64'));
  if (!tx.verifySignatures() || tx.signatures.length !== 1 || !tx.signature
    || bs58.encode(tx.signature) !== signature || tx.feePayer?.toBase58() !== quote.payer)
    throw Error('The signed payment does not match the quoted wallet and signature.');
  const start = tx.instructions.findIndex(ix => !ix.programId.equals(ComputeBudgetProgram.programId));
  const instructions = tx.instructions.slice(start);
  if (start < 0 || instructions.length !== 2 || !instructions[0].programId.equals(SystemProgram.programId))
    throw Error('The signed payment must contain one transfer and one boost memo.');
  const transfer = SystemInstruction.decodeTransfer(instructions[0]);
  if (transfer.fromPubkey.toBase58() !== quote.payer || transfer.toPubkey.toBase58() !== quote.recipient
    || transfer.lamports !== BigInt(quote.lamports) || instructions[1].programId.toBase58() !== BOOST_MEMO_PROGRAM
    || instructions[1].data.toString('utf8') !== boostMemo(quote.id))
    throw Error('The signed transfer or memo does not match the quote.');
  return {blockhash:tx.recentBlockhash, signature, quoteId:quote.id};
}

export async function registerBoostPayment({store, rpc, quote, signature, signedTransaction, now=Date.now()}) {
  const identity = decodeBoostPayment(signedTransaction, quote, signature);
  const existing = (await store.read()).boostPayments?.[signature];
  if (existing) {
    if (existing.quoteId !== quote.id || existing.blockhash !== identity.blockhash) throw Error('Payment identity conflicts with its saved record.');
    return existing;
  }
  // The server saved this exact blockhash and expiry BEFORE wallet signing.
  // A height sent by the client or inferred from another blockhash is not proof.
  const window=(await store.read()).boostPayments?.[windowKey(quote.id,identity.blockhash)];
  if (!window || !Number.isSafeInteger(window.expiryUpperBound) || !Number.isSafeInteger(window.observedSlot))
    throw Error('The signed payment has no verified preparation record.');
  const record = {...identity, expiryUpperBound:window.expiryUpperBound, observedSlot:window.observedSlot,
    registeredAt:new Date(now).toISOString(), broadcastAllowed:now <= Date.parse(quote.expiresAt), status:'pending'};
  return store.update(state => {
    state.boostPayments ||= {};
    const current = state.boostPayments[signature];
    if (current && (current.quoteId !== quote.id || current.blockhash !== identity.blockhash)) throw Error('Payment identity conflicts with its saved record.');
    return state.boostPayments[signature] ||= record;
  });
}

export async function expiredBoostPayment(rpc, payment) {
  if (!payment || !Number.isSafeInteger(payment.expiryUpperBound) || !Number.isSafeInteger(payment.observedSlot)) return null;
  const height = await rpc.getBlockHeight('finalized');
  if (!Number.isSafeInteger(height) || height <= payment.expiryUpperBound + 32) return null;
  const validity = await rpc.isBlockhashValid(payment.blockhash, {commitment:'finalized', minContextSlot:payment.observedSlot});
  if (validity?.value !== false || !Number.isSafeInteger(validity?.context?.slot) || validity.context.slot < payment.observedSlot) return null;
  // Query history AFTER finalized expiry. An earlier negative lookup is insufficient.
  const statuses = await rpc.getSignatureStatuses([payment.signature], {searchTransactionHistory:true});
  const transaction = await rpc.getTransaction(payment.signature, {commitment:'confirmed', maxSupportedTransactionVersion:0});
  if (!Number.isSafeInteger(statuses?.context?.slot) || statuses.context.slot < validity.context.slot
    || statuses.value?.length !== 1 || statuses.value[0] !== null || transaction !== null) return null;
  return {status:'expired', signature:payment.signature, quoteId:payment.quoteId, cluster:payment.cluster||'devnet', commitment:'finalized',
    blockhash:payment.blockhash, finalizedBlockHeight:height, expiryUpperBound:payment.expiryUpperBound,
    slot:statuses.context.slot, transactionAbsent:true};
}
