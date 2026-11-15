import test from 'node:test';
import assert from 'node:assert/strict';
import { createWatchlistSync } from '../watchlist-sync.js';

test('repeated sign-in for the same wallet does not cancel the favorite being saved', async () => {
  const account = 'wallet:8CqXpgAvagXntW4u35Wno52bkwKVv6d86GRJ7EPxqDix', mint = '7yLCJpWQvE2bnX3JZGbmmKrCkCSrSGbqTmgA8tMdpump';
  let saved = [], posts = 0;
  const request = async (url, options = {}) => {
    await new Promise(resolve => setTimeout(resolve, 5));
    if (options.method === 'POST') { posts += 1; saved = [...new Set([...saved, options.body.mint])]; }
    return { available: true, data: { accountId: account, csrf: 'c', mints: saved } };
  };
  const sync = createWatchlistSync({ request });
  // Explicit verify, wallet-connect listener and session restore all name the same wallet.
  const first = sync.setIdentity(account);
  sync.setIdentity(account); sync.setIdentity(account);
  assert.equal(await first, true);
  assert.equal(await sync.save(mint, false), true);
  assert.equal(posts, 1);
  assert.deepEqual(sync.get(), [mint]);
});
