import {boostPackage} from './boost-packages.js';

export const STACKED_BOOST_POLICY='add-quantity-and-hours-v1';

// Receipts stay immutable. Replaying finalized payments in chain order makes
// retries, concurrent confirmations and late indexing produce the same timeline.
export function projectBoostReceipts(receipts,{cluster='devnet',now=Date.now()}={}) {
  const rows=Object.values(receipts||{}).filter(row=>{
    const pack=boostPackage(row?.packageId),start=Date.parse(row?.startsAt),end=Date.parse(row?.expiresAt);
    return row?.cluster===cluster&&row.status==='finalized'&&pack?.multiplier===row.multiplier
      &&Number.isFinite(start)&&start<=now&&Number.isFinite(end)&&end>start
      &&(!row.durationPolicy||(row.durationPolicy===STACKED_BOOST_POLICY&&row.hours===pack.hours));
  }).sort((a,b)=>Date.parse(a.startsAt)-Date.parse(b.startsAt)||(a.slot||0)-(b.slot||0)||String(a.signature||'').localeCompare(String(b.signature||'')));
  const signatures=new Set(),quotes=new Set(),activeByMint=new Map(),result=[];
  for(const row of rows) {
    if(row.signature&&signatures.has(row.signature)||row.quoteId&&quotes.has(row.quoteId))continue;
    if(row.signature)signatures.add(row.signature);if(row.quoteId)quotes.add(row.quoteId);
    const start=Date.parse(row.startsAt);
    let active=(activeByMint.get(row.mint)||[]).filter(group=>group.end>start);
    const group={end:Date.parse(row.expiresAt)};
    if(row.durationPolicy===STACKED_BOOST_POLICY) {
      const end=Math.max(start,...active.map(prior=>prior.end))+row.hours*3600000;
      if(!Number.isSafeInteger(end)||end>8640000000000000)continue;
      group.end=end;
      for(const prior of active)prior.parent=group;
      active=[];
    }
    active.push(group);activeByMint.set(row.mint,active);result.push({row,group});
  }
  return result.map(({row,group})=>{
    const path=[];let last=group;
    while(last.parent){path.push(last);last=last.parent;}
    for(const prior of path)prior.parent=last;
    return {...row,originalExpiresAt:row.expiresAt,expiresAt:new Date(last.end).toISOString()};
  });
}
