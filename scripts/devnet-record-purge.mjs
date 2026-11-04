// Pure planning helpers. Execution is restricted to an inventoried Devnet database.
export const containsReference=(value,refs)=>{
  const text=JSON.stringify(value);return typeof text==='string'&&[...refs].some(ref=>text.includes(ref));
};
const referenceField=/^(eventId|claimId|withdrawalId|buybackId|cycleId|obligationId|fundingRequestId|.*Signature|signature|transaction)$/;
export function collectReferences(value,refs){
  if(!value||typeof value!=='object')return;
  for(const [name,child]of Object.entries(value)){
    if(referenceField.test(name)&&typeof child==='string'&&child.length>=16&&!/^\d{4}-\d{2}-\d{2}/.test(child))refs.add(child);
    else if(child&&typeof child==='object')collectReferences(child,refs);
  }
}
export function linkedReferences(rows,mints){
  const refs=new Set(mints);let changed=true;
  while(changed){const prior=refs.size;
    for(const row of rows)if(containsReference(row,refs)){
      collectReferences(row.payload??row,refs);
      const key=row.entity_key??row.event_id;
      if(typeof key==='string'&&key.length>=16&&!/^\d{4}-\d{2}-\d{2}/.test(key))refs.add(key);
    }
    changed=refs.size!==prior;
  }
  return refs;
}
export function scrubShared(value,refs){
  if(typeof value==='string')return containsReference(value,refs)?undefined:value;
  if(!value||typeof value!=='object')return value;
  if(Array.isArray(value))return value.map(item=>scrubShared(item,refs)).filter(item=>item!==undefined);
  for(const [name,child]of Object.entries(value))if(/^(mint|sourceMint|tokenMint|mintAddress|signature|collectionSignature|settlementSignature|eventId)$/.test(name)
    &&typeof child==='string'&&refs.has(child))return undefined;
  return Object.fromEntries(Object.entries(value).filter(([key])=>!containsReference(key,refs))
    .map(([key,child])=>[key,scrubShared(child,refs)]).filter(([,child])=>child!==undefined));
}
export function purgeRewardState(state,refs){
  const counts={};
  const records=new Set(['obligations','batches','programs','schedules','holderSnapshots','rewardPools','buyOrders','fundingRequests',
    'communityDrops','dailyBonusSnapshots','dailyBonusIndexes','dailyBonusSettlementIndexes']);
  const removedKeys=new Set();
  for(const bucket of records){const rows=state[bucket];if(!rows||typeof rows!=='object'||Array.isArray(rows))continue;
    for(const [key,row]of Object.entries(rows))if(containsReference({key,row},refs)){
      delete rows[key];removedKeys.add(key);counts[bucket]=(counts[bucket]||0)+1;
    }
  }
  for(const [key,row]of Object.entries(state.dailyBonusAssignments||{}))if(removedKeys.has(key)||containsReference({key,row},refs)){
    delete state.dailyBonusAssignments[key];counts.dailyBonusAssignments=(counts.dailyBonusAssignments||0)+1;
  }
  for(const bucket of ['communityClaimIndex','tradeFinancialWake'])if(state[bucket])state[bucket]=scrubShared(state[bucket],refs)||{};
  // Recomputed views must not retain summaries of deleted schedules or snapshots.
  for(const bucket of ['financialFlowHealth','dailyBonusProgress'])if(state[bucket])state[bucket]={};
  const residual=Object.entries(state).filter(([,value])=>containsReference(value,refs)).map(([key])=>key);
  if(residual.length)throw Error('Unclassified linked reward state remains: '+residual.join(','));
  return counts;
}
