import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import bs58 from 'bs58';
import nacl from 'tweetnacl';
import { Keypair, SystemProgram, Transaction } from '@solana/web3.js';

const wallet = Keypair.generate();
const directory = await mkdtemp(join(tmpdir(), 'funded-dev-wallet-http-'));
const port = await new Promise((resolve, reject) => {
  const socket = createServer();
  socket.once('error', reject);
  socket.listen(0, '127.0.0.1', () => {
    const selected = socket.address().port;
    socket.close(() => resolve(selected));
  });
});
const base = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, ['server/index.mjs'], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    NODE_ENV: 'test', HOST: '127.0.0.1', PORT: String(port),
    DEV_MODE: 'true', DEV_WALLET_ROLE: 'creator', SOLANA_CLUSTER: 'devnet', VITE_SOLANA_CLUSTER: 'devnet',
    SOLANA_DEVNET_CREATOR_SECRET_KEY: bs58.encode(wallet.secretKey),
    DATABASE_URL: '', FUNDED_STORE_PATH: join(directory, 'store.json'),
    AUTOMATIC_REWARD_STORE_PATH: join(directory, 'rewards.json'),
  },
  stdio: 'ignore',
});

async function post(path, body, origin) {
  return fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(origin ? { origin } : {}) },
    body: JSON.stringify(body),
  });
}

try {
  let ready = false;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (child.exitCode !== null) throw new Error('Isolated Dev Mode API exited before readiness.');
    try {
      const response = await fetch(`${base}/api/health`);
      if (response.ok) { ready = true; break; }
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(ready, 'Isolated Dev Mode API did not become ready.');
  const origin = 'http://localhost:5174';
  const message = new TextEncoder().encode('Disposable Devnet signing test');
  const input = { message: Buffer.from(message).toString('base64') };
  assert.equal((await post('/api/dev-wallet/sign-message', input)).status, 401);
  assert.equal((await post('/api/dev-wallet/sign-message', input, 'https://example.com')).status, 401);
  const signedMessage = await post('/api/dev-wallet/sign-message', input, origin);
  assert.equal(signedMessage.status, 200);
  assert.ok(nacl.sign.detached.verify(message, Buffer.from((await signedMessage.json()).signature, 'base64'), wallet.publicKey.toBytes()));

  const transaction = new Transaction({ feePayer: wallet.publicKey, recentBlockhash: Keypair.generate().publicKey.toBase58() })
    .add(SystemProgram.transfer({ fromPubkey: wallet.publicKey, toPubkey: wallet.publicKey, lamports: 1 }));
  const transactionInput = { transaction: transaction.serialize({ requireAllSignatures: false, verifySignatures: false }).toString('base64') };
  assert.equal((await post('/api/dev-wallet/sign-transaction', transactionInput, 'https://example.com')).status, 401);
  const signedTransaction = await post('/api/dev-wallet/sign-transaction', transactionInput, origin);
  assert.equal(signedTransaction.status, 200);
  assert.ok(Transaction.from(Buffer.from((await signedTransaction.json()).transaction, 'base64')).verifySignatures());
  const serverSource = await readFile('server/index.mjs', 'utf8');
  const localGate = serverSource.slice(serverSource.indexOf('function localDevWalletRequest'), serverSource.indexOf('function walletKey'));
  assert.doesNotMatch(localGate, /req\.socket\.remoteAddress\s*\)/, 'Docker bridge addresses must not block an otherwise localhost-only Dev wallet request.');
  assert.match(localGate, /origin\.protocol === 'http:'[\s\S]*origin\.hostname[\s\S]*hostname/, 'Dev wallet signing must remain gated by both local origin and local host.');
  console.log('Dev Mode localhost and Docker-preview signing gate, plus nonlocal-origin rejection, passed');
} finally {
  child.kill();
  if (child.exitCode === null) await new Promise(resolve => child.once('exit', resolve));
  if (resolve(directory).startsWith(`${resolve(tmpdir())}${sep}funded-dev-wallet-http-`))
    await rm(directory, { recursive: true, force: true });
}
