import { Buffer } from 'buffer';
import { APP_JACKPOT_ENABLED } from './app-config.js';
import { loadBootstrapModules } from './bootstrap-loader.js';
import { appReady, appFailed, optionalFeatureFailed } from './bootstrap-gate.js';

globalThis.Buffer ??= Buffer;
globalThis.global ??= globalThis;

await loadBootstrapModules([
  { name: 'App', required: true, load: async () => { await import('./app.js'); appReady(); } },
  { name: 'Page layout', load: () => import('./page-experience.js') },
  { name: 'Creator support', load: () => import('./creator-support-ui.js') },
  { name: 'Following', load: () => import('./adoption-ui.js') },
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
  if (required) appFailed();
  else optionalFeatureFailed();
});
