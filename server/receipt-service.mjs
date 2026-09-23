import { createHash } from 'node:crypto';
import { selectReceiptCandidates } from './receipt-candidates.mjs';
import { verifyCollectionReceipt, verifyPayoutReceipt } from './receipt-evidence.mjs';
import { createReadCache } from './read-cache.mjs';
import { receiptFingerprint, cachedReceiptProof } from './receipt-history.mjs';

export function createReceiptEvidenceReader({ store, cluster, connectionFactory, officialGenesis, maxActive = 4, commitment = 'confirmed' }) {
  if (!['confirmed','finalized'].includes(commitment)) throw new Error('Unsupported receipt commitment.');
  const globalCache = createReadCache({ ttlMs: 30_000, maxEntries: 1 });
  const scopedCache = createReadCache({ ttlMs: 30_000, maxEntries: 100 });
  let active = 0;
  async function verify(candidates) {
    const { collections, payouts, coverage, scope } = candidates;
    const base = { cluster, generatedAt: new Date().toISOString(), verifiedCollections: [], verifiedPayouts: [], coverage, scope, commitment, indexedRecords:0 };
    const unavailable = reason => ({ ...base, status: 'unavailable', reason });
    if (cluster !== 'devnet') return unavailable('Devnet evidence is disabled on this cluster.');
    if (!coverage.recordedCollections && !coverage.recordedPayouts) return { ...base, status: 'no-records', reason: 'No collection or payout signatures are recorded.' };
    // Separate creator windows must not create unbounded aggregate RPC fan-out.
    // Fail closed instead of growing an unbounded queue behind slow RPC requests.
    if (active >= maxActive) return unavailable('Receipt verification is busy. Try again shortly; do not submit another payout.');
    active += 1;
    try {
      let unavailableRecords = 0;
      const work = [
        ...collections.map(record => ({ kind:'collections', record, check: verifyCollectionReceipt, target: base.verifiedCollections })),
        ...payouts.map(record => ({ kind:'payouts', record, check: verifyPayoutReceipt, target: base.verifiedPayouts })),
      ];
      const pending=[];
      let indexed=new Map();
      if(commitment==='finalized') {
        try { indexed=new Map((await store.readReceiptProofs(work.map(item=>receiptFingerprint(item.kind,item.record)))).map(entry=>[entry.key,entry])); }
        catch { base.indexStorage='unavailable'; }
      }
      for(const item of work) {
        const key=receiptFingerprint(item.kind,item.record),entry=indexed.get(key);
        const proof=cachedReceiptProof(entry,item.kind,item.record);
        if(proof){item.target.push({...proof,verifiedAt:entry.verifiedAt});base.indexedRecords++;}
        else pending.push({...item,key});
      }
      let connection;
      if(pending.length) {
        connection = connectionFactory();
        try {
          const [configured, official] = await Promise.all([connection.getGenesisHash(), officialGenesis()]);
          if (!configured || configured !== official) return unavailable('Configured RPC is not Solana Devnet.');
        } catch { return unavailable('Devnet genesis could not be verified.'); }
      }
      const additions=[];
      for (let index = 0; index < pending.length; index += 4) {
        await Promise.all(pending.slice(index, index + 4).map(async ({ record, check, target, key }) => {
          try {
            const transaction = await connection.getTransaction(record.signature, { commitment, maxSupportedTransactionVersion: 0 });
            if (!transaction) { unavailableRecords += 1; return; }
            const proof = check(record, transaction);
            if (proof) {
              target.push(proof);
              if(commitment==='finalized')additions.push({key,cluster,commitment,proof,verifiedAt:new Date().toISOString()});
            }
          } catch { unavailableRecords += 1; }
        }));
      }
      if(additions.length) {
        try { await store.writeReceiptProofs([...new Map(additions.map(entry=>[entry.key,entry])).values()]);base.indexStorage='persistent'; }
        catch { base.indexStorage='unavailable'; }
      }
      const checked = collections.length + payouts.length;
      const verified = base.verifiedCollections.length + base.verifiedPayouts.length;
      const incomplete = unavailableRecords > 0 || checked < coverage.recordedCollections + coverage.recordedPayouts || verified < checked;
      return { ...base, status: verified ? incomplete ? 'partial' : 'onchain-indexed' : unavailableRecords ? 'unavailable' : 'unverified-records',
        reason: incomplete ? `Only matching ${commitment} transaction deltas are displayed; totals may be incomplete.` : `All checked receipts have ${commitment} matching balance deltas.`, unavailableRecords };
    } finally { active -= 1; }
  }
  return async (scopedState = null) => {
    if (!scopedState) return globalCache('global', async () => verify(await store.readReceiptCandidates(cluster)));
    const candidates = selectReceiptCandidates(scopedState, cluster, { creatorScoped: true });
    // Financial record edits invalidate cached evidence, even within the 30-second TTL.
    const fingerprint = createHash('sha256').update(JSON.stringify(candidates)).digest('hex');
    return scopedCache(fingerprint, () => verify(candidates));
  };
}
