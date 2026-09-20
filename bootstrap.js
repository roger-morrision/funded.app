import { Buffer } from 'buffer';

globalThis.Buffer ??= Buffer;
globalThis.global ??= globalThis;

await import('./app.js');
await import('./page-experience.js');
