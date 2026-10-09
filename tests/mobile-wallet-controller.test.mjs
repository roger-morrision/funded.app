import test from 'node:test';
import assert from 'node:assert/strict';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { Keypair, PublicKey, SystemProgram, Transaction } from '@solana/web3.js';
import { createMobileWalletController } from '../src/features/wallet/mobile-controller.js';

const origin = 'https://funded.example';
const sessionKey = 'funded.app.phantom.mobile.session';
function fixture() {
  // Ephemeral keys stay in memory; no RPC, network calls or real wallets are used.
  const keypair = nacl.sign.keyPair();
  const session = {
    publicKey: bs58.encode(keypair.publicKey),
    session: bs58.encode(nacl.sign(new TextEncoder().encode(JSON.stringify({ app_url: origin, chain: 'solana', cluster: 'devnet' })), keypair.secretKey)),
    secretKey: bs58.encode(nacl.randomBytes(32)), phantomPublicKey: bs58.encode(nacl.randomBytes(32)),
  };
  const storage = new Map([[sessionKey, JSON.stringify(session)]]);
  const fields = new Map();
  const toasts = [], requests = [], copied = [];
  const node = { open: false, querySelector: () => ({}), querySelectorAll: () => [],
    showModal() { this.open = true; }, setAttribute() {}, closest() { return this; } };
  fields.set('#mobile-wallet-dialog', node);
  const document = { querySelector: key => { if (!fields.has(key)) fields.set(key, { closest: () => node }); return fields.get(key); } };
  let current = null, manualDisconnect = false;
  let respond = () => ({ data: { status: 'complete', result: { signature: bs58.encode(nacl.sign.detached(new TextEncoder().encode('claim'), keypair.secretKey)) } } });
  const controller = createMobileWalletController({
    window: { location: { origin, protocol: 'https:' } }, document,
    sessionStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
    navigator: { clipboard: { writeText: async value => copied.push(value) } },
    apiRequest: async (path, options) => { requests.push({ path, options }); return options?.method === 'POST'
      ? { available: true, data: { callbackUrl: `${origin}/callback` } } : respond(); },
    getSolana: async () => ({ PublicKey }), getWallet: () => current,
    activateWallet: provider => { current = provider; }, allowWalletReconnect() {},
    wasWalletManuallyDisconnected: () => manualDisconnect,
    closeDialog: () => { node.open = false; }, showToast: message => toasts.push(message),
  });
  return { controller, session, storage, fields, requests, copied, toasts, node,
    signer: Keypair.fromSecretKey(keypair.secretKey),
    get wallet() { return current; }, set wallet(value) { current = value; },
    set manualDisconnect(value) { manualDisconnect = value; },
    set respond(value) { respond = value; } };
}

test('mobile restore verifies ownership and reads the current wallet on every call', async () => {
  const f = fixture();
  assert.equal(await f.controller.restore(), true);
  assert.equal(f.wallet.publicKey.toBase58(), f.session.publicKey);
  assert.equal(await f.controller.restore(), false);
  f.wallet = null; f.manualDisconnect = true;
  assert.equal(await f.controller.restore(), false);
  assert.deepEqual(f.requests, []);
});

test('invalid saved mobile sessions are discarded without activating a wallet', async () => {
  const f = fixture();
  f.storage.set(sessionKey, JSON.stringify({ ...f.session, session: 'invalid' }));
  assert.equal(await f.controller.restore(), false);
  assert.equal(f.wallet, null);
  assert.equal(f.storage.has(sessionKey), false);
});

test('message approval verifies the signature, closes the QR and preserves relay authentication', async () => {
  const f = fixture(); await f.controller.restore();
  const result = await f.wallet.signMessage(new TextEncoder().encode('claim'));
  assert.equal(result.signature.length, 64);
  assert.equal(f.node.open, false);
  assert.equal(f.requests[0].options.body.signRequest.publicKey, f.session.publicKey);
  assert.equal(f.requests[1].options.headers['x-mobile-wallet-token'], f.requests[0].options.body.pollToken);
  await f.controller.copyLink();
  assert.ok(f.copied[0].startsWith('https://phantom.app/ul/browse/'));
  await f.wallet.disconnect();
  await assert.rejects(f.wallet.signMessage(new TextEncoder().encode('claim')), /Reconnect/);
  assert.equal(f.storage.has(sessionKey), false);
});

test('cancelling a QR while a relay poll is in flight rejects late approval', async () => {
  const f = fixture(); await f.controller.restore();
  let release, polled;
  const waiting = new Promise(resolve => { polled = resolve; });
  f.respond = () => { polled(); return new Promise(resolve => { release = resolve; }); };
  const pending = f.wallet.signMessage(new TextEncoder().encode('claim'));
  await waiting;
  f.controller.cancel();
  release({ data: { status: 'complete', result: { signature: 'late-approval' } } });
  await assert.rejects(pending, /cancelled on desktop/);
  assert.equal(f.node.open, false);
});

test('unverified signatures remain rejected after controller extraction', async () => {
  const f = fixture(); await f.controller.restore();
  f.respond = () => ({ data: { status: 'complete', result: { signature: bs58.encode(nacl.randomBytes(64)) } } });
  await assert.rejects(f.wallet.signMessage(new TextEncoder().encode('claim')), /signature|sign/i);
  assert.equal(f.node.open, true);
});

test('transaction approval preserves the signed message and requires a verified expiry', async () => {
  const f = fixture(); await f.controller.restore();
  const transaction = new Transaction({ feePayer: f.signer.publicKey, recentBlockhash: bs58.encode(nacl.randomBytes(32)) })
    .add(SystemProgram.transfer({ fromPubkey: f.signer.publicKey, toPubkey: f.signer.publicKey, lamports: 1 }));
  const signed = Transaction.from(transaction.serialize({ requireAllSignatures: false }));
  signed.sign(f.signer);
  const result = { transaction: bs58.encode(signed.serialize()), lastValidBlockHeight: 100 };
  f.respond = () => ({ data: { status: 'complete', result } });
  const approved = await f.wallet.signTransaction(transaction);
  assert.deepEqual(approved.serializeMessage(), transaction.serializeMessage());
  assert.equal(approved.fundedLastValidBlockHeight, 100);
  assert.equal(f.node.open, false);
  delete result.lastValidBlockHeight;
  await assert.rejects(f.wallet.signTransaction(transaction), /verified Solana expiry/);
});
