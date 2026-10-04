import { Buffer } from 'buffer';
import { APP_JACKPOT_ENABLED } from './app-config.js';
import { loadBootstrapModules } from './bootstrap-loader.js';

globalThis.Buffer ??= Buffer;
globalThis.global ??= globalThis;

await loadBootstrapModules([
  { name: 'App', required: true, load: () => import('./app.js') },
  { name: 'Page layout', load: () => import('./page-experience.js') },
  { name: 'Creator support', load: () => import('./creator-support-ui.js') },
  { name: 'Following and drafts', load: () => import('./adoption-ui.js') },
  { name: 'Reward schedules', load: () => import('./automatic-rewards-ui.js') },
  { name: 'Personal rewards', load: () => import('./personal-rewards-ui.js') },
  { name: 'Workspace layout', load: () => import('./workspace-ui.js') },
  { name: 'Reward history', load: () => import('./reward-experience-ui.js') },
  ...(APP_JACKPOT_ENABLED ? [{ name: 'Jackpot', load: () => import('./jackpot-ui.js') }] : []),
  { name: 'Saved preferences', load: () => import('./retention-ux.js') },
  { name: 'Creator community pilot', load: () => import('./creator-pilot.js') },
  { name: 'Device diagnostics', load: () => import('./pilot-metrics.js') },
  { name: 'Service status', load: () => import('./service-status-ui.js') },
], ({ name, required, error }) => {
  console.error(`Could not initialize ${name}:`, error);
  let banner = document.getElementById('bootstrap-status');
  if (!banner) {
    banner = document.createElement('aside');
    banner.id = 'bootstrap-status';
    banner.className = 'source-note';
    banner.setAttribute('role', 'status');
    const message = document.createElement('p');
    message.dataset.bootstrapMessage = '';
    const reload = document.createElement('button');
    reload.type = 'button'; reload.className = 'secondary-button'; reload.textContent = 'Reload app';
    reload.addEventListener('click', () => location.reload());
    banner.append(message, reload);
    document.body.prepend(banner);
  }
  banner.querySelector('[data-bootstrap-message]').textContent = required
    ? 'The app could not finish loading. Reload to try again.'
    : 'Some features could not load. Reload to restore them.';
});
