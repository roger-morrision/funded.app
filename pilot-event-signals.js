// Optional local measurement only. The consented pilot recorder owns storage;
// transaction code emits a bounded event name, never a wallet, receipt or error.
const allowed = new Set([
  'launch-review-opened', 'launch-review-cancelled', 'launch-submission-started',
  'launch-confirmed', 'launch-registration-pending', 'launch-cancelled', 'launch-stopped',
  'claim-started', 'claim-verified', 'claim-pending', 'claim-cancelled', 'claim-stopped',
]);
export function emitPilotSignal(name, target = globalThis.window) {
  if (!allowed.has(name) || !target?.dispatchEvent) return false;
  try { target.dispatchEvent(new CustomEvent('funded:pilot-event', { detail: { name } })); return true; }
  catch { return false; } // Optional measurement never changes a transaction outcome.
}
export function pilotInterruptedSignal(flow, error, mayHaveSubmitted = false) {
  if (!['launch', 'claim'].includes(flow)) return null;
  if (flow === 'claim' && mayHaveSubmitted) return 'claim-pending';
  // Only explicit wallet rejection codes before submission are cancellations.
  // Message text and transport errors cannot prove whether chain execution happened.
  const rejected = error?.code === 4001 || error?.code === '4001' || error?.code === 'ACTION_REJECTED';
  return `${flow}-${rejected && !mayHaveSubmitted ? 'cancelled' : 'stopped'}`;
}
export function verifiedPilotLaunchRegistration(response, mint) {
  return response?.available === true && response.data?.onchainVerified === true
    && typeof mint === 'string' && Boolean(mint) && response.data.mint === mint
    && response.data.cluster === 'devnet';
}
