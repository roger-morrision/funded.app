import { Buffer } from 'buffer';

globalThis.Buffer ??= Buffer;
globalThis.global ??= globalThis;

await import('./app.js');
await import('./page-experience.js');
await import('./creator-support-ui.js');
await import('./adoption-ui.js');
await import('./data-label-sanitizer.js');
await import('./automatic-rewards-ui.js');
