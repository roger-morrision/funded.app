export function publicState(state) {
  return {
    version: state.version,
    launches: Object.values(state.launches || {}).filter(item => item.pumpFeeRoute?.scope === 'per-mint-v3'),
    settlements: Object.values(state.v3Settlements || {}).map(item => ({
      collectionSignature:item.collectionSignature, settlementSignature:item.settlementSignature,
      mint:item.mint, status:item.status, allocationPlan:item.allocationPlan || null })),
    collections: Object.values(state.collections || {}).filter(item => item.scope === 'per-mint-v3')
      .map(item => ({ id:item.id, mint:item.mint, signature:item.signature,
        status:item.status, collectedLamports:item.collectedLamports,
        recordedAt:item.recordedAt })),
  };
}
