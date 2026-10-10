import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import bs58 from 'bs58';
import { Buffer } from 'node:buffer';
import { Transaction as SolanaTransaction } from '@solana/web3.js';
import { LISTING_PENDING_KEY, readPendingListing, savePendingListing, clearPendingListing } from '../listing-recovery.js';

const mint = bs58.encode(new Uint8Array(32).fill(1)), wallet = bs58.encode(new Uint8Array(32).fill(2));
const signatureBytes = new Uint8Array(64).fill(9), signature = bs58.encode(signatureBytes);
const record = { mint, wallet, signature, name: 'Fixture', symbol: 'FIX', cluster: 'devnet' };
function memory() {
  const rows = new Map();
  return { rows, getItem: key => rows.get(key) ?? null, setItem: (key, value) => rows.set(key, value), removeItem: key => rows.delete(key) };
}

test('pending listing validates receipt identity and retains legacy records across reload', () => {
  const storage = memory();
  storage.setItem(LISTING_PENDING_KEY, JSON.stringify({ ...record, cluster: undefined }));
  assert.deepEqual(readPendingListing(storage), record);
  for (const value of ['{', 'null', '{}', JSON.stringify({ ...record, signature: 'bad' }), JSON.stringify({ ...record, cluster: 'mainnet-beta' })]) {
    storage.setItem(LISTING_PENDING_KEY, value);
    assert.throws(() => readPendingListing(storage));
    assert.equal(storage.getItem(LISTING_PENDING_KEY), value, 'Unreadable recovery is never deleted');
  }
  assert.throws(() => readPendingListing({ getItem() { throw new Error('denied'); } }), /cannot be read/);
});

test('save must be readable and cannot overwrite another signed burn', () => {
  const storage = memory(); savePendingListing(record, storage);
  assert.deepEqual(readPendingListing(storage), record);
  assert.throws(() => savePendingListing({ ...record, signature: bs58.encode(new Uint8Array(64).fill(8)) }, storage), /Another signed/);
  assert.throws(() => savePendingListing(record, { getItem: () => null, setItem() { throw new Error('denied'); } }), /No transaction was sent/);
  assert.throws(() => savePendingListing(record, { getItem: () => null, setItem() {} }), /could not be confirmed/);
});

test('compare-clear preserves a newer record and reports failed cleanup without deleting proof', () => {
  const storage = memory(); savePendingListing(record, storage);
  const newer = { ...record, signature: bs58.encode(new Uint8Array(64).fill(8)) };
  storage.setItem(LISTING_PENDING_KEY, JSON.stringify(newer));
  assert.throws(() => clearPendingListing(record, storage), /different signed/);
  assert.deepEqual(readPendingListing(storage), newer);
  storage.setItem(LISTING_PENDING_KEY, JSON.stringify(record));
  assert.throws(() => clearPendingListing(record, { ...storage, removeItem() { throw new Error('denied'); } }), /could not clear/);
  assert.deepEqual(readPendingListing(storage), record);
  clearPendingListing(record, storage); assert.equal(readPendingListing(storage), null);
});

