import {activeBoostMultiplier, currentBoostSnapshot, boostPackage} from '../../../boost-offer.js';

// A successful write is newer than the shared read caches. Retain its full
// server-computed total briefly; never add it to an aggregate and double count.
export function createConfirmedBoosts({now=Date.now,maxAgeMs=120_000}={}) {
  const recent=new Map();
  function remember(receipt,cluster) {
    const active=currentBoostSnapshot({[receipt?.mint]:receipt?.active},now())[receipt?.mint];
    if(receipt?.cluster!==cluster || receipt?.status!=='finalized' || receipt?.adminBoost!==true
      || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(receipt?.mint||'')
      || !/^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(receipt?.signature||'')
      || boostPackage(receipt?.packageId)?.multiplier!==receipt?.multiplier
      || !active || active.mint!==receipt.mint || active.multiplier<receipt.multiplier)
      throw new Error('The confirmed boost total could not be verified.');
    recent.set(`${cluster}:${receipt.mint}`,{cluster,active:structuredClone(active),until:now()+maxAgeMs});
  }
  function merge(records,cluster) {
    const merged=currentBoostSnapshot(records,now());
    for(const [key,row] of recent) {
      if(row.until<=now()){recent.delete(key);continue;}
      if(row.cluster!==cluster)continue;
      const confirmed=currentBoostSnapshot({[row.active.mint]:row.active},now())[row.active.mint];
      if(confirmed && activeBoostMultiplier(merged[confirmed.mint],now())<=confirmed.multiplier)
        merged[confirmed.mint]=confirmed;
    }
    return merged;
  }
  return {remember,merge};
}
export const confirmedBoosts=createConfirmedBoosts();
