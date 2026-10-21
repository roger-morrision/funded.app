// Aim for one serial cycle per interval. Long verified cycles must not be
// followed by another full interval of idle time; readiness still expires
// normally if verification itself cannot complete within its existing guard.
export function agencyBuybackWaitMs(intervalMs, elapsedMs) {
  if (!Number.isFinite(intervalMs) || intervalMs < 5000
    || !Number.isFinite(elapsedMs) || elapsedMs < 0)
    throw new Error('A finite agency polling interval and monotonic duration are required.');
  return Math.max(5000, intervalMs - elapsedMs);
}

export async function runAgencyBuybackLoop({ config, runCycle, onBlocked,
  shouldStop = () => false, wait, now = () => performance.now() }) {
  while (!shouldStop()) {
    const startedAt = now();
    let waitMs = config.intervalMs;
    try {
      const result = await runCycle();
      // runAgencyCycle records a degraded heartbeat without throwing when a
      // milestone is unavailable. Only its matching ready-result shape can
      // shorten idle; degraded, dry-run and unknown results keep full backoff.
      if (result?.mode === 'execute' && result.cluster === 'devnet'
        && /^[a-f0-9]{40}$/.test(String(config.build)) && result.build === config.build
        && Array.isArray(result.events) && result.events.every(row => row && row.status !== 'execution-unavailable'))
        waitMs = agencyBuybackWaitMs(config.intervalMs, now() - startedAt);
    } catch (error) {
      await onBlocked(error);
    }
    if (config.mode !== 'loop' || shouldStop()) break;
    await wait(waitMs);
  }
}
