// Must stay the first import: startup reads below are answered by the live cache.
import './src/lib/live-boot.js';
import { mountHomeStart } from './src/features/home/start-markup.js';
import { mountHomeDiscovery } from './src/features/home/discovery-controls.js';
import { Buffer } from 'buffer';
import { mountLaunchReviewDialog } from './launch-review-markup.js';
import { mountCapitalFlowDiagram } from './src/features/fees/capital-flow-markup.js';
import { initializeFlowDiagrams } from './src/features/shared/diagram-motion.js';
import { mountCalloutsPage } from './src/features/callouts/page-markup.js';
import { mountNetworkDisclosure } from './src/features/shared/network-disclosure.js';
import './styles/network-disclosure.css';
import './styles/trade-review-menu.css';

// Initialize Node-compatible globals before loading modules that evaluate Solana SDK code.
globalThis.Buffer ??= Buffer;
globalThis.global ??= globalThis;
mountNetworkDisclosure({ cluster: String(import.meta.env.VITE_SOLANA_CLUSTER || 'devnet'),
  readOnly: [import.meta.env.VITE_MAINNET_READ_ONLY,import.meta.env.VITE_READ_ONLY_PREVIEW].some(value => String(value).toLowerCase() === 'true') });
mountHomeStart();
mountHomeDiscovery();
mountLaunchReviewDialog();
mountCalloutsPage();
mountCapitalFlowDiagram();
initializeFlowDiagrams();

try {
  await import('./bootstrap.js');
} catch (error) {
  document.documentElement.dataset.bootstrapEntryFailed = 'true';
  document.dispatchEvent(new Event('funded:bootstrap-failed'));
  throw error;
}
