import { Buffer } from 'buffer';

// Initialize Node-compatible globals before loading modules that evaluate Solana SDK code.
globalThis.Buffer ??= Buffer;
globalThis.global ??= globalThis;

await import('./bootstrap.js');