const app = await readFile(new URL('../list-page.js', import.meta.url), 'utf8');
const readStart = app.indexOf('  function readPending() {');
const helpers = app.slice(readStart, app.indexOf('  const configuredBurnTokens', readStart));
const submitStart = app.indexOf('  async function submitPayment() {');
const submit = app.slice(submitStart, app.indexOf('\n  mintInput.addEventListener', submitStart));
assert(readStart >= 0 && submitStart >= 0);
// A synthetic wire transaction with a fixed signature, never cryptographically
// signed or submitted. The production SDK parses the actual serialized identity.
const raw = Buffer.concat([Buffer.from([1]), Buffer.from(signatureBytes), Buffer.from([1, 0, 0, 1]), Buffer.from(bs58.decode(wallet)), Buffer.alloc(32), Buffer.from([0])]);
function fixture({ send = 'timeout', storageFailure, confirmation = { value: { err: null }, status: { confirmationStatus: 'finalized' } }, changeAt } = {}) {
  const storage = memory(), messages = [], calls = [];
  let current = true;
  if (storageFailure === 'read') storage.getItem = () => { throw new Error('denied'); };
  if (storageFailure === 'write') storage.setItem = () => { throw new Error('denied'); };
  if (storageFailure === 'remove') storage.removeItem = () => { throw new Error('denied'); };
  const context = {
    Buffer, bs58, recoveryError: '', pendingNotice: null, retainedPending: null, busy: false,
    readPendingListing: () => readPendingListing(storage),
    savePendingListing: value => { calls.push('save'); savePendingListing(value, storage); if (changeAt === 'save') current = false; },
    clearPendingListing: value => clearPendingListing(value, storage),
    review: { close() {} }, draw() {},
    mintInput: { value: mint }, nameInput: { value: record.name }, symbolInput: { value: record.symbol },
    assertSession: () => { if (!current) throw new Error('Wallet changed'); },
    setStatus: (message, proof) => messages.push({ message, proof }),
    Transaction: class { add() { return this; } static from(bytes) { return SolanaTransaction.from(bytes); } },
    TransactionInstruction: class {}, createBurnCheckedInstruction: () => ({}), MEMO_PROGRAM: 'synthetic', listingMemo: () => 'synthetic memo',
    listingQuoteCurrent: () => true, fundedMint:mint,
    waitForSignatureConfirmation: async () => { calls.push('confirm'); if (changeAt === 'confirm') current = false; return confirmation; },
    getAccount: async () => ({ amount: 90n }), getMint: async () => ({ supply: 90n }),
    claimPending: async value => { calls.push('index'); clearPendingListing(value, storage); context.retainedPending = null; },
  };
  context.prepared = {
    ...record, session: { address: wallet, provider: { publicKey: wallet, signTransaction: async () => {
      calls.push('sign'); if (changeAt === 'sign') current = false;
      return { signature: new Uint8Array(64).fill(5), serialize: () => raw };
    } } },
    rpc: {
      getLatestBlockhash: async () => { calls.push('blockhash'); if (changeAt === 'blockhash') current = false; return { blockhash: 'synthetic', lastValidBlockHeight: 1 }; },
      sendRawTransaction: async bytes => {
        calls.push('send'); assert.deepEqual(Buffer.from(bytes), raw);
        assert.equal(readPendingListing(storage).signature, signature, 'Original serialized identity is saved before any broadcast');
        if (changeAt === 'send') current = false;
        if (send === 'timeout') throw new Error('RPC timeout');
        return send === 'mismatch' ? bs58.encode(new Uint8Array(64).fill(4)) : signature;
      },
    },
    source: { address: 'synthetic', amount: 100n }, fundedKey: 'synthetic', tokenProgram: 'synthetic', amount: 10n, amountTokens: 1, decimals: 6, supplyBefore: 100n,
    quote:{ id:'listing_1000_0123456789abcdef', expiresAt:new Date(Date.now() + 600_000).toISOString() },
  };
  vm.runInNewContext(helpers + submit, context);
  return { context, storage, messages, calls, run: () => context.submitPayment() };
}

for (const send of ['timeout', 'mismatch']) test(`${send} after broadcast keeps original receipt and prevents a second burn`, async () => {
  const f = fixture({ send }); const prepared = f.context.prepared;
  await f.run();
  assert.equal(readPendingListing(f.storage).signature, signature);
  assert(f.messages.some(row => /uncertain/.test(row.message) && row.proof === signature));
  assert(!f.messages.some(row => /^No burn submitted/.test(row.message)));
  f.context.prepared = prepared; await f.run();
  assert.equal(f.calls.filter(call => call === 'send').length, 1);
  assert.equal(readPendingListing(f.storage).signature, signature, 'A fresh reader after reload retains the original identity');
});

for (const storageFailure of ['read', 'write']) test(`${storageFailure} storage failure blocks broadcast`, async () => {
  const f = fixture({ storageFailure }); await f.run(); assert(!f.calls.includes('send'));
});

for (const changeAt of ['blockhash', 'sign', 'save', 'send', 'confirm']) test(`wallet change after ${changeAt} stops later signing or payment actions`, async () => {
  const f = fixture({ send: 'success', changeAt }); await f.run();
  if (changeAt === 'blockhash') assert(!f.calls.includes('sign'));
  if (['blockhash', 'sign', 'save'].includes(changeAt)) assert(!f.calls.includes('send'));
  if (['save', 'send', 'confirm'].includes(changeAt)) assert.equal(readPendingListing(f.storage).signature, signature);
  assert(!f.calls.includes('index'));
});

test('malformed confirmation retains the receipt while a finalized failure can clear it', async () => {
  const unknown = fixture({ send: 'success', confirmation: { value: {} } }); await unknown.run();
  assert.equal(readPendingListing(unknown.storage).signature, signature); assert(!unknown.calls.includes('index'));
  const failed = fixture({ send: 'success', confirmation: { value: { err: { InstructionError: [0, 'fixture'] } }, status: { confirmationStatus: 'finalized' } } }); await failed.run();
  assert.equal(readPendingListing(failed.storage), null); assert(!failed.calls.includes('index'));
  assert(failed.messages.some(row => /failed on Devnet/.test(row.message)));
});

