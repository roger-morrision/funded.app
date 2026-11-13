import { mountMetricMotion } from './metric-motion.js';
import { mountGetStarted } from './get-started.js';
import { mountCompactExploreControls } from '../explore/compact-controls.js';
import { mountProfileLayout } from '../workspace/profile-layout.js';
import { mountTop100ColumnsWhenReady } from '../explore/top100-columns.js';
import { mountGrowthFeatures } from '../growth/index.js';
import { mountMetricAccents } from './metric-accents.js';
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
import {initializeAccountPreferences} from '../account/preferences.js';
import { initializeCreatorWalletFacts } from './creator-wallet-facts.js';
import { initializePortfolioFocus } from '../portfolio/focus-visibility.js';
import { mountSettingsDisclosures } from './settings-disclosures.js';
import { renderProofStrip } from '../proof/proof-totals.js';
import { mountHolderRewardsCard } from '../coin/holder-rewards-card.js';
import { mountBonusCountdown } from '../leaderboard/bonus-countdown.js';
import { mountCallouts } from '../callouts/callouts.js';
import { mountHomeCommunity } from '../home/community-panel.js';
import { mountCalloutIntent } from '../callouts/composer-intent.js';
import { mountRewardGuidance } from './reward-guidance.js';
import { mountCoinJourney } from './coin-journey.js';
import { mountFlowDiagnostics } from './flow-timing.js';
import { mountJourneySupport } from './journey-support.js';
import { mountExploreReturn } from '../explore/return-position.js';

export function initializeProductFlows(app) {
  initializeLaunchFacts(app);
  // Optional workspace modules move existing nodes after core app startup.
  // Compose enhancements only after those owners have finished creating their surfaces.
  const mount = () => {
    if (!document.body.classList.contains('workspace-ready') || !document.body.classList.contains('product-experience-ready')) return false;
    initializeDiscoveryIntent(app);
    void import('../launch/launch-pair-field.js').then(module => module.mountLaunchPairField(app)).catch(() => {});
    initializeFinancialCenter(app);
    initializeAccountPreferences(app);
    initializeCreatorActivity(app);
    initializeRetentionEvents();
    initializeRecoveryInbox(app);
    initializeReceiptInspector(app);
    initializeOperationsView(app);
    initializeIssuesView(app);
    initializeActivityUpdates(app);
    initializeNotificationPreferences();
    initializeTradePreferences(app);
    initializeCreatorWalletFacts(app);
    initializePortfolioFocus();
    mountSettingsDisclosures();
    mountProofStrip(app);
    mountHolderRewardsCard(app);
    mountBonusCountdown(app);
    mountCallouts(app);
    mountHomeCommunity(app);
    mountCalloutIntent(app);
    mountRewardGuidance(app);
    mountCoinJourney(app);
    mountFlowDiagnostics();
    mountJourneySupport();
    mountExploreReturn();
    mountGetStarted(app);
    mountCompactExploreControls();
    mountProfileLayout();
    mountTop100ColumnsWhenReady();
    mountGrowthFeatures(app);
    mountMetricAccents();
    mountMetricMotion();
    document.body.classList.add('product-flows-ready');
    window.dispatchEvent(new Event('funded:layout-change'));
    return true;
  };
  if (mount()) return;
  const observer = new MutationObserver(() => { if (mount()) observer.disconnect(); });
  observer.observe(document.body, { attributes:true, attributeFilter:['class'] });
}

// Analytics "Paid out so far" strip, redrawn whenever the summary reloads.
function mountProofStrip(app) {
  const render = () => renderProofStrip(app);
  document.addEventListener('funded:analytics-summary', render);
  render();
}
