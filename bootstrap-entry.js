import { Buffer } from 'buffer';
import { mountLaunchReviewDialog } from './launch-review-markup.js';
import { mountFeeFlowCalculator } from './src/features/fees/fee-flow-markup.js';
import { mountCapitalFlowDiagram } from './src/features/fees/capital-flow-markup.js';
import { initializeFlowDiagrams } from './src/features/shared/diagram-motion.js';
import { mountCalloutsPage } from './src/features/callouts/page-markup.js';

// Initialize Node-compatible globals before loading modules that evaluate Solana SDK code.
globalThis.Buffer ??= Buffer;
globalThis.global ??= globalThis;
mountLaunchReviewDialog();
mountCalloutsPage();
mountFeeFlowCalculator();
mountCapitalFlowDiagram();
initializeFlowDiagrams();

try {
  await import('./bootstrap.js');
} catch (error) {
  document.documentElement.dataset.bootstrapEntryFailed = 'true';
  document.dispatchEvent(new Event('funded:bootstrap-failed'));
  throw error;
}
