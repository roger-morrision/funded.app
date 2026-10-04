import { Buffer } from 'buffer';
import { APP_JACKPOT_ENABLED } from './app-config.js';

globalThis.Buffer ??= Buffer;
globalThis.global ??= globalThis;

await import('./app.js');
await import('./page-experience.js');
await import('./creator-support-ui.js');
await import('./adoption-ui.js');
await import('./automatic-rewards-ui.js');
await import('./personal-rewards-ui.js');
await import('./workspace-ui.js');
await import('./reward-experience-ui.js');
if (APP_JACKPOT_ENABLED) await import('./jackpot-ui.js');
await import('./retention-ux.js');
await import('./pilot-metrics.js');


await import('./service-status-ui.js');
