export function scopedCreatorState(state, id, cluster, { financial=true }={}) {
  const result={creatorProfiles:{},launches:{},obligations:{},claims:{},collections:{},payouts:{}};
  if(state.creatorProfiles?.[id])result.creatorProfiles[id]=state.creatorProfiles[id];
  for(const [key,row] of Object.entries(state.launches||{}))if(String(row.xUserId)===id&&row.cluster===cluster)result.launches[key]=row;
  if(!financial)return structuredClone(result);
  for(const [key,row] of Object.entries(state.obligations||{}))if(String(row.xUserId)===id)result.obligations[key]=row;
  for(const [key,row] of Object.entries(state.claims||{}))if(String(row.xUserId)===id)result.claims[key]=row;
  const signatures=new Set(Object.values(result.obligations).map(row=>row.claimSignature));
  for(const [key,row] of Object.entries(state.collections||{}))if(signatures.has(key))result.collections[key]=row;
  for(const [key,row] of Object.entries(state.payouts||{}))if(Object.hasOwn(result.obligations,row.obligationId))result.payouts[key]=row;
  return structuredClone(result);
}

export function creatorWriteState(state, id) {
  if (!/^\d{1,24}$/.test(id)) throw new Error('Invalid creator identity.');
  return structuredClone({ creatorProfiles: state.creatorProfiles?.[id] ? { [id]: state.creatorProfiles[id] } : {},
    launches: Object.fromEntries(Object.entries(state.launches || {}).filter(([, row]) => String(row.xUserId) === id)) });
}

export async function mutateCreatorState(state, id, mutator) {
  const before = JSON.stringify(state.launches);
  const output = await mutator(state);
  if (JSON.stringify(state.launches) !== before || Object.keys(state).some(key => !['creatorProfiles','launches'].includes(key))
    || !state.creatorProfiles || Object.keys(state.creatorProfiles).some(key => key !== id)
    || (state.creatorProfiles[id]?.id != null && String(state.creatorProfiles[id].id) !== id)) throw new Error('Creator writes may only change the selected profile.');
  return output;
}
