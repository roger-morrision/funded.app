import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { Keypair, PublicKey, SystemProgram, Transaction, TransactionMessage, VersionedTransaction, TransactionInstruction } from '@solana/web3.js';
import { createHash } from 'node:crypto';
import { createSigner } from '../server/signer-service.mjs';
import { createRemoteSigner } from '../server/remote-signer.mjs';
import { signTransaction } from '../server/transaction-signing.mjs';

const SOL = 1_000_000_000, TOKEN = 't'.repeat(40);
const program = Keypair.generate().publicKey, admin = Keypair.generate().publicKey;
const keeper = Keypair.generate(), treasury = Keypair.generate(), user = Keypair.generate();
const blockhash = Keypair.generate().publicKey.toBase58();
const env = { FUNDED_SIGNER_TOKEN: TOKEN, FUNDED_V3_FEE_ROUTER_PROGRAM_ID: program.toBase58(), FUNDED_ADMIN_WALLETS: admin.toBase58(),
  FUNDED_SIGNER_TREASURY_PER_MINUTE: '10' };

async function harness(extraEnv = {}) {
  const journal = [];
  const signer = createSigner({ env: { ...env, ...extraEnv }, keys: new Map([['keeper', keeper], ['treasury-boost', treasury]]), journal: row => journal.push(row) });
  const server = createServer((req, res) => { void signer.handle(req, res); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  const remote = createRemoteSigner({ env: { FUNDED_SIGNER_URL: url, FUNDED_SIGNER_TOKEN: TOKEN,
    FUNDED_SIGNER_KEYS: `keeper=${keeper.publicKey.toBase58()},treasury-boost=${treasury.publicKey.toBase58()}` } });
  return { remote, journal, url, close: () => new Promise(resolve => server.close(resolve)) };
}
const routerIx = name => new TransactionInstruction({ programId: program, keys: [{ pubkey: keeper.publicKey, isSigner: true, isWritable: true }],
  data: Buffer.concat([createHash('sha256').update(`global:${name}`).digest().subarray(0, 8), Buffer.alloc(8)]) });
const legacy = (...ixs) => new Transaction({ feePayer: keeper.publicKey, recentBlockhash: blockhash }).add(...ixs);

test('remote signatures equal local ones, for legacy, partial and versioned transactions', async () => {
  const h = await harness();
  try {
    const handle = h.remote.handle('keeper');
    assert.equal(handle.secretKey, undefined, 'the app-side handle holds no private key');
    const a = legacy(routerIx('settle_mint_v3')), b = legacy(routerIx('settle_mint_v3'));
    await signTransaction(a, [handle]); b.sign(keeper);
    assert.deepEqual(a.signature, b.signature);
    const shared = new Transaction({ feePayer: user.publicKey, recentBlockhash: blockhash }).add(new TransactionInstruction({ programId: program,
      keys: [{ pubkey: user.publicKey, isSigner: true, isWritable: true }, { pubkey: keeper.publicKey, isSigner: true, isWritable: false }], data: Buffer.alloc(8) }));
    shared.partialSign(user);
    await signTransaction(shared, [handle], { mode: 'partial' });
    assert(shared.verifySignatures(), 'user and remote signatures are both valid');
    const v0 = new VersionedTransaction(new TransactionMessage({ payerKey: keeper.publicKey, recentBlockhash: blockhash, instructions: [routerIx('settle_mint_v3')] }).compileToV0Message());
    await signTransaction(v0, [handle]);
    const check = VersionedTransaction.deserialize(v0.serialize());check.sign([keeper]);
    assert.deepEqual(v0.signatures[0], check.signatures[0]);
    assert(h.journal.every(row => row.decision === 'signed'));
  } finally { await h.close(); }
});

test('admin instructions, loaders, unknown programs and outflow caps are refused', async () => {
  const h = await harness();
  try {
    const handle = h.remote.handle('keeper');
    await assert.rejects(signTransaction(legacy(routerIx('rotate_authority')), [handle]), /router-rotate_authority/);
    await assert.rejects(signTransaction(legacy(new TransactionInstruction({ programId: new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111'),
      keys: [{ pubkey: keeper.publicKey, isSigner: true, isWritable: true }], data: Buffer.alloc(4) })), [handle]), /program-loader/);
    await assert.rejects(signTransaction(legacy(new TransactionInstruction({ programId: Keypair.generate().publicKey,
      keys: [{ pubkey: keeper.publicKey, isSigner: true, isWritable: true }], data: Buffer.alloc(1) })), [handle]), /program-not-allowed/);
    // Payouts to users are never capped per transaction, per day or by rate.
    for (let i = 0; i < 70; i++) await signTransaction(legacy(SystemProgram.transfer({ fromPubkey: keeper.publicKey, toPubkey: user.publicKey, lamports: 100 * SOL })), [handle]);
    assert.equal(h.journal.filter(row => row.decision === 'signed').length, 70);
    await assert.rejects(signTransaction(legacy(SystemProgram.assign({ accountPubkey: keeper.publicKey, programId: program })), [handle]), /system-authority-change/);
    const bad = await fetch(`${h.url}/sign`, { method: 'POST', headers: { authorization: 'Bearer wrong' }, body: '{}' });
    assert.equal(bad.status, 401);
  } finally { await h.close(); }
});

test('treasury keys sign only a transfer to an admin wallet that pays the fee', async () => {
  const h = await harness();
  try {
    const handle = h.remote.handle('treasury-boost');
    const toAdmin = new Transaction({ feePayer: admin, recentBlockhash: blockhash }).add(SystemProgram.transfer({ fromPubkey: treasury.publicKey, toPubkey: admin, lamports: SOL }));
    await signTransaction(toAdmin, [handle], { mode: 'partial' });
    const toAttacker = new Transaction({ feePayer: user.publicKey, recentBlockhash: blockhash }).add(SystemProgram.transfer({ fromPubkey: treasury.publicKey, toPubkey: user.publicKey, lamports: SOL }));
    await assert.rejects(signTransaction(toAttacker, [handle], { mode: 'partial' }), /treasury-destination-not-admin/);
    const extra = new Transaction({ feePayer: admin, recentBlockhash: blockhash }).add(SystemProgram.transfer({ fromPubkey: treasury.publicKey, toPubkey: admin, lamports: 1 }), routerIx('settle_mint_v3'));
    await assert.rejects(signTransaction(extra, [handle], { mode: 'partial' }), /treasury-transfer-only/);
    const big = new Transaction({ feePayer: admin, recentBlockhash: blockhash }).add(SystemProgram.transfer({ fromPubkey: treasury.publicKey, toPubkey: admin, lamports: 11 * SOL }));
    await assert.rejects(signTransaction(big, [handle], { mode: 'partial' }), /treasury-tx-cap/);
  } finally { await h.close(); }
});

test('observe mode logs but signs soft violations for non-treasury keys; hard rules still refuse', async () => {
  const h = await harness({ FUNDED_SIGNER_ENFORCE: 'treasury' });
  try {
    const handle = h.remote.handle('keeper');
    await signTransaction(legacy(new TransactionInstruction({ programId: Keypair.generate().publicKey,
      keys: [{ pubkey: keeper.publicKey, isSigner: true, isWritable: true }], data: Buffer.alloc(1) })), [handle]);
    assert.match(h.journal.at(-1).violations[0], /program-not-allowed/);assert.equal(h.journal.at(-1).decision, 'signed');
    await assert.rejects(signTransaction(legacy(routerIx('rotate_authority')), [handle]), /router-rotate_authority/);
  } finally { await h.close(); }
});

test('a process using the internal signer refuses to start with private keys', async () => {
  const { assertNoLocalKeys } = await import('../server/remote-signer.mjs');
  assert.doesNotThrow(() => assertNoLocalKeys({ SOLANA_KEEPER_SECRET_KEY_FILE: '/k' }), 'local-key mode is unchanged');
  assert.doesNotThrow(() => assertNoLocalKeys({ FUNDED_SIGNER_URL: 'http://signer:8790', FUNDED_DEVNET_BUYBACK_PRICE_SIGNER: 'pub', FUNDED_SIGNER_TOKEN_FILE: '/t' }));
  for (const name of ['SOLANA_KEEPER_SECRET_KEY', 'FUNDED_V3_ROUTER_AUTHORITY_SECRET_KEY_FILE', 'FUNDED_ADMIN_BOOST_SIGNER_FILE', 'FUNDED_ROUTER_AUTHORITY_KEYPAIR_PATH'])
    assert.throws(() => assertNoLocalKeys({ FUNDED_SIGNER_URL: 'http://signer:8790', [name]: 'x' }), /must not hold private keys/);
});
