// Each poll owns a signal; callers must check it before publishing results from
// transports (such as Solana SDK calls) that do not support cancellation.
export function createRoutePoller({ run, active, intervalMs, document = globalThis.document, window = globalThis.window, maxBackoffMs = intervalMs * 8 }) {
  let timer, controller;
  let running = false, stopped = false, suspended = false, refreshPending = false, failures = 0;
  const eligible = () => !stopped && !suspended && !document.hidden && active();
  function schedule(delay = intervalMs) {
    clearTimeout(timer);
    if (!stopped && !suspended && !document.hidden) timer = setTimeout(tick, delay);
  }
  async function tick() {
    if (running || stopped || suspended || document.hidden) return;
    if (!active()) { schedule(); return; }
    running = true;
    controller = new AbortController();
    try { await run(controller.signal); if (!controller.signal.aborted) failures = 0; }
    catch (error) { if (!controller.signal.aborted && error?.name !== 'AbortError') failures = Math.min(failures + 1, 8); }
    finally {
      running = false;
      const delay = refreshPending ? 0 : Math.min(maxBackoffMs, intervalMs * 2 ** failures);
      refreshPending = false;
      schedule(delay);
    }
  }
  function changed() {
    clearTimeout(timer);
    if (!eligible()) { controller?.abort(); refreshPending = false; schedule(); return; }
    if (running) { if (controller?.signal.aborted) refreshPending = true; return; }
    schedule(0);
  }
  const suspend = () => { suspended = true; clearTimeout(timer); controller?.abort(); };
  const resume = () => { suspended = false; changed(); };
  const events = [['visibilitychange', changed, document], ['hashchange', changed, window], ['popstate', changed, window], ['funded:route-change', changed, window], ['pagehide', suspend, window], ['pageshow', resume, window]];
  for (const [event, handler, target] of events) target.addEventListener(event, handler);
  function stop() {
    stopped = true;
    clearTimeout(timer);
    controller?.abort();
    for (const [event, handler, target] of events) target.removeEventListener(event, handler);
  }
  schedule();
  return { stop, refresh: changed };
}
