import test from 'node:test';
import assert from 'node:assert/strict';
import { beginWatchlistRetry, isWatchlistRetryPending } from '../src/features/portfolio/watchlist-retry-state.js';

const mint = 'So11111111111111111111111111111111111111112';
const otherMint = '9BoQNeD7MUN7Rs9x1oZS3pc3JXu9AJ8Gb89sPcGGXH2w';

test('Retry remains pending until every overlapping batch settles, with idempotent completion', () => {
  const sync = { identity:() => '123' };
  const first = beginWatchlistRetry(sync, mint), second = beginWatchlistRetry(sync, mint);
  assert.equal(isWatchlistRetryPending(sync, mint), true);
  first(); first();
  assert.equal(isWatchlistRetryPending(sync, mint), true);
  second();
  assert.equal(isWatchlistRetryPending(sync, mint), false);
  const next = beginWatchlistRetry(sync, mint);
  first(); second();
  assert.equal(isWatchlistRetryPending(sync, mint), true);
  next();
  assert.equal(isWatchlistRetryPending(sync, mint), false);
});

test('Completion from account A cannot clear the same mint pending for account B', () => {
  let owner = '123';
  const sync = { identity:() => owner }, finishA = beginWatchlistRetry(sync, mint);
  owner = '456';
  assert.equal(isWatchlistRetryPending(sync, mint), false);
  const finishB = beginWatchlistRetry(sync, mint);
  finishA();
  assert.equal(isWatchlistRetryPending(sync, mint), true);
  owner = '123';
  assert.equal(isWatchlistRetryPending(sync, mint), false);
  owner = '456'; finishB();
  assert.equal(isWatchlistRetryPending(sync, mint), false);
});

test('Retry state is isolated by exact sync object and mint, including guest owners', () => {
  const left = { identity:() => null }, right = { identity:() => null };
  const finishLeft = beginWatchlistRetry(left, mint), finishOtherMint = beginWatchlistRetry(left, otherMint);
  assert.equal(isWatchlistRetryPending(right, mint), false);
  const finishRight = beginWatchlistRetry(right, mint);
  finishLeft();
  assert.equal(isWatchlistRetryPending(left, mint), false);
  assert.equal(isWatchlistRetryPending(left, otherMint), true);
  assert.equal(isWatchlistRetryPending(right, mint), true);
  finishOtherMint(); finishRight();
  assert.equal(isWatchlistRetryPending(left, otherMint), false);
  assert.equal(isWatchlistRetryPending(right, mint), false);
});

test('Checking and invalid identities or mints have no pending claim, while null is a guest owner', () => {
  let owner;
  const sync = { identity:() => owner };
  for (const unknown of [undefined, '', 'invalid', 'wallet:invalid', 123, {}]) {
    owner = unknown;
    const finish = beginWatchlistRetry(sync, mint);
    assert.equal(isWatchlistRetryPending(sync, mint), false);
    finish();
  }
  owner = null;
  const guest = beginWatchlistRetry(sync, mint);
  assert.equal(isWatchlistRetryPending(sync, mint), true);
  owner = undefined;
  assert.equal(isWatchlistRetryPending(sync, mint), false);
  owner = null;
  assert.equal(isWatchlistRetryPending(sync, mint), true);
  for (const invalid of [undefined, '', 'invalid']) {
    const finish = beginWatchlistRetry(sync, invalid);
    assert.equal(isWatchlistRetryPending(sync, invalid), false);
    finish();
  }
  guest();
  assert.equal(isWatchlistRetryPending(sync, mint), false);
  owner = `wallet:${mint}`;
  const wallet = beginWatchlistRetry(sync, mint);
  assert.equal(isWatchlistRetryPending(sync, mint), true);
  owner = null;
  assert.equal(isWatchlistRetryPending(sync, mint), false);
  owner = `wallet:${mint}`; wallet();
  assert.equal(isWatchlistRetryPending(sync, mint), false);
});