test('finalized failure with denied cleanup preserves recovery and does not invite another payment', async () => {
  const f = fixture({ send: 'success', storageFailure: 'remove', confirmation: { value: { err: 'fixture' }, status: { confirmationStatus: 'finalized' } } }); await f.run();
  assert.equal(readPendingListing(f.storage).signature, signature);
  assert(f.messages.some(row => /cleanup is incomplete/.test(row.message)));
});

test('successful confirmation and matching burn deltas reach indexing with the original receipt', async () => {
  const f = fixture({ send: 'success' }); await f.run();
  assert.deepEqual(f.calls, ['blockhash', 'sign', 'save', 'send', 'confirm', 'index']);
  assert.equal(readPendingListing(f.storage), null);
});

test('processed and confirmed transaction errors never clear the original signed recovery', async () => {
  for (const confirmationStatus of ['processed', 'confirmed']) {
    const f = fixture({ send: 'success', confirmation: { value: { err: 'fixture' }, status: { confirmationStatus } } });
    await f.run();
    assert.equal(readPendingListing(f.storage).signature, signature);
    assert(f.messages.some(row => /uncertain/.test(row.message)));
    assert(!f.calls.includes('index'));
  }
});

test('a loaded receipt remains available and locked if storage disappears or becomes unreadable', async () => {
  const f = fixture(); savePendingListing(record, f.storage);
  assert.equal(f.context.readPending().signature, signature);
  f.storage.rows.clear();
  assert.equal(f.context.readPending().signature, signature);
  assert.match(f.context.recoveryError, /disappeared/);
  f.storage.getItem = () => { throw new Error('denied'); };
  assert.equal(f.context.readPending().signature, signature);
  await f.run(); assert(!f.calls.includes('send'));
});

const refreshStart = app.indexOf('  async function refreshListings() {');
const refresh = app.slice(refreshStart, app.indexOf('  async function refreshConfig()', refreshStart));
test('background listing refresh clears only a matching verified Devnet receipt and wallet', async () => {
  for (const patch of [{ onchainVerified: false }, { cluster: 'mainnet-beta' }, { wallet: mint }, { signature: 'other' }, {}]) {
    const storage = memory(); savePendingListing(record, storage);
    const context = {
      recoveryError: '', retainedPending: null, pendingNotice: null, listings: [], listingsAvailable: false, AbortSignal,
      readPendingListing: () => readPendingListing(storage), clearPendingListing: value => clearPendingListing(value, storage),
      apiRequest: async () => ({ available: true, data: { cluster: 'devnet', listings: [{ ...record, onchainVerified: true, ...patch }] } }),
      renderListings() {}, mintValue: () => null, draw() {}, setStatus() {}, live: {},
    };
    vm.runInNewContext(helpers + refresh, context); await context.refreshListings();
    assert.equal(readPendingListing(storage) === null, Object.keys(patch).length === 0);
  }
});

const claimStart = app.indexOf('  async function claimPending(');
const claim = app.slice(claimStart, submitStart);
test('receipt retry preserves recovery for mismatched proof or failed cleanup', async () => {
  for (const mode of ['wrong-network', 'wrong-wallet', 'cleanup-denied', 'verified']) {
    const storage = memory(); savePendingListing(record, storage);
    if (mode === 'cleanup-denied') storage.removeItem = () => { throw new Error('denied'); };
    const notices = [], calls = [];
    const context = {
      recoveryError: '', retainedPending: null, pendingNotice: null, busy: false, AbortSignal, Event,
      readPendingListing: () => readPendingListing(storage), clearPendingListing: value => clearPendingListing(value, storage),
      apiRequest: async () => ({ available: true, data: { ...record, onchainVerified: true,
        cluster: mode === 'wrong-network' ? 'mainnet-beta' : 'devnet', wallet: mode === 'wrong-wallet' ? mint : wallet } }),
      draw() {}, setStatus: message => notices.push(message), refreshListings: async () => calls.push('refresh'),
      window: { dispatchEvent: () => calls.push('verified-event') },
    };
    vm.runInNewContext(helpers + claim, context); await context.claimPending();
    assert.equal(readPendingListing(storage) === null, mode === 'verified');
    assert.equal(context.busy, false);
    if (mode === 'verified') assert.deepEqual(calls, ['refresh', 'verified-event']);
    else assert.deepEqual(calls, []);
    if (mode === 'cleanup-denied') assert(notices.some(message => /receipt verified, but recovery cleanup is incomplete/.test(message)));
  }
});
