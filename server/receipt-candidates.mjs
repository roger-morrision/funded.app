export const RECEIPT_WINDOW = 12;

// Selection is not verification. Every selected record still needs its RPC proof.
export function selectReceiptCandidates(state, cluster, { creatorScoped = false } = {}) {
  const order = (a, b) => {
    const timeA = String(a[1].recordedAt || a[1].paidAt || '');
    const timeB = String(b[1].recordedAt || b[1].paidAt || '');
    return timeA < timeB ? 1 : timeA > timeB ? -1 : a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0;
  };
  const eligible = (bucket, status) => Object.entries(state[bucket] || {})
    .filter(([, row]) => row?.cluster === cluster && row.status === status && typeof row.signature === 'string' && row.signature.length > 0)
    .sort(order);
  const collections = eligible('collections', 'collected');
  const payouts = eligible('payouts', 'paid');
  const selectedPayouts = payouts.slice(0, RECEIPT_WINDOW);
  // A recent payout can settle an old collection. Include that source before newer
  // unrelated collections, so the immutable entitlement join can be verified.
  const linked = creatorScoped ? new Set(selectedPayouts.map(([, row]) => state.obligations?.[row.obligationId]?.claimSignature).filter(Boolean)) : new Set();
  const selectedCollections = [...collections.filter(([key]) => linked.has(key)), ...collections.filter(([key]) => !linked.has(key))].slice(0, RECEIPT_WINDOW);
  return structuredClone({ collections: selectedCollections.map(([, row]) => row), payouts: selectedPayouts.map(([, row]) => row),
    coverage: { recordedCollections: collections.length, recordedPayouts: payouts.length,
      checkedCollections: selectedCollections.length, checkedPayouts: selectedPayouts.length },
    scope: creatorScoped ? 'creator-recent' : 'global-recent' });
}
