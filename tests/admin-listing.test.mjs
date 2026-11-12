import test from 'node:test';
import assert from 'node:assert/strict';
import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import nacl from 'tweetnacl';
import { SOLANA_GENESIS } from '../solana-network.js';
import { createAdminListingRoutes, adminListingMessage } from '../server/routes/admin-listing.mjs';

const admin = Keypair.generate(), stranger = Keypair.generate();
const mint = Keypair.generate().publicKey.toBase58();
const NOW = Date.parse('2026-11-12T00:00:00Z');

function harness() {
  let state = {};
  const store = { read: async () => state, update: async fn => fn(state), chargeRpcRate: async () => true,
    readLaunch: async () => null, readMetadata: async () => null };
  const sent = [];
  const handle = createAdminListingRoutes({
    body: async req => req.body, store, solanaCluster: 'mainnet-beta', solanaRpcUrl: 'http://rpc', clientKey: () => 'ip',
    respond: (res, status, body) => sent.push({ status, body }), now: () => NOW,
    env: { FUNDED_ADMIN_WALLETS: admin.publicKey.toBase58(), CORS_ORIGIN: 'https://richpad.fun' },
    connectionFactory: () => ({ getGenesisHash: async () => SOLANA_GENESIS['mainnet-beta'] }),
    readListingMint: async () => ({ name: 'Float', symbol: 'FLOAT', source: 'metaplex', address: 'meta', metadataStatus: 'verified', tokenProgram: 'spl-token', decimals: 6 }),
  });
  const post = async (input) => {
    await handle({ method: 'POST', headers: { origin: 'https://richpad.fun' }, body: input }, {}, new URL('https://richpad.fun/api/listings/admin'));
    return sent.at(-1);
  };
  return { post, state: () => state, handle, sent };
}
const signed = (keypair, issuedAt = new Date(NOW).toISOString(), wallet = keypair.publicKey.toBase58()) => ({
  mint, wallet, issuedAt,
  signature: bs58.encode(nacl.sign.detached(new TextEncoder().encode(adminListingMessage({ mint, wallet, issuedAt })), keypair.secretKey)),
});

test('an admin wallet signature lists an external token without a fee', async () => {
  const h = harness();
  const result = await h.post(signed(admin));
  assert.equal(result.status, 201);
  assert.equal(result.body.adminListing, true);
  assert.equal(result.body.usd, 0);
  assert.equal(result.body.signature, null);
  assert.equal(h.state().listings[mint].onchainVerified, true);
  assert.equal((await h.post(signed(admin))).status, 409);
});

test('non-admin wallets, forged signatures and stale signatures are refused', async () => {
  const h = harness();
  assert.equal((await h.post(signed(stranger))).status, 403);
  assert.equal((await h.post({ ...signed(stranger), wallet: admin.publicKey.toBase58() })).status, 401);
  assert.equal((await h.post(signed(admin, new Date(NOW - 10 * 60_000).toISOString()))).status, 401);
  assert.equal(h.state().listings, undefined);
});

test('admin status reports whether a wallet may list for free', async () => {
  const h = harness();
  await h.handle({ method: 'GET', headers: {} }, {}, new URL(`https://richpad.fun/api/listings/admin-status?wallet=${admin.publicKey.toBase58()}`));
  assert.equal(h.sent.at(-1).body.admin, true);
  await h.handle({ method: 'GET', headers: {} }, {}, new URL(`https://richpad.fun/api/listings/admin-status?wallet=${stranger.publicKey.toBase58()}`));
  assert.equal(h.sent.at(-1).body.admin, false);
});
