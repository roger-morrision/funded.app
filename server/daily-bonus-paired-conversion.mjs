import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import bs58 from 'bs58';
import { PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddressSync, NATIVE_MINT, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { decodeTokenConversionV3, decodeSolCreditV3, deriveTokenConversionV3,
  deriveSolCreditV3 } from '../mint-router-v3-token.js';
import { TOKEN_CONVERSION_POOLS } from './v3-token-keeper.mjs';

const signature = /^[1-9A-HJ-NP-Za-km-z]{64,88}$/;
const units = value => {
  if (!/^(0|[1-9]\d*)$/.test(String(value))) throw new Error('Paired bonus conversion requires integer units.');
  return BigInt(value);
};

// One conversion can consume several tiny category-5 token claims. Attribute
// the actual finalized SOL receipt to the consumed claims, never a price quote.
// Older claims are consumed first; largest remainders assign the SOL dust.
export function allocatePairedBonusSol({ claims, spentQuoteRaw, receivedLamports }) {
  if (!Array.isArray(claims) || !claims.length) throw new Error('Paired bonus conversion has no source claims.');
  const spent = units(spentQuoteRaw), received = units(receivedLamports);
  if (spent === 0n || received === 0n) throw new Error('Paired bonus conversion must receive SOL.');
  const seen = new Set();
  const ordered = claims.map(row => {
    const mint = new PublicKey(row.mint).toBase58();
    const quoteMint = new PublicKey(row.quoteMint).toBase58();
    const available = units(row.availableQuoteRaw);
    if (!signature.test(String(row.settlementSignature || '')) || !/^[a-f0-9]{64}$/.test(String(row.claimId || ''))
      || !Number.isSafeInteger(row.settlementSlot) || row.settlementSlot <= 0 || available === 0n
      || seen.has(row.claimId)) throw new Error('Paired bonus claim identity or balance is invalid.');
    seen.add(row.claimId);
    return { ...row, mint, quoteMint, available };
  }).sort((a, b) => a.settlementSlot - b.settlementSlot
    || a.settlementSignature.localeCompare(b.settlementSignature));
  if (new Set(ordered.map(row => row.mint)).size !== 1 || new Set(ordered.map(row => row.quoteMint)).size !== 1)
    throw new Error('Paired bonus conversion cannot combine mints or quote tokens.');
  let remaining = spent;
  const consumed = [];
  for (const row of ordered) {
    if (!remaining) break;
    const used = row.available < remaining ? row.available : remaining;
    remaining -= used;
    if (used) consumed.push({ row, used, lamports:received * used / spent,
      remainder:received * used % spent });
  }
  if (remaining) throw new Error('Paired bonus conversion spent more than its verified claims.');
  let dust = received - consumed.reduce((sum, row) => sum + row.lamports, 0n);
  for (const row of [...consumed].sort((a, b) => a.remainder === b.remainder
    ? a.row.settlementSignature.localeCompare(b.row.settlementSignature)
    : a.remainder > b.remainder ? -1 : 1)) if (dust-- > 0n) row.lamports++;
  return consumed.map(({ row, used, lamports }) => ({ mint:row.mint, quoteMint:row.quoteMint,
    settlementSignature:row.settlementSignature, claimId:row.claimId,
    spentQuoteRaw:String(used), receivedLamports:String(lamports) }));
}

export function pairedBonusConversionId({ mint, quoteMint, claims }) {
  const coin = new PublicKey(mint).toBuffer(), quote = new PublicKey(quoteMint).toBuffer();
  if (!Array.isArray(claims) || !claims.length || claims.some(row => !/^[a-f0-9]{64}$/.test(String(row.claimId))
    || !/^[1-9]\d*$/.test(String(row.availableQuoteRaw))))
    throw new Error('Paired bonus conversion requires finalized claim identities.');
  const ids = claims.map(row => row.claimId).sort();
  if (new Set(ids).size !== ids.length) throw new Error('Duplicate paired bonus claim.');
  return createHash('sha256').update('funded.daily-bonus.token-conversion.v1').update(coin).update(quote)
    .update(JSON.stringify(claims.map(row=>({id:row.claimId,raw:String(row.availableQuoteRaw)}))
      .sort((a,b)=>a.id.localeCompare(b.id)))).digest();
}

export async function verifyStoredPairedBonusConversion({ connection, programId, cluster='devnet',
  conversion, sources, loadConversion=loadFinalizedPairedBonusConversion }) {
  if (conversion?.status!=='finalized' || conversion.programId!==programId
    || conversion.cluster!==cluster || !Array.isArray(conversion.claims)
    || !Array.isArray(conversion.allocations)
    || !/^[a-f0-9]{64}$/.test(String(conversion.conversionId)))
    throw new Error('Paired bonus conversion record is invalid.');
  const claims=conversion.claims;
  if (pairedBonusConversionId({mint:conversion.mint,quoteMint:conversion.quoteMint,claims}).toString('hex')
    !==conversion.conversionId) throw new Error('Paired bonus conversion intent changed.');
  for (const claim of claims) {
    const source=sources.get(claim.settlementSignature);
    if (!source || source.programId!==programId || source.cluster!==cluster
      || source.mint!==conversion.mint || source.quoteMint!==conversion.quoteMint
      || source.claimId!==claim.claimId || source.slot!==claim.settlementSlot
      || BigInt(claim.availableQuoteRaw)>BigInt(source.bonusQuoteRaw))
      throw new Error('Paired bonus conversion claim conflicts with its finalized source.');
  }
  const proof=await loadConversion({connection,programId,cluster,mint:conversion.mint,
    quoteMint:conversion.quoteMint,conversionId:Buffer.from(conversion.conversionId,'hex'),
    maxSpentQuoteRaw:conversion.amountQuoteRaw});
  const allocations=allocatePairedBonusSol({claims,spentQuoteRaw:proof.spentQuoteRaw,
    receivedLamports:proof.receivedLamports});
  if (proof.signature!==conversion.signature || proof.spentQuoteRaw!==conversion.spentQuoteRaw
    || proof.receivedLamports!==conversion.receivedLamports
    || !isDeepStrictEqual(allocations,conversion.allocations))
    throw new Error('Paired bonus conversion allocation differs from finalized chain evidence.');
  return {proof,allocations};
}

// Recover an interrupted conversion from its immutable PDA rather than
// submitting the same deterministic ID again. The on-chain receipt and both
// token/SOL balance deltas must agree before any claim receives lamports.
export async function loadFinalizedPairedBonusConversion({ connection, programId, mint,
  quoteMint, conversionId, maxSpentQuoteRaw, cluster='devnet' }) {
  const program=new PublicKey(programId), coin=new PublicKey(mint), quote=new PublicKey(quoteMint);
  const id=Buffer.from(conversionId);
  if (id.length!==32 || !/^[1-9]\d*$/.test(String(maxSpentQuoteRaw)))
    throw new Error('Invalid paired bonus conversion identity or quote budget.');
  const pool=TOKEN_CONVERSION_POOLS[cluster]?.[quote.toBase58()];
  if (!pool) throw new Error('No reviewed SOL pool exists for this paired bonus.');
  const address=deriveTokenConversionV3(program,coin,id);
  const [record,creditAccount,quoteAccount,refs]=await Promise.all([
    connection.getAccountInfo(address,'finalized'),
    connection.getAccountInfo(deriveSolCreditV3(program,coin),'finalized'),
    connection.getAccountInfo(quote,'finalized'),
    connection.getSignaturesForAddress(address,{limit:20},'finalized'),
  ]);
  if (!record?.owner.equals(program) || !creditAccount?.owner.equals(program) || !quoteAccount
    || !Array.isArray(refs) || !refs.length)
    throw new Error('Finalized paired bonus conversion account is unavailable.');
  const receipt=decodeTokenConversionV3(record.data),credit=decodeSolCreditV3(creditAccount.data);
  if (receipt.conversionId!==id.toString('hex') || receipt.mint!==coin.toBase58()
    || receipt.quoteMint!==quote.toBase58() || receipt.pool!==pool || receipt.category!==5
    || receipt.spentQuote<=0n || receipt.spentQuote>BigInt(maxSpentQuoteRaw)
    || receipt.receivedLamports<=0n || credit.mint!==coin.toBase58()
    || credit.credited[5]<receipt.receivedLamports)
    throw new Error('Paired bonus conversion receipt conflicts with its token source.');
  const vault=PublicKey.findProgramAddressSync([Buffer.from('mint-fee-vault-v3'),coin.toBuffer(),Buffer.from([5])],program)[0];
  const tokenAccount=getAssociatedTokenAddressSync(quote,vault,true,quoteAccount.owner).toBase58();
  for (const ref of refs) {
    if (ref.err || ref.confirmationStatus!=='finalized') continue;
    const tx=await connection.getTransaction(ref.signature,{commitment:'finalized',maxSupportedTransactionVersion:0});
    if (!tx || tx.meta?.err!==null || tx.slot!==ref.slot
      || !tx.transaction?.signatures?.includes(ref.signature)) continue;
    const keys=[...(tx.transaction.message.accountKeys||tx.transaction.message.staticAccountKeys||[]),
      ...(tx.meta.loadedAddresses?.writable||[]),...(tx.meta.loadedAddresses?.readonly||[])]
      .map(value=>typeof value==='string'?value:value?.pubkey?.toBase58?.()||value?.toBase58?.()||value?.pubkey);
    const instruction=(tx.transaction.message.instructions||tx.transaction.message.compiledInstructions||[])
      .find(ix=>{
        if(keys[ix.programIdIndex]!==program.toBase58())return false;
        const data=typeof ix.data==='string'?Buffer.from(bs58.decode(ix.data)):Buffer.from(ix.data||[]);
        const accounts=(ix.accounts||ix.accountKeyIndexes||[]).map(index=>keys[index]);
        return data.length===57 && data.subarray(0,8).toString('hex')==='647795a88d096dab'
          && data.subarray(8,40).equals(id) && data[40]===5
          && data.readBigUInt64LE(41)>=receipt.spentQuote
          && accounts[6]===vault.toBase58() && accounts[7]===tokenAccount
          && accounts[10]===address.toBase58();
      });
    if(!instruction)continue;
    const vaultIndex=keys.indexOf(vault.toBase58()), tokenIndex=keys.indexOf(tokenAccount);
    const wsolIndex=keys.indexOf(getAssociatedTokenAddressSync(NATIVE_MINT,vault,true,TOKEN_PROGRAM_ID).toBase58());
    const pre=tx.meta.preTokenBalances?.find(row=>row.accountIndex===tokenIndex);
    const post=tx.meta.postTokenBalances?.find(row=>row.accountIndex===tokenIndex);
    if (vaultIndex<0 || tokenIndex<0 || !pre || !post || pre.mint!==quote.toBase58()
      || post.mint!==pre.mint) continue;
    const tokenDebit=BigInt(pre.uiTokenAmount.amount)-BigInt(post.uiTokenAmount.amount);
    if(wsolIndex<0||!Number.isSafeInteger(tx.meta.preBalances?.[wsolIndex])
      ||tx.meta.postBalances?.[wsolIndex]!==0)continue;
    const quotePrefund=BigInt(tx.meta.preBalances[wsolIndex]);
    const vaultDelta=BigInt(tx.meta.postBalances[vaultIndex])-BigInt(tx.meta.preBalances[vaultIndex])-quotePrefund;
    const reserve=BigInt(await connection.getMinimumBalanceForRentExemption(0,'finalized'));
    if (tokenDebit!==receipt.spentQuote || vaultDelta<receipt.receivedLamports
      || vaultDelta-receipt.receivedLamports>reserve) continue;
    return { signature:ref.signature, slot:tx.slot, blockTime:tx.blockTime,
      conversionId:id.toString('hex'), mint:coin.toBase58(), quoteMint:quote.toBase58(),
      spentQuoteRaw:String(receipt.spentQuote), receivedLamports:String(receipt.receivedLamports),
      vault:vault.toBase58(), balanceDeltaVerified:true };
  }
  throw new Error('Paired bonus conversion lacks its exact finalized token and SOL deltas.');
}
