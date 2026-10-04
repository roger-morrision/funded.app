import { apiRequest } from './client.js';

const section = document.createElement('section');
section.className = 'adoption-panel service-status-panel';
section.id = 'service-status';
section.setAttribute('aria-labelledby', 'service-status-title');
section.innerHTML = '<h2 id="service-status-title">Service status</h2><p>Check whether saved records and the Solana network are reachable.</p><button type="button" class="secondary-button">Check service status</button><p role="status" aria-live="polite">Status loads when requested.</p><ul class="service-status-checks" hidden></ul><p class="service-status-checked" hidden></p><p class="service-status-scope">These checks cover storage and network access. For a payment or claim, check its transaction receipt in Rewards.</p><a href="#payments">Open Rewards →</a>';
document.querySelector('#docs')?.append(section);
const button = section.querySelector('button');
const status = section.querySelector('[role=status]');
const checks = section.querySelector('ul');
const checked = section.querySelector('.service-status-checked');
button.onclick = async () => {
  button.disabled = true; section.setAttribute('aria-busy', 'true'); status.textContent = 'Checking service status…';
  try {
    const result = await apiRequest('/api/status', { signal: AbortSignal.timeout(8000) });
    if (!result.available || !Array.isArray(result.data?.checks)) throw new Error('Unavailable');
    const data = result.data;
    const network = data.cluster === 'devnet' ? 'Solana Devnet' : data.cluster === 'mainnet-beta' ? 'Solana Mainnet' : 'Solana';
    status.textContent = data.status === 'operational' ? `${network}: storage and network are available.` : `${network}: some services need attention. Try again shortly.`;
    checks.replaceChildren();
    for (const check of data.checks) {
      const row = document.createElement('li');
      const label = document.createElement('strong');
      label.textContent = check.id === 'storage' ? 'Saved records' : check.id === 'network' ? 'Network connection' : 'Service';
      const state = document.createElement('span');
      state.textContent = check.status === 'operational' ? 'Available' : check.status === 'wrong-network' ? 'Network does not match this app' : 'Temporarily unavailable';
      row.dataset.status = check.status === 'operational' ? 'available' : 'unavailable';
      row.append(label, state); checks.append(row);
    }
    checks.hidden = false;
    const observed = new Date(data.observedAt);
    checked.textContent = Number.isNaN(observed.getTime()) ? 'Check time unavailable.' : `Checked ${observed.toLocaleString()}. Check again for the latest status.`;
    checked.hidden = false;
  } catch {
    status.textContent = 'Service status is unavailable. Check your connection and try again.';
    checks.hidden = true; checked.hidden = true;
  } finally { button.disabled = false; section.setAttribute('aria-busy', 'false'); }
};
