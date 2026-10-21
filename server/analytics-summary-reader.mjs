// One route instance owns one live join. Retired loads retain their slot until
// every started dependency settles, even if another dependency rejects early.
// A timeout stops waiting for the report; it does not cancel financial readers.
export function createAnalyticsSummaryReader(readers) {
  if (!Array.isArray(readers) || readers.length !== 4 || readers.some(read => typeof read !== 'function'))
    throw new TypeError('Analytics requires four fixed read dependencies.');
  const dependencies = [...readers];
  const unavailable = Object.freeze({ available:false });
  const loads = new Set();
  let current;
  return function read() {
    if (current) return current.reply;
    if (loads.size >= 2) return Promise.resolve(unavailable);
    const load = {};
    loads.add(load); current = load;
    // Start all four through promises so a synchronous throw cannot bypass
    // tracking of the other readers. Attach both aggregators before they run.
    const started = dependencies.map(reader => Promise.resolve().then(reader));
    void Promise.allSettled(started).then(() => loads.delete(load));
    let timer;
    const outcome = Promise.all(started).then(values => ({ available:true, values }), () => unavailable);
    const deadline = new Promise(resolve => { timer = setTimeout(() => resolve(unavailable), 6_000); });
    load.reply = Promise.race([outcome, deadline]).finally(() => {
      clearTimeout(timer);
      if (current === load) current = null;
    });
    return load.reply;
  };
}
