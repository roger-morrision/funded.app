// These labels describe recorded progress, not fresh chain verification.
export function tradeRecoveryCopy(row) {
  if (row.progress === 'indexing') return {
    action:'Check trade history',
    detail:'Finalized token balance change was verified. Trade history is still being updated. Check history; do not submit this trade again.',
  };
  if (row.progress === 'confirmed') return {
    action:'Check finalization',
    detail:'The trade was confirmed. Finalization, token balance change and trade history still need verification. Check the recorded transaction before retrying.',
  };
  return {
    action:'Check recorded trade',
    detail:'A signed trade needs verification. A timeout does not prove it failed. Check the recorded transaction before retrying.',
  };
}

export function tradeVerificationUnavailable(row) {
  return row.progress === 'indexing'
    ? 'Trade history is unavailable. The previously verified trade is preserved. Check history again later; do not submit this trade again.'
    : 'Trade verification is unavailable. The saved transaction is preserved. Check it again later before retrying the trade.';
}
