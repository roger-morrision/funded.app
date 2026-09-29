import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import nacl from 'tweetnacl';
import { tokenChatDeleteStatement, tokenChatPostStatement, tokenChatReportStatement } from '../token-chat.js';

const directory = await mkdtemp(join(tmpdir(), 'funded-token-chat-'));
const storePath = join(directory, 'store.json');
const mint = Keypair.generate().publicKey.toBase58();
const sessionMint = Keypair.generate().publicKey.toBase58();
const secondSessionMint = Keypair.generate().publicKey.toBase58();
const author = Keypair.generate();
const sessionAuthor = Keypair.generate();
const secondAuthor = Keypair.generate();
const reporters = [Keypair.generate(), Keypair.generate(), Keypair.generate()];
const token = 'token-chat-ops-test';

const probe = createServer();
await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
const port = probe.address().port;
await new Promise(resolve => probe.close(resolve));
const base = `http://127.0.0.1:${port}`;

const server = spawn(process.execPath, ['server/index.mjs'], {
  cwd: process.cwd(),
  env: { ...process.env, NODE_ENV: 'test', HOST: '127.0.0.1', PORT: String(port), FUNDED_STORE_PATH: storePath, DATABASE_URL: '', FUNDED_API_TOKEN: token, CORS_ORIGIN: base, VITE_SOLANA_CLUSTER: 'devnet', TOKEN_CHAT_REPORT_THRESHOLD: '3' },
  stdio: 'ignore',
});

async function request(path, options = {}) {
  const response = await fetch(`${base}${path}`, { ...options, headers: { ...(options.body ? { 'content-type': 'application/json' } : {}), ...(options.headers || {}) }, body: options.body ? JSON.stringify(options.body) : undefined });
  return { status: response.status, data: await response.json() };
}
function envelope() { return { nonce: crypto.randomUUID(), issuedAt: new Date().toISOString() }; }
function signedPost(keypair, text) {
  const payload = { mint, author: keypair.publicKey.toBase58(), text, ...envelope() };
  return { ...payload, signature: bs58.encode(nacl.sign.detached(new TextEncoder().encode(tokenChatPostStatement(payload)), keypair.secretKey)) };
}
function signedReport(keypair, messageId, reason = 'spam-or-scam') {
  const payload = { mint, messageId, reporter: keypair.publicKey.toBase58(), reason, ...envelope() };
  return { ...payload, signature: bs58.encode(nacl.sign.detached(new TextEncoder().encode(tokenChatReportStatement(payload)), keypair.secretKey)) };
}
function signedDelete(keypair, messageId) {
  const payload = { mint, messageId, author: keypair.publicKey.toBase58(), ...envelope() };
  return { ...payload, signature: bs58.encode(nacl.sign.detached(new TextEncoder().encode(tokenChatDeleteStatement(payload)), keypair.secretKey)) };
}

