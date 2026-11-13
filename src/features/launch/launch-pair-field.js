import { escapeHtml } from '../shared/display.js';
import { loadPairQuotes, PAIR_CATEGORIES, WSOL_MINT } from '../shared/pair-label.js';
// Step 1 of the launch form: an optional "Paired with" dropdown, grouped by
// category. Leaving it on SOL keeps the standard richpad.fun launch. Picking a
// token launches from this step as a paired pump.fun coin (the creator's wallet
// is Pump's creator; richpad's SOL fee router, reserves and tiers do not apply).
export async function mountLaunchPairField(app) {
  const step = document.querySelector('#launch-form [data-launch-step="1"]');
  const anchor = step?.querySelector('.coin-fields');
  if (!step || !anchor || step.querySelector('#launch-pair-select')) return;
  const { pairLaunchStatus } = await import('./pair-launch.js');
  if (!(await pairLaunchStatus(app)).enabled) return;
  const quotes = (await loadPairQuotes(path => app.apiRequest(path).then(result => result?.data || result))).filter(row => row.mint !== WSOL_MINT);
  if (!quotes.length) return;
  const groups = PAIR_CATEGORIES.filter(([key]) => !['all', 'sol'].includes(key))
    .map(([key, label]) => [label, quotes.filter(row => (row.category || 'custom') === key)]).filter(([, rows]) => rows.length);
  const field = document.createElement('div');
  field.className = 'launch-pair-field full-label';
  field.innerHTML = `<label for="launch-pair-select">Paired with <span class="optional">optional</span></label>
    <select id="launch-pair-select" aria-describedby="launch-pair-help">
      <option value="">SOL · no pair (standard richpad.fun launch)</option>
      ${groups.map(([label, rows]) => `<optgroup label="${escapeHtml(`${label} (${rows.length})`)}">${rows.map(row => `<option value="${escapeHtml(row.mint)}">${escapeHtml(row.symbol)}${row.name ? ` · ${escapeHtml(row.name)}` : ''}</option>`).join('')}</optgroup>`).join('')}
    </select>
    <small class="field-help" id="launch-pair-help">Skip this to launch with SOL. Pick a token for your coin to trade against it on pump.fun.</small>
    <p class="launch-pair-status" role="status" data-pair-status></p>`;
  anchor.after(field);
  const select = field.querySelector('select'), status = field.querySelector('[data-pair-status]');
  // The pair is read at launch; Continue keeps its normal two-step flow.
  select.addEventListener('change', () => { status.textContent = ''; });
}
