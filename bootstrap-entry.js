import { Buffer } from 'buffer';
import { mountLaunchReviewDialog } from './launch-review-markup.js';

// Initialize Node-compatible globals before loading modules that evaluate Solana SDK code.
globalThis.Buffer ??= Buffer;
globalThis.global ??= globalThis;
mountLaunchReviewDialog();

try {
  await import('./bootstrap.js');
} catch (error) {
  document.documentElement.dataset.bootstrapEntryFailed = 'true';
  document.dispatchEvent(new Event('funded:bootstrap-failed'));
  throw error;
}
