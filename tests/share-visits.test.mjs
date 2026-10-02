import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanShareSource, pruneShareVisits, recordShareVisit, summarizeShareVisits } from '../server/share-visits.mjs';

const code = 'ABCD1234';
const visitorA = '11111111-1111-4111-8111-111111111111';
const visitorB = '22222222-2222-4222-8222-222222222222';
const day = Date.parse('2026-10-01T12:00:00Z');

test('counts consented browser days without double counting a refresh', () => {
  const visits = {};
  recordShareVisit(visits, { code, visitorId:visitorA, source:'x', now:day });
  recordShareVisit(visits, { code, visitorId:visitorA, source:'telegram', now:day });
  recordShareVisit(visits, { code, visitorId:visitorB, source:'telegram', now:day });
  recordShareVisit(visits, { code, visitorId:visitorA, source:'direct', now:day + 86_400_000 });
  assert.deepEqual(summarizeShareVisits(visits, code, day + 86_400_000), { consentedVisitDays:3, consentedBrowsers:2,
    returningBrowsers:1, byChannel:{ x:1, telegram:1, direct:1 }, windowDays:30 });
  assert.equal(JSON.stringify(visits).includes(visitorA), false);
});

test('rejects malformed identifiers and expires old visit days', () => {
  const visits = {};
  assert.throws(() => recordShareVisit(visits, { code, visitorId:'bad', now:day }));
  recordShareVisit(visits, { code, visitorId:visitorA, now:day });
  recordShareVisit(visits, { code, visitorId:visitorA, now:day + 32 * 86_400_000 });
  assert.equal(summarizeShareVisits(visits, code, day + 32 * 86_400_000).consentedVisitDays, 1);
  assert.equal(cleanShareSource('<script>'), 'direct');
});

test('maintenance removes stale identifiers even without a new visit', () => {
  const visits = {};
  recordShareVisit(visits, { code, visitorId:visitorA, now:day });
  assert.equal(pruneShareVisits(visits, day + 32 * 86_400_000), 1);
  assert.deepEqual(visits, {});
});
