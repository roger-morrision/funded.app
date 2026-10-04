/** Heartbeat checks fail closed for missing, invalid, future and stale timestamps. */
export function workerHeartbeatHealth(report, { now = Date.now(), maxAgeMs = 90_000, expectedCluster = null } = {}) {
  const reasons = [];
  const checkedAt = typeof report?.at === 'string' ? report.at : null;
  const checkedMs = checkedAt ? Date.parse(checkedAt) : NaN;
  const ageMs = Number.isFinite(checkedMs) && Number.isFinite(now) ? now - checkedMs : null;
  if (!Number.isFinite(maxAgeMs) || maxAgeMs <= 0 || !Number.isFinite(now)) reasons.push('heartbeat-clock-configuration-invalid');
  if (ageMs === null) reasons.push('heartbeat-timestamp-missing-or-invalid');
  else if (ageMs < 0) reasons.push('heartbeat-timestamp-in-future');
  else if (ageMs > maxAgeMs) reasons.push('heartbeat-stale');
  if (report?.status !== 'ready') reasons.push('worker-not-ready');
  if (expectedCluster && report?.cluster !== expectedCluster) reasons.push('heartbeat-network-mismatch');
  return { healthy: reasons.length === 0, checkedAt, ageMs, reasons };
}

export function workerFailureReport({ quotaExhausted = false, retryAfterMs, now = Date.now(), cluster = 'devnet' } = {}) {
  return { status: quotaExhausted ? 'rpc-quota-exhausted' : 'failed', cluster, at: new Date(now).toISOString(),
    reason: quotaExhausted ? 'RPC quota exhausted; wait for the provider retry window.' : 'The latest worker pass failed. Inspect operator logs and reconcile pending transactions before retrying.',
    ...(Number.isFinite(retryAfterMs) && retryAfterMs > 0 ? { retryAfterMs } : {}) };
}

export function rewardWorkerFailureStatus({ quotaExhausted = false, now = Date.now() } = {}) {
  return { constrainedPayouts: false, reasons: [quotaExhausted ? 'rpc-quota-exhausted' : 'worker-pass-failed'],
    reason: quotaExhausted ? 'Automatic distributions are unavailable because the Devnet RPC quota is exhausted.' : 'The latest reward worker pass failed. Reconcile pending payments before retrying.',
    checkedAt: new Date(now).toISOString() };
}
