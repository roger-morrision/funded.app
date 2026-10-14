import { Buffer } from 'buffer';

globalThis.Buffer ??= Buffer;
globalThis.global ??= globalThis;

await import('./admin-page.js');
