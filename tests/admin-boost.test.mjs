import test from 'node:test';
import assert from 'node:assert/strict';
import bs58 from 'bs58';
import nacl from 'tweetnacl';
import { Keypair } from '@solana/web3.js';
import { createAdminBoostRoute, adminBoostMessage } from '../server/routes/admin-boost.mjs';
import { activeBoosts } from '../boost-offer.js';

const now = Date.parse('2026-11-15T12:00:00Z');
const mint = Keypair.generate().publicKey.toBase58();
function setup(adminKey) {
  let state = {};
  const store = { chargeRpcRate: async () => true, read: async () => state,
    update: async fn => { const next = structuredClone(state); const out = fn(next); state = next; return out; } };
  const sent = [];
  const route = createAdminBoostRoute({ body: async req => req.body, store, solanaCluster: 'mainnet-beta', clientKey: () => 'k',
    respond: (res, status, data) => sent.push({ status, data }), env: { FUNDED_ADMIN_WALLETS: adminKey.publicKey.toBase58(), CORS_ORIGIN: 'https://richpad.fun' },
    mintVerified: async () => true, now: () => now });
  return { route, sent, state: () => state };
}
const request = (body) => ({ method: 'POST', headers: { origin: 'https://richpad.fun' }, body });
const url = new URL('https://richpad.fun/api/boosts/admin');
function signed(key, packageId = '10x', issuedAt = new Date(now).toISOString()) {
  const wallet = key.publicKey.toBase58();
  const sig = nacl.sign.detached(new TextEncoder().encode(adminBoostMessage({ mint, packageId, wallet, issuedAt })), key.secretKey);
  return { mint, packageId, wallet, issuedAt, signature: bs58.encode(sig) };
}

test('an admin wallet signature records a free boost that is active on its network', async () => {
  const admin = Keypair.generate();
  const { route, sent, state } = setup(admin);
  assert.equal(await route(request(signed(admin)), {}, url), true);
  assert.equal(sent[0].status, 201);
  assert.equal(sent[0].data.usd, 0);
  assert.equal(sent[0].data.adminBoost, true);
  const active = activeBoosts(state().boostReceipts, now + 1000, 'mainnet-beta');
  assert.equal(active[mint].multiplier, 10);
});

test('non-admin wallets, bad signatures and stale signatures are refused', async () => {
  const admin = Keypair.generate(), other = Keypair.generate();
  const { route, sent } = setup(admin);
  await route(request(signed(other)), {}, url);
  assert.equal(sent.at(-1).status, 403);
  await route(request({ ...signed(admin), packageId: '30x' }), {}, url);
  assert.equal(sent.at(-1).status, 401);
  await route(request(signed(admin, '10x', new Date(now - 10 * 60_000).toISOString())), {}, url);
  assert.equal(sent.at(-1).status, 401);
});
