import { createHash, randomBytes } from 'node:crypto';
import bs58 from 'bs58';
import nacl from 'tweetnacl';
import { PublicKey } from '@solana/web3.js';

const CHALLENGE_SECONDS = 10 * 60;
export const REFERRAL_SESSION_SECONDS = 60 * 60;
const digest = value => createHash('sha256').update(value).digest('hex');
const opaque = () => randomBytes(32).toString('base64url');
const validToken = value => typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);

function canonicalWallet(value) {
  return new PublicKey(String(value || '').trim()).toBase58();
}

function verifyWalletMessage(statement, signature, wallet) {
  try {
    return nacl.sign.detached.verify(
      new TextEncoder().encode(statement),
      bs58.decode(String(signature || '')),
      new PublicKey(wallet).toBytes(),
    );
  } catch {
    return false;
  }
}

export function createReferralAuth(store, { verifyMessage = verifyWalletMessage } = {}) {
  return {
    async start(wallet) {
      const canonical = canonicalWallet(wallet);
      const challengeId = opaque();
      const nonce = randomBytes(24).toString('hex');
      const statement = `Sign in to funded.vip\nWallet: ${canonical}\nUse referrals and token discussions with one session.\nNo transaction or network fee.\nNonce: ${nonce}`;
      await store.authPut('referral-challenge', digest(challengeId), { wallet: canonical, statement }, Date.now() + CHALLENGE_SECONDS * 1000);
      return { challengeId, wallet: canonical, statement, expiresInSeconds: CHALLENGE_SECONDS };
    },
    async verify(challengeId, wallet, signature) {
      if (!validToken(challengeId)) return null;
      const challenge = await store.authTake('referral-challenge', digest(challengeId));
      if (!challenge) return null;
      let canonical;
      try { canonical = canonicalWallet(wallet); } catch { return null; }
      if (canonical !== challenge.wallet || !verifyMessage(challenge.statement, signature, canonical)) return null;
      const token = opaque();
      const createdAt = Date.now();
      const expiresAt = createdAt + REFERRAL_SESSION_SECONDS * 1000;
      await store.authPut('referral-session', digest(token), { wallet: canonical, createdAt, expiresAt }, expiresAt);
      return { token, wallet: canonical, expiresAt };
    },
    session(token) {
      return validToken(token) ? store.authRead('referral-session', digest(token)) : null;
    },
    revoke(token) {
      return validToken(token) ? store.authDelete('referral-session', digest(token)) : undefined;
    },
  };
}
