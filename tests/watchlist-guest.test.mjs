import test from 'node:test';
import assert from 'node:assert/strict';
import { createWatchlistSync } from '../watchlist-sync.js';

const A = 'A'.repeat(32), B = 'B'.repeat(32), C = 'C'.repeat(32);
const memoryStore = (initial = []) => { let list = [...initial]; return { read: () => [...list], write: next => { list = [...next]; } }; };

test('favorites save in the browser without an account', async () => {
  const store = memoryStore();
  const sync = createWatchlistSync({ request: async () => { throw new Error('no network expected'); }, guestStore: store });
  sync.setIdentity(null);
  assert.equal(await sync.save(A, false), true);
  assert.equal(await sync.save(B, false), true);
  assert.deepEqual(sync.get(), [B, A]);
  assert.equal(await sync.save(A, true), true);
  assert.deepEqual(store.read(), [B]);
});

test('guest favorites are added to the account once it loads, then cleared locally', async () => {
  const store = memoryStore([A, C]);
  let server = [C];
  const request = async (_url, options = {}) => {
    if (options.method === 'POST') server = [...new Set([...server, options.body.mint])];
    return { available: true, data: { accountId: 'wallet:' + B, mints: server, csrf: 't' } };
  };
  const sync = createWatchlistSync({ request, guestStore: store });
  assert.equal(await sync.setIdentity('wallet:' + B), true);
  assert.deepEqual([...sync.get()].sort(), [A, C].sort());
  assert.deepEqual(store.read(), []);
});
