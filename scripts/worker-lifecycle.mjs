export class WorkerStoppingError extends Error {
  constructor() { super('Worker is stopping; no new request may start.'); this.name = 'WorkerStoppingError'; }
}

// Stop admission and wake idle waits, but never abort a request that may already
// have submitted a transaction. Its existing timeout and server journal own
// uncertain completion; the caller must await it before disposing this scope.
export function createWorkerLifecycle({ name, signals = process, logger = console } = {}) {
  let stopped = false;
  const waits = new Set();
  const stop = signal => {
    if (stopped) return;
    stopped = true;
    logger.log(JSON.stringify({ event:'worker_shutdown_started', worker:name, signal }));
    for (const wake of [...waits]) wake();
  };
  const term = () => stop('SIGTERM'), interrupt = () => stop('SIGINT');
  // Keep both handlers installed during admitted work, including repeated signals.
  signals.on('SIGTERM', term); signals.on('SIGINT', interrupt);
  return {
    get stopped() { return stopped; },
    assertRunning() { if (stopped) throw new WorkerStoppingError(); },
    wait(milliseconds) {
      if (stopped) return Promise.resolve();
      return new Promise(resolve => {
        const wake = () => { clearTimeout(timer); waits.delete(wake); resolve(); };
        const timer = setTimeout(wake, milliseconds); waits.add(wake);
      });
    },
    dispose() {
      signals.removeListener('SIGTERM', term); signals.removeListener('SIGINT', interrupt);
      for (const wake of [...waits]) wake();
      if (stopped) logger.log(JSON.stringify({ event:'worker_shutdown_finished', worker:name }));
    },
  };
}
