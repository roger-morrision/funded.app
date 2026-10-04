import { createHash, randomBytes } from 'node:crypto';
import bs58 from 'bs58';
import nacl from 'tweetnacl';
import { PublicKey } from '@solana/web3.js';
import { tokenChatSessionStatement } from '../token-chat.js';

const challengeLifetimeMs = 5 * 60_000;
const sessionLifetimeMs = 30 * 60_000;
const digest = value => createHash('sha256').update(value).digest('hex');
const opaque = () => randomBytes(32).toString('base64url');
const validToken = value => typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);

export function createTokenChatSessions(store, { cluster = 'devnet', now = Date.now } = {}) {
  if (!store?.authPut || !store?.authRead || !store?.authTake || !store?.authDelete) throw new Error('Chat requires an authentication store.');
  const challengeKind = `chat-challenge:${cluster}`;
  const sessionKind = `chat-session:${cluster}`;
  return {
    async prepare(address, origin) {
      const wallet = new PublicKey(address).toBase58();
      const time = now();
      const challengeId = opaque();
      const challenge = { address: wallet, origin, nonce: opaque(), issuedAt: new Date(time).toISOString(), expiresAt: new Date(time + challengeLifetimeMs).toISOString(), expiresAtMs: time + challengeLifetimeMs };
      await store.authPut(challengeKind, digest(challengeId), challenge, challenge.expiresAtMs);
      return { challengeId, statement: tokenChatSessionStatement(challenge), expiresAt: challenge.expiresAt };
    },
    async verify(challengeId, signatureValue, origin) {
      if (!validToken(challengeId) || typeof signatureValue !== 'string' || signatureValue.length > 100) return null;
      const key = digest(challengeId);
      const visible = await store.authRead(challengeKind, key);
      if (!visible || visible.origin !== origin) return null;
      // DELETE RETURNING in PostgreSQL makes verification one-use across replicas.
      const challenge = await store.authTake(challengeKind, key);
      if (!challenge || challenge.origin !== origin || challenge.expiresAtMs <= now()) return null;
      try {
        const signature = bs58.decode(String(signatureValue || ''));
        if (signature.length !== nacl.sign.signatureLength || !nacl.sign.detached.verify(new TextEncoder().encode(tokenChatSessionStatement(challenge)), signature, new PublicKey(challenge.address).toBytes())) return null;
      } catch { return null; }
      const token = opaque();
      const expiresAtMs = now() + sessionLifetimeMs;
      await store.authPut(sessionKind, digest(token), { address: challenge.address, origin, expiresAtMs }, expiresAtMs);
      return { token, address: challenge.address, expiresAt: new Date(expiresAtMs).toISOString() };
    },
    async address(token, origin) {
      if (!validToken(token)) return null;
      const session = await store.authRead(sessionKind, digest(token));
      return session?.origin === origin && session.expiresAtMs > now() ? session.address : null;
    },
    async revoke(token) {
      if (validToken(token)) await store.authDelete(sessionKind, digest(token));
    },
  };
}
