import assert from 'node:assert/strict';
import { summarizePilot } from '../pilot-metrics-model.js';

const day = 86_400_000;
const start = Date.parse('2026-09-01T00:00:00Z');
const at = (offset, hour = 12) => new Date(start + offset * day + hour * 3_600_000).toISOString();
const participant = { participantId:'00000000-0000-4000-8000-000000000001', consented:true, source:'creator-invite',
  observedThrough:at(17),
  events:[{ name:'draft-started', at:at(0) }, { name:'draft-reviewed', at:at(0, 13) },
    { name:'follow-creator', at:at(1) }, { name:'followed-creator-view', at:at(8) },
    { name:'creator-update-published', at:at(1) }, { name:'creator-update-published', at:at(9) }] };
const pilot = summarizePilot([participant], start + 17 * day);
assert.equal(pilot.draftStarters, 1);
assert.equal(pilot.draftReviewed, 1);
assert.equal(pilot.d7Eligible, 1);
assert.equal(pilot.d7Returned, 0); // Activation was on day 0 at draft review; day 8 does not count.
assert.equal(pilot.creatorFollowThroughEligible, 1);
assert.equal(pilot.creatorSecondUpdate, 1);
assert.equal(summarizePilot([{...participant,observedThrough:at(9)}],start+17*day).creatorFollowThroughEligible,0,'An old export is not evidence of full follow-up.');
assert.equal(summarizePilot([participant], start + 7 * day).d7Eligible, 0);
assert.equal(summarizePilot([{ ...participant, source:'test' }], start + 17 * day).participants, 0);
assert.equal(summarizePilot([participant, participant], start + 17 * day).participants, 1);
const returned = { ...participant, events:[...participant.events, { name:'watched-coin-view', at:at(7) }] };
assert.equal(summarizePilot([returned], start + 17 * day).d7Returned, 1);
const jackpotVisitor = { ...participant, events:[
  { name:'jackpot-home-view', at:at(0) }, { name:'jackpot-open', at:at(0, 13) },
  { name:'jackpot-rewards-view', at:at(0, 14) }, { name:'jackpot-rules-view', at:at(0, 15) },
] };
const jackpotCounts = summarizePilot([jackpotVisitor], start + 17 * day);
assert.equal(jackpotCounts.jackpotHomeViewers, 1);
assert.equal(jackpotCounts.jackpotOpeners, 1);
assert.equal(jackpotCounts.jackpotRewardsViewers, 1);
assert.equal(jackpotCounts.jackpotRulesReaders, 1);
assert.equal(summarizePilot([{ ...jackpotVisitor, source:'test' }], start + 17 * day)
  .jackpotHomeViewers, 0);
console.log('Pilot metric denominators, day-7 windows, and jackpot discovery counts passed.');
