import { createHash, randomBytes } from 'node:crypto';
import { PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';
import { xProfitConsentStatement, validateXProfitConsent } from './x-profit-proof.mjs';

const CHALLENGE_KIND = 'x-profit-consent:devnet:v1';
const lifetime = 5 * 60_000;
const digest = value => createHash('sha256').update(value).digest('hex');
const fail = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode });
const validChallenge = value => typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
const validSignature = value => { try { return typeof value === 'string' && value.length <= 88 && bs58.decode(value).length === 64; } catch { return false; } };
const publicResult = row => ({ id: row.id, status: 'accepted', publication: 'awaiting-collector-verification', account: row.consent.account,
  wallet: row.wallet, mint: row.mint, buySignature: row.buySignature, sellSignature: row.sellSignature, consentedAt: row.consentedAt });

export function publicTradeShareConfig(env = process.env, cluster = 'devnet') {
  const account = String(env.X_POST_EXPECTED_HANDLE || '').replace(/^@/, '').toLowerCase();
  let origin = null;
  try {
    const url = new URL(env.X_POST_PUBLIC_ORIGIN || '');
    if (url.protocol === 'https:' && !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash
      && /^[a-z0-9.-]+$/i.test(url.hostname) && url.hostname.includes('.') && !/^\d+(?:\.\d+){3}$/.test(url.hostname)
      && !/(?:^|\.)(localhost|local|internal|test|invalid|example)$/.test(url.hostname)) origin = url.origin;
  } catch {}
  const enabled = env.X_PUBLIC_TRADE_SHARES_ENABLED === 'true' && cluster === 'devnet' && Boolean(origin) && /^[a-z0-9_]{1,15}$/.test(account);
  return { enabled, account: enabled ? account : null, origin: enabled ? origin : null, cluster: 'devnet', minimumProfitLamports: '1000000000' };
}

export function createPublicTradeConsent({ store, config, verifyTrade, now = Date.now, maxActive = 2 }) {
  let active = 0;
  const checkOrigin = origin => {
    if (!config.enabled) throw fail('Public trade sharing is unavailable.', 404);
    if (origin !== config.origin) throw fail('Open trade sharing from the configured app origin.', 403);
  };
  return {
    async prepare(input, origin) {
      checkOrigin(origin);
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw fail('A publication request object is required.');
      let wallet, mint;
      try { wallet = new PublicKey(input.wallet).toBase58(); mint = new PublicKey(input.mint).toBase58(); }
      catch { throw fail('A valid wallet and token mint are required.'); }
      if (!validSignature(input.buySignature) || !validSignature(input.sellSignature) || input.buySignature === input.sellSignature) throw fail('Two distinct trade signatures are required.');
      const time = now();
      const consent = { version: 1, purpose: 'publish-closed-trade-on-x', cluster: 'devnet', origin: config.origin, account: config.account,
        wallet, mint, buySignature: input.buySignature, sellSignature: input.sellSignature,
        issuedAt: new Date(time).toISOString(), expiresAt: new Date(time + lifetime).toISOString(), challengeId: randomBytes(32).toString('base64url') };
      await store.authPut(CHALLENGE_KIND, digest(consent.challengeId), consent, time + lifetime);
      return { challengeId: consent.challengeId, statement: xProfitConsentStatement(consent), expiresAt: consent.expiresAt,
        account: consent.account, origin: consent.origin, cluster: consent.cluster, wallet, mint };
    },
    async accept(input, origin) {
      checkOrigin(origin);
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw fail('A publication request object is required.');
      if (!validChallenge(input.challengeId) || !validSignature(input.signature)) throw fail('A valid challenge and wallet signature are required.');
      const before = await store.read();
      const replay = Object.values(before.xPublicTradeShares || {}).find(row => row.consent?.challengeId === input.challengeId);
      if (replay) {
        if (replay.consent.signature !== input.signature || replay.consent.origin !== origin || replay.consent.account !== config.account) throw fail('Consent does not match the accepted request.', 403);
        return { created: false, share: publicResult(replay) };
      }
      const challenge = await store.authRead(CHALLENGE_KIND, digest(input.challengeId));
      if (!challenge || challenge.origin !== origin || challenge.account !== config.account || Date.parse(challenge.expiresAt) <= now()) throw fail('Consent request expired. Prepare a new request.', 409);
      const consent = { ...challenge, signature: input.signature };
      try { await validateXProfitConsent(consent, { publicOrigin: config.origin, xAccount: config.account, now: now() }); }
      catch { throw fail('Wallet approval does not match this publication request.', 403); }
      if (active >= maxActive) throw fail('Trade verification is busy. Retry the same approval shortly.', 429);
      const id = `xprofit_${digest(JSON.stringify([config.origin, config.account, consent.wallet, consent.mint, consent.buySignature, consent.sellSignature]))}`;
      const candidate = { id, schemaVersion: 1, status: 'consented', cluster: 'devnet', publicConsent: true, consentVerified: true,
        wallet: consent.wallet, mint: consent.mint, buySignature: consent.buySignature, sellSignature: consent.sellSignature,
        consentedAt: new Date(now()).toISOString(), consent };
      active++;
      let proof;
      try { proof = await verifyTrade(candidate, { state: before }); }
      catch { throw fail('The closed trade could not be verified. Check both finalized receipts and retry.', 422); }
      finally { active--; }
      try {
        if (proof.wallet !== candidate.wallet || proof.mint !== candidate.mint || proof.publicConsent !== true || proof.completeCostBasis !== true || proof.positionClosed !== true
          || BigInt(proof.sellProceedsLamports) - BigInt(proof.buyCostLamports) - BigInt(proof.feesLamports) < BigInt(config.minimumProfitLamports)) throw new Error();
      } catch { throw fail('A verified, fully closed trade with at least 1 SOL attributable profit is required.', 422); }
      return store.update(state => {
        state.xPublicTradeShares ||= {};
        const existing = state.xPublicTradeShares[id];
        if (existing) return { created: false, share: publicResult(existing) };
        if (Date.parse(consent.expiresAt) <= now()) throw fail('Consent expired during verification. Prepare a new request.', 409);
        // Challenge identity is consumed by this immutable row in the same transaction.
        if (Object.values(state.xPublicTradeShares).some(row => row.consent?.challengeId === consent.challengeId)) throw fail('This approval has already been used.', 409);
        const row = { ...candidate, proof };
        state.xPublicTradeShares[id] = row;
        return { created: true, share: publicResult(row) };
      });
    },
  };
}
