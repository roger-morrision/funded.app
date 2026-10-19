import { validateServiceFees, serviceFeeSol } from './service-fees.js';
export function initAdminServiceFees({ api, post, show }) {
  const workspace = document.getElementById('workspace'); if (!workspace) return;
  const panel = document.createElement('section'); panel.className = 'panel';
  panel.innerHTML = `<h2>App service fees</h2><p>These charges are separate from the 80/20 creator-fee distribution. New quotes use the saved prices; already issued quotes retain their price until expiry. Funded.vip launches include listing.</p><p data-service-revision>Sign in to load current prices.</p><form id="service-fee-form"><div class="fee-fields"><label>Trading fee · buys and sells (%)<input name="tradePercent" type="number" min="0" max="5" step="0.01" required></label><label>Launch service fee (SOL)<input name="launchSol" type="number" min="0" max="5" step="0.000000001" required></label><label>Pro promotion ($FUNDED burn · USD)<input name="proUsd" type="number" min="1" max="100000" step="1" required></label><label>Premier promotion ($FUNDED burn · USD)<input name="premierUsd" type="number" min="1" max="100000" step="1" required></label><label>External listing ($FUNDED burn · USD)<input name="listingUsd" type="number" min="1" max="100000" step="1" required></label></div><label>Audit reason<input name="reason" minlength="10" maxlength="500" required></label><div class="actions"><button type="button" data-service-load>Refresh fees</button><button type="submit" disabled>Review and save fees</button></div></form>`;
  workspace.prepend(panel);
  const form = panel.querySelector('form'), submit = form.querySelector('[type=submit]'); let snapshot;
  const field = name => form.elements.namedItem(name);
  async function load() {
    snapshot = null; submit.disabled = true;
    try {
      const next = await api('/api/admin/service-fees'); validateServiceFees(next.policy);
      snapshot = next;
      field('tradePercent').value = next.policy.tradeBps/100; field('launchSol').value = serviceFeeSol(next.policy.launchLamports);
      for (const key of ['proUsd','premierUsd','listingUsd']) field(key).value = next.policy[key];
      panel.querySelector('[data-service-revision]').textContent = `Revision ${next.revision} · applies to new quotes`;
      submit.disabled = false;
    } catch(error) { panel.querySelector('[data-service-revision]').textContent = 'Service fees unavailable. Sign in, then refresh.'; show(error.message,true); }
  }
  panel.querySelector('[data-service-load]').addEventListener('click', () => { void load(); });
  form.addEventListener('submit', async event => {
    event.preventDefault(); if (!snapshot) return;
    try {
      const bps = Number(field('tradePercent').value)*100, lamports = Number(field('launchSol').value)*1e9;
      if (Math.abs(bps-Math.round(bps)) > 1e-7 || Math.abs(lamports-Math.round(lamports)) > 1e-7) throw new Error('Use whole basis points and exact lamports.');
      const policy = validateServiceFees({ tradeBps:Math.round(bps), launchLamports:String(Math.round(lamports)),
        proUsd:Number(field('proUsd').value), premierUsd:Number(field('premierUsd').value), listingUsd:Number(field('listingUsd').value) });
      if (!confirm(`Save fees for NEW quotes?\nTrading: ${policy.tradeBps/100}% on buys and sells\nLaunch: ${serviceFeeSol(policy.launchLamports)} SOL\nPro: $${policy.proUsd} burn\nPremier: $${policy.premierUsd} burn\nExternal listing: $${policy.listingUsd} burn`)) return;
      submit.disabled = true;
      await post('/api/admin/service-fees',{ policy,expectedRevision:snapshot.revision,expectedHash:snapshot.hash,reason:field('reason').value });
      await load(); show('Service fees saved. New quotes use the new revision.');
    } catch(error) { show(error.message,true); submit.disabled = !snapshot; }
  });
  new MutationObserver(() => { if (!workspace.hidden && !snapshot) void load(); }).observe(workspace,{attributes:true,attributeFilter:['hidden']});
  if (!workspace.hidden) void load();
}
