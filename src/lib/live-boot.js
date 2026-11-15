import { installLiveCache } from './live-cache.js';
import { startLiveSocket } from './live-socket.js';

// Imported first by bootstrap-entry.js so the live cache is in place before any
// page module issues its startup reads. Disabled with ?live=0 for comparison.
const disabled = new URLSearchParams(globalThis.location?.search || '').get('live') === '0';
if (!disabled) {
  installLiveCache();
  startLiveSocket();
}
