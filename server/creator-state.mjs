export function scopedCreatorState(state, id, cluster, { financial=true }={}) {
  const result={creatorProfiles:{},launches:{},collections:{},v3Settlements:{},
    v3CreatorRewardFunding:{},v3XClaims:{}};
  if(state.creatorProfiles?.[id])result.creatorProfiles[id]=state.creatorProfiles[id];
  for(const [key,row] of Object.entries(state.launches||{}))if(String(row.xUserId)===id&&row.cluster===cluster)result.launches[key]=row;
  if(!financial)return structuredClone(result);
  const mints=new Set(Object.keys(result.launches));
  for(const [key,row] of Object.entries(state.collections||{}))if(mints.has(row.mint)
    && row.scope==='per-mint-v3')result.collections[key]=row;
  for(const key of Object.keys(result.collections)) {
    if(state.v3Settlements?.[key])result.v3Settlements[key]=state.v3Settlements[key];
    if(state.v3CreatorRewardFunding?.[key])result.v3CreatorRewardFunding[key]=state.v3CreatorRewardFunding[key];
    if(state.v3XClaims?.[key]&&String(state.v3XClaims[key].xUserId)===id)
      result.v3XClaims[key]=state.v3XClaims[key];
  }
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
