import { installRouteFeatures } from '../../lib/route-features.js';
import { mountMetricMotion } from './metric-motion.js';
import { mountGetStarted } from './get-started.js';
import { mountCompactExploreControls } from '../explore/compact-controls.js';
import { mountProfileLayout } from '../workspace/profile-layout.js';
import { mountGrowthFeatures } from '../growth/index.js';
import { mountMetricAccents } from './metric-accents.js';
import { initializeDiscoveryIntent } from './discovery-intent.js';
import { initializeCreatorActivity } from './creator-activity.js';
import { initializeLaunchFacts } from './launch-facts.js';
import { initializeRetentionEvents } from './retention-events.js';




import { initializeActivityUpdates } from './activity-updates.js';
import { initializeNotificationPreferences } from './notification-preferences.js';
import { initializeTradePreferences } from './trade-preferences.js';
import {initializeAccountPreferences} from '../account/preferences.js';

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
    initializeCreatorActivity(app);
    void import('../launch/launch-pair-field.js').then(module => module.mountLaunchPairField(app)).catch(() => {});
    void import('../launch/test-lock-period.js').then(module => module.offerTestLockPeriod(app)).catch(() => {});

    initializeAccountPreferences(app);

    initializeRetentionEvents();




    initializeActivityUpdates(app);
    initializeNotificationPreferences();
    initializeTradePreferences(app);

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
    mountGrowthFeatures(app);
    mountMetricAccents();
    mountMetricMotion();
    installRouteFeatures([
      { name:'Financial activity', matches:/#(?:payments|analytics|profile)/, load:async () => {
        const [financial,operations] = await Promise.all([import('./financial-center.js'),import('./operations-view.js')]);
        financial.initializeFinancialCenter(app); operations.initializeOperationsView(app);
      } },
      { name:'initializeRecoveryInbox', matches:/#(?:profile|my-launches|payments)|\/creator\//, load:() => import('./recovery-inbox.js').then(module => module.initializeRecoveryInbox(app)) },
      { name:'initializeReceiptInspector', matches:/#(?:payments|analytics)|[?&]receipt=/, load:() => import('./receipt-inspector.js').then(module => module.initializeReceiptInspector(app)) },
      { name:'initializeIssuesView', matches:/#(?:profile|status|creators)|\/creator\//, load:() => import('./issues-view.js').then(module => module.initializeIssuesView(app)) },
      { name:'initializeCreatorWalletFacts', matches:/#(?:my-launches|wallet)|\/wallet\//, load:() => import('./creator-wallet-facts.js').then(module => module.initializeCreatorWalletFacts(app)) },
    ]);
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
