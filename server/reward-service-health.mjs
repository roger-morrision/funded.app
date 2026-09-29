const MAX_STATUS_AGE_MS = 180_000;

export function rewardServiceHealth(service = {}, nowMs = Date.now()) {
  const checkedAt = service.checkedAt || null;
  const checkedMs = checkedAt ? Date.parse(checkedAt) : NaN;
  const ageMs = Number.isFinite(checkedMs) ? nowMs - checkedMs : null;
  const reasons = Array.isArray(service.reasons) ? [...service.reasons] : [];

  if (!checkedAt) reasons.push('worker-has-not-reported-readiness');
  else if (ageMs === null) reasons.push('worker-readiness-timestamp-invalid');
  else if (ageMs < 0) reasons.push('worker-readiness-timestamp-in-future');
  else if (ageMs > MAX_STATUS_AGE_MS) reasons.push('worker-readiness-stale');
  if (service.constrainedPayouts !== true && reasons.length === 0) reasons.push('constrained-payouts-not-ready');

  return {
    healthy: service.constrainedPayouts === true && ageMs !== null && ageMs >= 0 && ageMs <= MAX_STATUS_AGE_MS,
    checkedAt,
    ageSeconds: ageMs === null ? null : Math.floor(ageMs / 1000),
    reasons: [...new Set(reasons)],
  };
}
