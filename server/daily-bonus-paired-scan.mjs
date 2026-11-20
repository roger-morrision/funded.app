import bs58 from 'bs58';
import { PublicKey } from '@solana/web3.js';
import { deriveTokenLedgerV3 } from '../mint-router-v3-token.js';
import { loadFinalizedPairedBonusSettlement } from './daily-bonus-paired-settlement.mjs';

const signaturePattern = /^[1-9A-HJ-NP-Za-km-z]{64,88}$/;
const address = value => typeof value === 'string' ? value : value?.pubkey?.toBase58?.()
  || value?.pubkey || value?.toBase58?.();

function hasSettlement(transaction, programId, ledger) {
  const message = transaction.transaction.message;
  const keys = [...(message.accountKeys || message.staticAccountKeys || []),
    ...(transaction.meta.loadedAddresses?.writable || []),
    ...(transaction.meta.loadedAddresses?.readonly || [])].map(address);
  return (message.instructions || message.compiledInstructions || []).some(ix => {
    if (keys[ix.programIdIndex] !== programId) return false;
    const data = typeof ix.data === 'string' ? Buffer.from(bs58.decode(ix.data)) : Buffer.from(ix.data || []);
    return data.subarray(0, 8).toString('hex') === '7e726b06ea0252de'
      && (ix.accounts || ix.accountKeyIndexes || []).some(index => keys[index] === ledger);
  });
}

// Backfill to launch time while also reading new head transactions every tick.
// The snapshot path may accept paired sources only after backfillComplete is
// true, so a page limit or RPC gap cannot silently omit an older settlement.
export async function scanPairedBonusSettlements({ connection, store, cluster='devnet', programId,
  mint, quoteMint, authority, createdTimestamp, pageSize=100, pagesPerTick=4,
  loadSettlement=loadFinalizedPairedBonusSettlement }) {
  if (!Number.isSafeInteger(createdTimestamp) || createdTimestamp <= 0
    || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100
    || !Number.isSafeInteger(pagesPerTick) || pagesPerTick < 1 || pagesPerTick > 20)
    throw new Error('Invalid paired bonus scan bounds.');
  const coin=new PublicKey(mint).toBase58(), quote=new PublicKey(quoteMint).toBase58();
  const program=new PublicKey(programId).toBase58();
  const ledger=deriveTokenLedgerV3(program,coin,quote);
  const key=`${cluster}:${coin}:${quote}`;
  const state=await store.read();
  const saved=state.v3TokenBonusScans?.[key] || { head:null, backfillBefore:null, backfillComplete:false };
  const scan=structuredClone(saved), discoveries=[];
  const process=async ref=>{
    if (!signaturePattern.test(ref.signature || '') || !Number.isSafeInteger(ref.slot)
      || !Number.isSafeInteger(ref.blockTime) || ref.confirmationStatus!=='finalized')
      throw new Error('Paired bonus settlement history has an unresolved finalized reference.');
    if (ref.err || ref.blockTime < createdTimestamp) return;
    const tx=await connection.getTransaction(ref.signature,{commitment:'finalized',maxSupportedTransactionVersion:0});
    if (!tx || tx.slot!==ref.slot || tx.blockTime!==ref.blockTime || tx.meta?.err!==null
      || !tx.transaction?.signatures?.includes(ref.signature))
      throw new Error('Paired bonus settlement history has a transaction gap.');
    if (!hasSettlement(tx,program,ledger.toBase58())) return;
    const proof=await loadSettlement({connection,transaction:tx,signature:ref.signature,
      programId:program,mint:coin,quoteMint:quote,authority,agency:true});
    discoveries.push({ ...proof, cluster, programId:program,
      status:'settled', sourceAsset:quote, payoutAsset:'SOL' });
  };
  if (scan.head) {
    let before, found=false, newest=scan.head;
    for (let page=0;page<pagesPerTick;page++) {
      const refs=await connection.getSignaturesForAddress(ledger,{limit:pageSize,...(before?{before}:{})},'finalized');
      if (!Array.isArray(refs) || refs.length>pageSize) throw new Error('Invalid paired bonus head page.');
      if (!before && refs[0]) newest=refs[0].signature;
      for (const ref of refs) {
        if (ref.signature===scan.head) { found=true; break; }
        await process(ref);
      }
      if (found) break;
      if (refs.length<pageSize) throw new Error('Paired bonus scan head disappeared from finalized history.');
      before=refs.at(-1).signature;
    }
    if (!found) throw new Error('Paired bonus head scan exceeded its page limit.');
    scan.head=newest;
  }
  if (!scan.backfillComplete) {
    for (let page=0;page<pagesPerTick;page++) {
      const refs=await connection.getSignaturesForAddress(ledger,
        {limit:pageSize,...(scan.backfillBefore?{before:scan.backfillBefore}:{})},'finalized');
      if (!Array.isArray(refs) || refs.length>pageSize) throw new Error('Invalid paired bonus backfill page.');
      if (!scan.head && refs[0]) scan.head=refs[0].signature;
      for (const ref of refs) await process(ref);
      scan.backfillBefore=refs.at(-1)?.signature || scan.backfillBefore;
      if (refs.length<pageSize || refs.some(ref=>ref.blockTime<createdTimestamp)) {
        scan.backfillComplete=true; break;
      }
    }
  }
  await store.update(current=>{
    current.v3TokenBonusScans ||= {};
    current.v3TokenBonusSources ||= {};
    const prior=current.v3TokenBonusScans[key];
    if (prior && JSON.stringify(prior)!==JSON.stringify(saved))
      throw new Error('Paired bonus scan changed concurrently.');
    for (const row of discoveries) {
      const existing=current.v3TokenBonusSources[row.signature];
      if (existing && JSON.stringify(existing)!==JSON.stringify(row))
        throw new Error('Paired bonus settlement source changed after verification.');
      current.v3TokenBonusSources[row.signature] ||= row;
    }
    current.v3TokenBonusScans[key]=scan;
  });
  return { complete:scan.backfillComplete, discovered:discoveries.length, head:scan.head };
}
