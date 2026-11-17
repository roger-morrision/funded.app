import { exactSolLamports } from './exact-sol-units.js';

// Admin-editable app limits (server/app-limits.mjs). Saving asks for the
// emailed OTP through the shared confirmed admin post.
const LAMPORTS = 1_000_000_000n;
const solText = value => {
  const lamports = BigInt(value), whole = lamports / LAMPORTS, rest = lamports % LAMPORTS;
  return rest ? `${whole}.${String(rest).padStart(9, '0').replace(/0+$/, '')}` : String(whole);
};
const escape = text => String(text).replace(/[&<>"]/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[char]));
const NEVER = String(Number.MAX_SAFE_INTEGER);

export function initAdminAppLimits({ api, post, show }) {
  const workspace = document.getElementById('workspace'); if (!workspace) return;
  const panel = document.createElement('section'); panel.className = 'panel';
  panel.innerHTML = `<h2>App limits</h2><p>Limits the app enforces for admin withdrawals and outflow alerts. Saving needs the code emailed to the admin address. Program custody rules do not change here.</p><p data-limits-status>Sign in to load current limits.</p><form id="app-limits-form"><div class="fee-fields" data-limits-fields></div><label>Audit reason<input name="reason" minlength="10" maxlength="500" required></label><div class="actions"><button type="button" data-limits-load>Refresh limits</button><button type="submit" disabled>Review and save limits</button></div></form>`;
  workspace.prepend(panel);
  const form = panel.querySelector('form'), fields = panel.querySelector('[data-limits-fields]');
  const submit = form.querySelector('[type=submit]'), refresh = panel.querySelector('[data-limits-load]');
  const status = panel.querySelector('[data-limits-status]');
  let snapshot = null, generation = 0, saving = false;

  function render(next) {
    fields.innerHTML = next.limits.map(row => {
      const unit = row.unit === 'sol' ? 'SOL' : 'seconds';
      const value = row.optional && row.value === NEVER ? '' : row.unit === 'sol' ? solText(row.value) : row.value;
      return `<label>${escape(row.group)} · ${escape(row.label)} (${unit}, ${escape(row.source)})<input name="${escape(row.key)}" type="number" min="0" step="${row.unit === 'sol' ? '0.000000001' : '1'}" value="${escape(value)}" ${row.optional ? '' : 'required'}></label>`;
    }).join('');
  }
  async function load(afterSave = false) {
    if (saving && !afterSave) return false;
    const request = ++generation; snapshot = null; submit.disabled = true;
    try {
      const next = await api('/api/admin/app-limits');
      if (request !== generation || workspace.hidden) return false;
      snapshot = next; render(next);
      status.textContent = `Revision ${next.revision}${next.updatedAt ? ` · saved ${next.updatedAt}` : ''}`;
      submit.disabled = false; return true;
    } catch (error) {
      if (request !== generation || workspace.hidden) return false;
      status.textContent = 'App limits unavailable. Sign in, then refresh.'; show(error.message, true); return false;
    }
  }
  function changes() {
    const values = {}, lines = [];
    for (const row of snapshot.limits) {
      const raw = form.elements.namedItem(row.key).value.trim();
      let next;
      if (raw === '') { if (!row.optional) throw new Error(`${row.label} is required.`); next = NEVER; }
      else next = row.unit === 'sol' ? String(exactSolLamports(raw)) : String(Number(raw));
      if (row.unit === 'seconds' && !/^\d+$/.test(next)) throw new Error(`${row.label} must be whole seconds.`);
      if (next === row.value) continue;
      values[row.key] = Number(next);
      const show = value => row.optional && value === NEVER ? 'never' : row.unit === 'sol' ? `${solText(value)} SOL` : `${value} s`;
      lines.push(`${row.label}: ${show(row.value)} → ${show(next)}`);
    }
    return { values, lines };
  }
  refresh.addEventListener('click', () => { void load(); });
  form.addEventListener('submit', async event => {
    event.preventDefault(); if (!snapshot || saving || workspace.hidden) return;
    try {
      const { values, lines } = changes();
      if (!lines.length) { show('No limit changed.', false); return; }
      if (!confirm(`Save these app limits?\n${lines.join('\n')}`)) return;
      saving = true; submit.disabled = refresh.disabled = true;
      await post('/api/admin/app-limits', { values, expectedRevision:snapshot.revision, reason:form.elements.namedItem('reason').value });
      const loaded = await load(true);
      show(loaded ? 'App limits saved.' : 'App limits saved. Refresh to load them.', !loaded);
    } catch (error) {
      show(error.message, true);
    } finally { saving = false; refresh.disabled = false; submit.disabled = !snapshot; }
  });
  new MutationObserver(() => {
    if (workspace.hidden) { generation++; snapshot = null; fields.innerHTML = ''; submit.disabled = true; status.textContent = 'Sign in to load current limits.'; }
    else if (!snapshot) void load();
  }).observe(workspace, { attributes:true, attributeFilter:['hidden'] });
  if (!workspace.hidden) void load();
}
