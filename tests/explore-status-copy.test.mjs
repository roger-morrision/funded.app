import test from 'node:test';
import assert from 'node:assert/strict';
import { exploreStatusText, exploreSourceLabel } from '../src/features/explore/status-copy.js';

test('Explore status uses plain words instead of RPC jargon', () => {
  assert.equal(exploreStatusText('On-chain only · loading'), 'Loading coins…');
  assert.equal(exploreStatusText('Solana RPC rate limited · retry shortly'), 'Network busy · retrying shortly');
  assert.equal(exploreStatusText('Solana RPC unavailable'), 'Live data unavailable right now');
  assert.equal(exploreStatusText('Launch feed unavailable'), 'Live data unavailable right now');
  assert.equal(exploreStatusText('Verified launch registry · live mint checks unavailable'), 'Coin checks unavailable right now');
  assert.equal(exploreStatusText('Solana RPC unavailable · last verified 4m ago · stale'), 'Showing coins from 4m ago');
  assert.equal(exploreStatusText('Solana RPC rate limited · last verified 2h ago · stale'), 'Network busy · showing coins from 2h ago');
  assert.equal(exploreStatusText('Launch feed unavailable · last verified freshness unavailable · stale'), 'Showing last saved coins');
  for (const status of ['Solana RPC rate limited · retry shortly', 'RPC unavailable · last verified snapshot · stale']) {
    assert.doesNotMatch(exploreStatusText(status), /RPC|registry|verif/i);
  }
});

test('Explore source label avoids technical terms', () => {
  assert.equal(exploreSourceLabel('Verified launch registry · 3/10 live mint checks'), 'Verified coins');
  assert.equal(exploreSourceLabel('RPC unavailable · last verified 1m ago · stale'), 'Last saved data');
  assert.equal(exploreSourceLabel('Solana registry · RPC verified'), 'Up to date');
  assert.equal(exploreSourceLabel('Launch feed unavailable'), 'Live data unavailable');
  assert.equal(exploreSourceLabel('On-chain only · loading'), 'Checking coins…');
});
