import {verifiedPaidListings} from '../home/paid-listings.js';

// A successful write is fresher than a CDN response fetched immediately after it.
// Retain verified receipts briefly across page views while public caches catch up.
export function createConfirmedListings({now=Date.now,maxAgeMs=120_000}={}){
  const recent=new Map();
  function remember(record,cluster){
    if(!verifiedPaidListings([record],cluster).length)throw Error('The listing response could not be verified.');
    recent.set(`${cluster}:${record.mint}`,{record:structuredClone(record),until:now()+maxAgeMs});
  }
  function merge(records,cluster){
    for(const [key,row] of recent)if(row.until<=now())recent.delete(key);
    const confirmed=[...recent.values()].filter(row=>row.record.cluster===cluster).map(row=>row.record);
    return verifiedPaidListings([...confirmed,...records],cluster);
  }
  return {remember,merge};
}
export const confirmedListings=createConfirmedListings();
