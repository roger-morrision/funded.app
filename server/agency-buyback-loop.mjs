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
      await runCycle();
      waitMs = agencyBuybackWaitMs(config.intervalMs, now() - startedAt);
    } catch (error) {
      await onBlocked(error);
    }
    if (config.mode !== 'loop' || shouldStop()) break;
    await wait(waitMs);
  }
}
