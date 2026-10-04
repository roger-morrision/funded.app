import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import nacl from 'tweetnacl';
import { createFileAuthStore } from '../server/file-auth-store.mjs';
import { createTokenChatSessions } from '../server/token-chat-session.mjs';

test('chat authentication survives recreation, is single-use and isolates network/origin', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'funded-chat-session-'));
  try {
    const path = join(dir, 'auth.json');
    const store = createFileAuthStore(path);
    const first = createTokenChatSessions(store);
    const wallet = Keypair.generate();
    const origin = 'https://app.example';
    const challenge = await first.prepare(wallet.publicKey.toBase58(), origin);
    const signature = bs58.encode(nacl.sign.detached(new TextEncoder().encode(challenge.statement), wallet.secretKey));
    assert.equal(await first.verify(challenge.challengeId, signature, 'https://wrong.example'), null);
    const restarted = createTokenChatSessions(createFileAuthStore(path));
    const session = await restarted.verify(challenge.challengeId, signature, origin);
    assert.equal(session.address, wallet.publicKey.toBase58());
    assert.equal(await first.verify(challenge.challengeId, signature, origin), null);
    assert.equal(await first.address(session.token, origin), session.address);
    assert.equal(await first.address(session.token, 'https://wrong.example'), null);
    assert.equal(await createTokenChatSessions(store, { cluster: 'mainnet-beta' }).address(session.token, origin), null);
    await restarted.revoke(session.token);
    assert.equal(await first.address(session.token, origin), null);
    const raced = await first.prepare(wallet.publicKey.toBase58(), origin);
    const approval = bs58.encode(nacl.sign.detached(new TextEncoder().encode(raced.statement), wallet.secretKey));
    const outcomes = await Promise.all([first.verify(raced.challengeId, approval, origin), restarted.verify(raced.challengeId, approval, origin)]);
    assert.equal(outcomes.filter(Boolean).length, 1);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
