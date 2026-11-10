// Growth features: each mount returns true once its host exists. Pages render at
// different times, so unfinished mounts retry on DOM changes for up to 30 seconds.
import {mountProjectUpdates} from '../coin/project-updates.js';
import { mountEarningsHub } from './earnings-hub.js';
import { mountLaunchAssist } from './launch-assist.js';
import { mountReferralKit, mountInvitedBanner } from './referral-kit.js';
import { mountTradeSummary } from './trade-summary.js';
import { mountAlerts } from './alerts.js';
import { mountPayoutChart, mountCreatorPanel } from './insights.js';
import { mountCommandActions } from './command-actions.js';
import { mountSkeletons } from './skeletons.js';

export function mountGrowthFeatures(app, document = globalThis.document) {
  mountInvitedBanner(document);
  const pending = new Map([
    ['project-updates', () => mountProjectUpdates(app, document)],
    ['earnings', () => mountEarningsHub(app, document)],
    ['launch', () => mountLaunchAssist(document)],
    ['referral', () => mountReferralKit(document)],
    ['trade', () => mountTradeSummary(document)],
    ['alerts', () => mountAlerts(app, document)],
    ['chart', () => mountPayoutChart(document)],
    ['creator', () => mountCreatorPanel(app, document)],
    ['command', () => mountCommandActions(document)],
    ['skeletons', () => mountSkeletons(document)],
  ]);
  const run = () => {
    for (const [name, mount] of pending) {
      try { if (mount()) pending.delete(name); }
      catch (error) { pending.delete(name); console.warn(`Growth feature "${name}" failed to mount`, error); }
    }
    return pending.size === 0;
  };
  if (run()) return;
  let frame = 0;
  const observer = new MutationObserver(() => {
    if (frame) return;
    frame = requestAnimationFrame(() => { frame = 0; if (run()) observer.disconnect(); });
  });
  observer.observe(document.body, { childList: true, subtree: true });
  setTimeout(() => observer.disconnect(), 30_000);
}
