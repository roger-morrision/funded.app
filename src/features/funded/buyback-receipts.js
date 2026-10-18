// Keep independent buyback history views in the same confirmed execution order.
export function newestBuybackReceipts(receipts) {
  return [...receipts].sort((a, b) =>
    (Number.isSafeInteger(b.slot) ? b.slot : 0) - (Number.isSafeInteger(a.slot) ? a.slot : 0)
    || (Date.parse(b.finalizedAt || b.burnedAt || '') || 0) - (Date.parse(a.finalizedAt || a.burnedAt || '') || 0)
    || String(a.signature || '').localeCompare(String(b.signature || '')));
}