try {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try { if ((await fetch(`${base}/api/health`)).ok) break; } catch {}
    if (attempt === 49) throw new Error('Token-chat test server did not start.');
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  const path = `/api/tokens/${mint}/chat`;
  const initial = await request(path);
  assert.equal(initial.status, 200);
  assert.equal(initial.data.enabled, true);
  assert.equal(initial.data.authentication, 'solana-wallet-session');
  assert.deepEqual(initial.data.messages, []);

  const unsigned = await request(path, { method: 'POST', body: { author: author.publicKey.toBase58(), text: 'Unsigned message' } });
  assert.equal(unsigned.status, 400);

  const sessionPath = `/api/tokens/${sessionMint}/chat`;
  const originHeaders = { origin: base };
  const wrongOrigin = await request('/api/token-chat/session/prepare', { method: 'POST', headers: { origin: 'https://other.example' }, body: { address: sessionAuthor.publicKey.toBase58() } });
  assert.equal(wrongOrigin.status, 403);
  const forged = await request('/api/token-chat/session/prepare', { method: 'POST', headers: originHeaders, body: { address: sessionAuthor.publicKey.toBase58() } });
  assert.equal(forged.status, 200);
  const wrongSigner = bs58.encode(nacl.sign.detached(new TextEncoder().encode(forged.data.statement), author.secretKey));
  const forgedVerification = await request('/api/token-chat/session/verify', { method: 'POST', headers: originHeaders, body: { challengeId: forged.data.challengeId, signature: wrongSigner } });
  assert.equal(forgedVerification.status, 401);
  const prepared = await request('/api/token-chat/session/prepare', { method: 'POST', headers: originHeaders, body: { address: sessionAuthor.publicKey.toBase58() } });
  assert.equal(prepared.status, 200);
  const approval = bs58.encode(nacl.sign.detached(new TextEncoder().encode(prepared.data.statement), sessionAuthor.secretKey));
  const verified = await request('/api/token-chat/session/verify', { method: 'POST', headers: originHeaders, body: { challengeId: prepared.data.challengeId, signature: approval } });
  assert.equal(verified.status, 200);
  assert.equal(verified.data.address, sessionAuthor.publicKey.toBase58());
  const replayApproval = await request('/api/token-chat/session/verify', { method: 'POST', headers: originHeaders, body: { challengeId: prepared.data.challengeId, signature: approval } });
  assert.equal(replayApproval.status, 401);
  const sessionHeaders = { ...originHeaders, 'x-token-chat-session': verified.data.token };
  const sessionPost = await request(sessionPath, { method: 'POST', headers: sessionHeaders, body: { author: sessionAuthor.publicKey.toBase58(), text: 'First session post.' } });
  assert.equal(sessionPost.status, 201);
  const secondSessionPost = await request(`/api/tokens/${secondSessionMint}/chat`, { method: 'POST', headers: sessionHeaders, body: { author: sessionAuthor.publicKey.toBase58(), text: 'Another token, same approval.' } });
  assert.equal(secondSessionPost.status, 201);
  const wrongWallet = await request(sessionPath, { method: 'POST', headers: sessionHeaders, body: { author: author.publicKey.toBase58(), text: 'Impersonated post.' } });
  assert.equal(wrongWallet.status, 401);
  const sessionDelete = await request(`${sessionPath}/delete`, { method: 'POST', headers: sessionHeaders, body: { author: sessionAuthor.publicKey.toBase58(), messageId: sessionPost.data.message.id } });
  assert.equal(sessionDelete.status, 200);
  const otherMessage = await request(sessionPath, { method: 'POST', body: { ...signedPost(secondAuthor, 'Reportable text.'), mint: sessionMint } });
  // The signed statement is bound to its mint, so post a correctly signed message below.
  assert.equal(otherMessage.status, 401);
  const reportable = { mint: sessionMint, author: secondAuthor.publicKey.toBase58(), text: 'Reportable text.', ...envelope() };
  const reportableSigned = { ...reportable, signature: bs58.encode(nacl.sign.detached(new TextEncoder().encode(tokenChatPostStatement(reportable)), secondAuthor.secretKey)) };
  const otherPost = await request(sessionPath, { method: 'POST', body: reportableSigned });
  assert.equal(otherPost.status, 201);
  const sessionReport = await request(`${sessionPath}/report`, { method: 'POST', headers: sessionHeaders, body: { reporter: sessionAuthor.publicKey.toBase58(), messageId: otherPost.data.message.id, reason: 'misleading' } });
  assert.equal(sessionReport.status, 200);
  const revoked = await request('/api/token-chat/session/revoke', { method: 'POST', headers: sessionHeaders });
  assert.equal(revoked.status, 200);
  const afterRevoke = await request(sessionPath, { method: 'POST', headers: sessionHeaders, body: { author: sessionAuthor.publicKey.toBase58(), text: 'Should not post.' } });
  assert.equal(afterRevoke.status, 401);

  const firstPayload = signedPost(author, '  First wallet-verified observation.  ');
  const first = await request(path, { method: 'POST', body: firstPayload });
  assert.equal(first.status, 201);
  assert.equal(first.data.message.author, author.publicKey.toBase58());
  assert.equal(first.data.message.text, 'First wallet-verified observation.');
  assert.equal(Object.hasOwn(first.data.message, 'signature'), false);

  const replay = await request(path, { method: 'POST', body: firstPayload });
  assert.equal(replay.status, 409);

  const second = await request(path, { method: 'POST', body: signedPost(secondAuthor, 'A separate useful note.') });
  assert.equal(second.status, 201);
  const forbiddenDelete = await request(`${path}/delete`, { method: 'POST', body: signedDelete(author, second.data.message.id) });
  assert.equal(forbiddenDelete.status, 403);
  const deleted = await request(`${path}/delete`, { method: 'POST', body: signedDelete(secondAuthor, second.data.message.id) });
  assert.equal(deleted.status, 200);

  for (const [index, reporter] of reporters.entries()) {
    const report = await request(`${path}/report`, { method: 'POST', body: signedReport(reporter, first.data.message.id, index === 2 ? 'misleading' : 'spam-or-scam') });
    assert.equal(report.status, 200);
    assert.equal(report.data.reportCount, index + 1);
    assert.equal(report.data.hidden, index === 2);
  }
  const hiddenFeed = await request(path);
  assert.deepEqual(hiddenFeed.data.messages, []);

  const queue = await request('/api/ops/token-chat', { headers: { authorization: `Bearer ${token}` } });
  assert.equal(queue.status, 200);
  const moderated = queue.data.messages.find(message => message.id === first.data.message.id);
  assert.equal(moderated.status, 'hidden');
  assert.equal(moderated.reports.length, 3);
  const restore = await request('/api/ops/token-chat/moderate', { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: { mint, messageId: first.data.message.id, action: 'restore' } });
  assert.equal(restore.status, 200);
  assert.equal(restore.data.status, 'visible');
  const restoredFeed = await request(path);
  assert.equal(restoredFeed.data.messages.length, 1);

  const stored = JSON.parse(await readFile(storePath, 'utf8'));
  assert.equal(stored.coinChats[mint].length, 2);
  assert.equal(stored.coinChats[mint][0].reports[reporters[0].publicKey.toBase58()].reason, 'spam-or-scam');
  assert.equal(stored.coinChats[mint][1].status, 'deleted');
  console.log('Token chat: one-time wallet approval, multiple unsigned session actions, revocation, legacy signatures, persistence, and moderation passed with ephemeral keys.');
} finally {
  server.kill();
  await rm(directory, { recursive: true, force: true });
}
