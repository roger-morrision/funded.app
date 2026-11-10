import test from 'node:test';
import assert from 'node:assert/strict';
import { standing } from '../src/features/growth/bonus-rank-card.js';
import { matchActions, ACTIONS } from '../src/features/growth/command-actions.js';
import { dailyPayouts } from '../src/features/growth/insights.js';
import { holderPoolShare } from '../src/features/growth/token-extras.js';
import { isPlaceholder } from '../src/features/growth/skeletons.js';
import { PRESETS } from '../src/features/growth/launch-assist.js';
import { sol, countdown, nextUtcHour, nextUtcMidnight } from '../src/features/growth/format.js';

const rows = [1, 2, 3, 4, 5].map(rank => ({ rank, wallet: `W${rank}`, scoreLamports: String((6 - rank) * 1_000_000_000) }));

test('bonus standing reports prize places and the gap to #3', () => {
  assert.deepEqual(standing(rows, 'W2'), { state: 'winning', rank: 2, score: 4_000_000_000n });
  assert.deepEqual(standing(rows, 'W5'), { state: 'chasing', rank: 5, gap: 2_000_000_001n });
  assert.deepEqual(standing(rows, 'nobody'), { state: 'chasing', rank: null, gap: 3_000_000_001n });
  assert.equal(standing(rows.slice(0, 2), 'nobody').state, 'open');
  assert.equal(standing(null, 'W1').state, 'unavailable');
});

test('command actions match every word and point to app routes', () => {
  assert.deepEqual(matchActions('claim x').map(([title]) => title), ['Claim X account rewards']);
  assert.equal(matchActions('').length, 0);
  for (const [, href] of ACTIONS) assert.match(href, /^#[a-z0-9/-]+$/);
});

test('daily payouts bucket verified receipts by UTC day and source, once each', () => {
  const now = Date.UTC(2026, 10, 10, 12);
  const day = Date.UTC(2026, 10, 10, 1) / 1000;
  const buckets = dailyPayouts([
    { signature: 's1', to: 'a', source: 'automatic-holder', actualReceivedLamports: '5', blockTime: day },
    { signature: 's1', to: 'a', source: 'automatic-holder', actualReceivedLamports: '5', blockTime: day },
    { signature: 's2', to: 'b', source: 'daily-bonus', actualReceivedLamports: '7', blockTime: day },
    { signature: 's3', to: 'c', source: 'x-claim', actualReceivedLamports: '1', blockTime: day },
    { signature: 's4', to: 'd', source: 'daily-bonus', actualReceivedLamports: 'bad', blockTime: day },
  ], 3, now);
  assert.equal(buckets.length, 3);
  assert.deepEqual([buckets[2].holders, buckets[2].bonus, buckets[2].other], [5n, 7n, 1n]);
});

test('holder share calculator and helpers', () => {
  assert.equal(holderPoolShare(1_000_000, 1_000_000_000), 0.1);
  assert.equal(holderPoolShare(0, 100), null);
  assert.equal(holderPoolShare('x', 100), null);
  assert.equal(isPlaceholder('Checking…'), true);
  assert.equal(isPlaceholder('Checking daily snapshots…'), true);
  assert.equal(isPlaceholder('0.5 SOL'), false);
  assert.equal(sol('1500000000'), '1.5 SOL');
  assert.equal(sol('nope'), '—');
  assert.equal(countdown(Date.UTC(2026, 0, 1, 2, 30), Date.UTC(2026, 0, 1)), '2h 30m');
  assert.equal(nextUtcHour(Date.UTC(2026, 0, 1, 5, 10)), Date.UTC(2026, 0, 1, 6));
  assert.equal(nextUtcMidnight(Date.UTC(2026, 0, 1, 5)), Date.UTC(2026, 0, 2));
});

test('fee split presets always total the fixed 80% creator-directed share', () => {
  for (const [, , shares] of PRESETS) assert.equal(shares.reduce((a, b) => a + b, 0), 80);
});
