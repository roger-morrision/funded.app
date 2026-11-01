import {sharedFeeAllocationCopy} from '../fees/fee-policy-copy.js';
// Presets fill the existing signed policy controls; they never alter saved launches.
export function initializeLaunchPresets(app) {
  const grid = document.querySelector('.launch-profile-grid');
  if (!grid) return;
  const fast = grid.querySelector('[data-launch-profile="fast"]');
  const custom = grid.querySelector('[data-launch-profile="community"]');
  fast.querySelector('strong').textContent = 'Creator income';
  custom.querySelector('strong').textContent = 'Custom';
  const holder = document.createElement('button');
  holder.type = 'button'; holder.className = 'launch-profile-card';
  holder.dataset.launchPreset = 'holder'; holder.setAttribute('aria-pressed', 'false');
  holder.innerHTML = '<span>HOLDER REWARDS</span><strong>Reward your holders</strong><p>Split your creator-directed share equally between your wallet and eligible holders. App Operations &amp; marketing and reward budgets are listed separately. X stays optional.</p><b>Hourly eligibility and funding rules apply</b>';
  fast.after(holder);
  const summary = document.createElement('p'); summary.id = 'launch-preset-summary';
  summary.className = 'flow-note'; summary.setAttribute('aria-live', 'polite'); grid.after(summary);
  const fields = ['creator-wallet-share', 'holder-airdrop-share', 'x-share'];
  let selected = app.launchMode === 'quick' ? 'creator' : 'custom';
  function sync() {
    const [creator, holders, x] = fields.map(id => Number(document.getElementById(id)?.value || 0));
    summary.textContent = `Creator fees: ${creator}% creator wallet · ${holders}% eligible holders · ${x}% X recipient · ${sharedFeeAllocationCopy()}. Launch costs are shown before signing.`;
    const preset = app.launchMode === 'quick' ? 'creator' : selected === 'holder' && creator === 40 && holders === 40 && x === 0 ? 'holder' : 'custom';
    selected = preset;
    for (const [button, key] of [[fast, 'creator'], [holder, 'holder'], [custom, 'custom']]) {
      button.classList.toggle('active', preset === key); button.setAttribute('aria-pressed', String(preset === key));
    }
  }
  holder.addEventListener('click', () => {
    selected = 'holder';
    app.setLaunchMode('custom');
    fields.forEach((id, i) => { document.getElementById(id).value = [40, 40, 0][i]; });
    document.getElementById('x-recipient').value = '';
    app.updateLaunchPolicyControls(); app.updateLaunchPreview(); sync();
  });
  fast.addEventListener('click', () => { selected = 'creator'; app.setLaunchMode('quick'); sync(); });
  custom.addEventListener('click', () => { selected = 'custom'; app.setLaunchMode('custom'); sync(); });
  document.querySelector('#launch-mode-custom')?.addEventListener('click', () => { selected = 'custom'; sync(); });
  document.querySelector('#launch-form')?.addEventListener('input', sync);
  document.querySelector('#launch-form')?.addEventListener('click', () => queueMicrotask(sync));
  window.addEventListener('funded:launch-step', sync); sync();
}
