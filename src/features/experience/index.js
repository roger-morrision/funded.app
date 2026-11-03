import { initializeDiscoveryIntent } from './discovery-intent.js';
import { initializeFinancialCenter } from './financial-center.js';
import { initializeCreatorActivity } from './creator-activity.js';
import { initializeLaunchFacts } from './launch-facts.js';
import { initializeRetentionEvents } from './retention-events.js';
import { initializeRecoveryInbox } from './recovery-inbox.js';
import { initializeReceiptInspector } from './receipt-inspector.js';
import { initializeOperationsView } from './operations-view.js';
import { initializeIssuesView } from './issues-view.js';
import { initializeActivityUpdates } from './activity-updates.js';
import { initializeNotificationPreferences } from './notification-preferences.js';
import { initializeTradePreferences } from './trade-preferences.js';
import { initializePreferenceTransfer } from './preference-transfer.js';
import { initializeCreatorWalletFacts } from './creator-wallet-facts.js';
import { initializePortfolioFocus } from '../portfolio/focus-visibility.js';
import { mountSettingsDisclosures } from './settings-disclosures.js';
import { renderYourHome } from '../home/your-home.js';

export function initializeProductFlows(app) {
  initializeLaunchFacts(app);
  // Optional workspace modules move existing nodes after core app startup.
  // Compose enhancements only after those owners have finished creating their surfaces.
  const mount = () => {
    if (!document.body.classList.contains('workspace-ready') || !document.body.classList.contains('product-experience-ready')) return false;
    initializeDiscoveryIntent(app);
    initializeFinancialCenter(app);
    initializeCreatorActivity(app);
    initializeRetentionEvents();
    initializeRecoveryInbox(app);
    initializeReceiptInspector(app);
    initializeOperationsView(app);
    initializeIssuesView(app);
    initializeActivityUpdates(app);
    initializeNotificationPreferences();
    initializeTradePreferences(app);
    initializePreferenceTransfer(app);
    initializeCreatorWalletFacts(app);
    initializePortfolioFocus();
    mountSettingsDisclosures();
    mountYourHome(app);
    document.body.classList.add('product-flows-ready');
    window.dispatchEvent(new Event('funded:layout-change'));
    return true;
  };
  if (mount()) return;
  const observer = new MutationObserver(() => { if (mount()) observer.disconnect(); });
  observer.observe(document.body, { attributes:true, attributeFilter:['class'] });
}

// Redraw the connected wallet's Home panel when the data it summarizes
// (launch feed, holdings, wallet) changes.
function mountYourHome(app) {
  const render = () => renderYourHome(app);
  document.addEventListener('funded:verified-search-index', render);
  document.addEventListener('funded:portfolio-holdings', render);
  window.addEventListener('funded:reward-identity-change', render);
  render();
}
