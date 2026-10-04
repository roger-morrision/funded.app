import { apiRequest } from './client.js';

const section = document.createElement('section');
section.className = 'adoption-panel';
section.id = 'service-status';
section.innerHTML = '<h2>Service status</h2><p>Check storage and the active Solana network. Individual rewards and claims need their own verified receipts.</p><button type="button">Check service status</button><p role="status" aria-live="polite">Status loads when requested.</p>';
document.querySelector('#docs')?.append(section);
const button = section.querySelector('button');
const status = section.querySelector('[role=status]');
button.onclick = async () => {
  button.disabled = true; status.textContent = 'Checking service status…';
  try {
    const result = await apiRequest('/api/status', { signal: AbortSignal.timeout(8000) });
    if (!result.available || !Array.isArray(result.data?.checks)) throw new Error('Unavailable');
    const data = result.data;
    status.textContent = `${data.cluster}: ${data.status}. ${data.checks.map(check => `${check.id}: ${check.status}`).join(' · ')}. Checked ${new Date(data.observedAt).toLocaleString()}.`;
  } catch { status.textContent = 'Service status is unavailable. Please retry shortly.'; }
  finally { button.disabled = false; }
};
