// Bounded, tab-local diagnostics. No identities, amounts, text or URLs are kept.
const samples = [];
const flows = new Set(['token-detail', 'quote', 'claim-preparation', 'recovery']);
const seen = new Set();
export function recordFlowTiming(flow, ms, outcome, temperature = 'warm') {
  if (!flows.has(flow) || !Number.isFinite(ms) || ms < 0
    || !['verified', 'available', 'unavailable', 'pending'].includes(outcome)) return;
  samples.push({flow, ms:Math.round(ms), outcome, temperature:temperature === 'cold' ? 'cold' : 'warm'});
  if (samples.length > 200) samples.shift();
}
export function flowTimingSummary(rows = samples) {
  const groups = new Map();
  for (const row of rows) {
    const key = `${row.flow}/${row.temperature}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return [...groups].map(([key, group]) => {
    const times = group.map(row => row.ms).sort((a,b) => a-b);
    return {key, samples:times.length, p50:times[Math.ceil(times.length*.5)-1], p95:times[Math.ceil(times.length*.95)-1],
      unavailable:group.filter(row => row.outcome === 'unavailable').length, pending:group.filter(row => row.outcome === 'pending').length};
  });
}
export function beginApiTiming(path) {
  const flow = /^\/api\/airdrops\/claims\/prepare(?:\?|$)/.test(path) ? 'claim-preparation'
    : /\/quote(?:\?|$)/.test(path) ? 'quote' : null;
  if (!flow) return () => {};
  const start = performance.now(), temperature = seen.has(flow) ? 'warm' : 'cold'; seen.add(flow);
  return outcome => recordFlowTiming(flow, performance.now()-start, outcome, temperature);
}
export function mountFlowDiagnostics(document = globalThis.document) {
  const parent = document.querySelector('#profile'); if (!parent) return;
  const details = document.createElement('details'); details.className = 'flow-panel'; details.dataset.inlineStatus = '';
  details.innerHTML = '<summary>Performance in this tab</summary><p>Up to 200 local timing samples. Cold means the first observation of each flow in this tab. Warm means a repeat. HTTP availability does not prove a confirmed transaction. No data is sent from this panel.</p><div data-timing></div><button type="button">Clear local timing samples</button>';
  const render = () => {
    const target = details.querySelector('[data-timing]'); target.replaceChildren();
    const rows = flowTimingSummary();
    for (const row of rows) { const p = document.createElement('p'); p.textContent = `${row.key} · ${row.samples} samples · p50 ${row.p50}ms · p95 ${row.p95}ms · ${row.unavailable} unavailable · ${row.pending} pending`; target.append(p); }
    if (!rows.length) target.textContent = 'No measured actions in this tab yet.';
  };
  details.addEventListener('toggle', render);
  details.querySelector('button').addEventListener('click', () => { samples.length=0; seen.clear(); render(); }); parent.append(details);
}
