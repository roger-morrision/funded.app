import { Buffer } from 'buffer';
import { APP_JACKPOT_ENABLED } from './app-config.js';
import { loadBootstrapModules } from './bootstrap-loader.js';
import { appReady, appFailed, optionalFeatureFailed } from './bootstrap-gate.js';
import { setActiveProtocolFeeSplit } from './distribution-policy.js';
import { installRouteFeatures } from './src/lib/route-features.js';

globalThis.Buffer ??= Buffer;
globalThis.global ??= globalThis;

await loadBootstrapModules([
  { name: 'App', required: true, load: async () => {
    try {
      const response = await fetch('/api/fee-policy', { credentials:'same-origin', cache:'no-store', signal:AbortSignal.timeout(15_000) });
      if (!response.ok) throw new Error('The current fee policy is unavailable.');
      // Revision 0 is the unpublished file fallback; keep the approved split shown on Home.
      const policy = await response.json();
      if (Number(policy?.revision) > 0) setActiveProtocolFeeSplit(policy.split);
      window.dispatchEvent(new Event('funded:fee-policy-ready'));
    } catch (error) { if (!import.meta.env.DEV) throw error; }
    await import('./app.js'); appReady();
  } },
  { name: 'Page layout', load: () => import('./page-experience.js') },
  { name: 'Following', load: () => import('./adoption-ui.js') },
  { name: 'Workspace layout', load: () => import('./workspace-ui.js') },
  { name: 'Saved preferences', load: () => import('./retention-ux.js') },
  { name: 'Anonymous usage preferences', load: () => import('./product-measurement.js') },
  { name: 'Product experience', load: () => import('./product-experience.js') },
], ({ name, required, error }) => {
  console.error(`Could not initialize ${name}:`, error);
  if (required) appFailed();
  else optionalFeatureFailed();
});
installRouteFeatures([
  { name:'Creator support', matches:/\/creator\/|#(?:creators|creator|profile|my-launches)/, load:() => import('./creator-support-ui.js') },
  { name:'Reward schedules', matches:/#(?:airdrops|payments|bonuses|paid)|\/rich/, load:() => import('./automatic-rewards-ui.js') },
  { name:'Personal rewards', matches:/#(?:airdrops|payments|bonuses|profile)/, load:() => import('./personal-rewards-ui.js') },
  { name:'Reward history', matches:/#(?:payments|analytics|bonuses|referrals)/, load:() => import('./reward-experience-ui.js') },
  ...(APP_JACKPOT_ENABLED ? [{name:'Jackpot', matches:/#jackpot/, load:() => import('./jackpot-ui.js')}] : []),
]);
try { localStorage.removeItem('funded.vip.pilot.v1'); } catch { /* Storage may be unavailable. */ }
