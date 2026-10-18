import { Buffer } from 'buffer';
import { mountLaunchReviewDialog } from './launch-review-markup.js';
import { mountFeeFlowCalculator } from './src/features/fees/fee-flow-markup.js';

// Initialize Node-compatible globals before loading modules that evaluate Solana SDK code.
globalThis.Buffer ??= Buffer;
globalThis.global ??= globalThis;
mountLaunchReviewDialog();
mountFeeFlowCalculator();

try {
  await import('./bootstrap.js');
} catch (error) {
  document.documentElement.dataset.bootstrapEntryFailed = 'true';
  document.dispatchEvent(new Event('funded:bootstrap-failed'));
  throw error;
}
