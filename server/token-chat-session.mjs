import { createHash, randomBytes } from 'node:crypto';
import bs58 from 'bs58';
import nacl from 'tweetnacl';
import { PublicKey } from '@solana/web3.js';
import { tokenChatSessionStatement } from '../token-chat.js';

const challengeLifetimeMs = 5 * 60_000;
const sessionLifetimeMs = 30 * 60_000;
const digest = value => createHash('sha256').update(value).digest('hex');
const opaque = () => randomBytes(32).toString('base64url');

export function createTokenChatSessions() {
  const challenges = new Map();
  const sessions = new Map();
  const prune = () => {
    const now = Date.now();
    for (const [key, value] of challenges) if (value.expiresAtMs <= now) challenges.delete(key);
    for (const [key, value] of sessions) if (value.expiresAtMs <= now) sessions.delete(key);
    while (challenges.size > 1000) challenges.delete(challenges.keys().next().value);
    while (sessions.size > 5000) sessions.delete(sessions.keys().next().value);
  };
  return {
    prepare(address, origin) {
      prune();
      const wallet = new PublicKey(address).toBase58();
      const now = Date.now();
      const challengeId = opaque();
      const challenge = { address: wallet, origin, nonce: opaque(), issuedAt: new Date(now).toISOString(), expiresAt: new Date(now + challengeLifetimeMs).toISOString(), expiresAtMs: now + challengeLifetimeMs };
      challenges.set(challengeId, challenge);
      return { challengeId, statement: tokenChatSessionStatement(challenge), expiresAt: challenge.expiresAt };
    },
    verify(challengeId, signatureValue, origin) {
      prune();
      const challenge = challenges.get(challengeId);
      if (!challenge || challenge.origin !== origin) return null;
      challenges.delete(challengeId);
      try {
        const signature = bs58.decode(String(signatureValue || ''));
        if (signature.length !== nacl.sign.signatureLength || !nacl.sign.detached.verify(new TextEncoder().encode(tokenChatSessionStatement(challenge)), signature, new PublicKey(challenge.address).toBytes())) return null;
      } catch { return null; }
      const token = opaque();
      const expiresAtMs = Date.now() + sessionLifetimeMs;
      sessions.set(digest(token), { address: challenge.address, origin, expiresAtMs });
      return { token, address: challenge.address, expiresAt: new Date(expiresAtMs).toISOString() };
    },
    address(token, origin) {
      if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
      const session = sessions.get(digest(token));
      if (!session) return null;
      if (session.expiresAtMs <= Date.now()) { sessions.delete(digest(token)); return null; }
      return session.origin === origin ? session.address : null;
    },
    revoke(token) {
      if (typeof token === 'string' && /^[A-Za-z0-9_-]{43}$/.test(token)) sessions.delete(digest(token));
    },
  };
}
