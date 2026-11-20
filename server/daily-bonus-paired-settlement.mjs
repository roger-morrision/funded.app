import bs58 from 'bs58';
import { PublicKey } from '@solana/web3.js';
import { buildTokenSettlementInstruction, decodeTokenClaimV3,
  deriveTokenClaimV3 } from '../mint-router-v3-token.js';

const address = value => typeof value === 'string' ? value : value?.pubkey?.toBase58?.()
  || value?.pubkey || value?.toBase58?.();
const quantity = value => /^(0|[1-9]\d*)$/.test(String(value)) ? BigInt(value) : null;

// A claim account alone does not prove which finalized transaction funded the
// category vault. Rebuild the exact settlement instruction and match its token
// balance delta before a paired source can contribute to a bonus window.
export async function loadFinalizedPairedBonusSettlement({ connection, signature, programId,
  mint, quoteMint, authority, agency = true, transaction:providedTransaction }) {
  const transaction = providedTransaction || await connection.getTransaction(signature,
    { commitment:'finalized', maxSupportedTransactionVersion:0 });
  if (!transaction || transaction.meta?.err !== null || !Number.isSafeInteger(transaction.slot)
    || !Number.isSafeInteger(transaction.blockTime) || !transaction.transaction?.signatures?.includes(signature))
    throw new Error('Finalized paired bonus settlement transaction is unavailable.');
  const message = transaction.transaction.message;
  const staticKeys = (message.accountKeys || message.staticAccountKeys || []).map(address);
  const keys = [...staticKeys, ...(transaction.meta.loadedAddresses?.writable || []).map(address),
    ...(transaction.meta.loadedAddresses?.readonly || []).map(address)];
  const signers=staticKeys.slice(0,message.header?.numRequiredSignatures||0);
  let matching = null;
  for (const ix of message.instructions || message.compiledInstructions || []) {
    if (keys[ix.programIdIndex] !== new PublicKey(programId).toBase58()) continue;
    const data = typeof ix.data === 'string' ? Buffer.from(bs58.decode(ix.data)) : Buffer.from(ix.data || []);
    if (data.subarray(0, 8).toString('hex') !== '7e726b06ea0252de') continue;
    if (data.length !== 48 || matching) throw new Error('Paired bonus settlement instruction is ambiguous.');
    const claimId = data.subarray(8, 40);
    const amount = data.readBigUInt64LE(40);
    const accountKeys = (ix.accounts || ix.accountKeyIndexes || []).map(index => keys[index]);
    const signer=accountKeys[0];
    if (!signers.includes(signer) || authority && signer!==new PublicKey(authority).toBase58())
      throw new Error('Paired bonus settlement authority did not sign.');
    const quoteAccount = await connection.getAccountInfo(new PublicKey(quoteMint), 'finalized');
    if (!quoteAccount) throw new Error('Paired bonus quote mint is unavailable.');
    const expected = buildTokenSettlementInstruction({ programId, mint, quoteMint,
      tokenProgram:quoteAccount.owner, authority:signer, claimId, amount, agency });
    if (accountKeys.length !== expected.keys.length
      || expected.keys.some((row, index) => row.pubkey.toBase58() !== accountKeys[index])) continue;
    matching = { claimId, amount, vaultToken:expected.keys[11 + 5].pubkey.toBase58(),
      agencyVaultToken:agency ? expected.keys[11 + 7].pubkey.toBase58() : null };
  }
  if (!matching) throw new Error('Paired bonus settlement instruction is unavailable.');
  const claimAddress = deriveTokenClaimV3(programId, mint, quoteMint, matching.claimId);
  const claimAccount = await connection.getAccountInfo(claimAddress, 'finalized');
  if (!claimAccount?.owner.equals(new PublicKey(programId)))
    throw new Error('Paired bonus claim receipt is unavailable.');
  const claim = decodeTokenClaimV3(claimAccount.data);
  const bonusQuoteRaw = claim.categoryQuoteRaw[5];
  // The legacy claim layout records the first seven categories. Agency
  // category 7 is verified through its exact transaction balance delta.
  const tokenDelta = account => {
    const accountIndex = keys.indexOf(account);
    const before = transaction.meta.preTokenBalances?.find(row => row.accountIndex === accountIndex);
    const after = transaction.meta.postTokenBalances?.find(row => row.accountIndex === accountIndex);
    if (accountIndex < 0 || before?.mint !== new PublicKey(quoteMint).toBase58()
      || after?.mint !== before.mint || quantity(before.uiTokenAmount?.amount) === null
      || quantity(after.uiTokenAmount?.amount) === null)
      throw new Error('Paired bonus vault token balance proof is unavailable.');
    return quantity(after.uiTokenAmount.amount) - quantity(before.uiTokenAmount.amount);
  };
  const agencyQuoteRaw = agency ? tokenDelta(matching.agencyVaultToken) : 0n;
  if (claim.claimId !== matching.claimId.toString('hex') || claim.mint !== new PublicKey(mint).toBase58()
    || claim.totalQuoteRaw !== matching.amount
    || claim.categoryQuoteRaw.reduce((sum, value) => sum + value, 0n) + agencyQuoteRaw !== matching.amount)
    throw new Error('Paired bonus claim receipt conflicts with its settlement.');
  if (tokenDelta(matching.vaultToken) !== bonusQuoteRaw)
    throw new Error('Paired bonus category vault lacks the exact finalized token credit.');
  return { signature, slot:transaction.slot, blockTime:transaction.blockTime,
    mint:new PublicKey(mint).toBase58(), quoteMint:new PublicKey(quoteMint).toBase58(),
    claimId:claim.claimId, grossQuoteRaw:String(matching.amount), bonusQuoteRaw:String(bonusQuoteRaw),
    vaultToken:matching.vaultToken, balanceDeltaVerified:true };
}

export async function verifyStoredPairedBonusSettlement({connection,source,programId,cluster='devnet',
  loadSettlement=loadFinalizedPairedBonusSettlement}) {
  if (source?.programId!==programId || source.cluster!==cluster || source.payoutAsset!=='SOL'
    || source.sourceAsset!==source.quoteMint || source.balanceDeltaVerified!==true)
    throw new Error('Paired bonus source identity is invalid.');
  const proof=await loadSettlement({connection,signature:source.signature,programId,
    mint:source.mint,quoteMint:source.quoteMint,agency:true});
  for(const key of ['signature','slot','blockTime','mint','quoteMint','claimId',
    'grossQuoteRaw','bonusQuoteRaw','vaultToken','balanceDeltaVerified'])
    if(proof[key]!==source[key])throw new Error('Paired bonus source differs from finalized chain evidence.');
  return proof;
}
