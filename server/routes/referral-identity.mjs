import { allowedAuthOrigin, authCookie, cookieValue } from '../x-auth.mjs';
import { REFERRAL_SESSION_SECONDS } from '../referral-auth.mjs';
import { randomBytes } from 'node:crypto';
import { PublicKey } from '@solana/web3.js';
import nacl from 'tweetnacl';
import { validateInput } from '../http-policy.mjs';
import { normalizeReferralCode } from '../../referral-program.js';
import { cleanShareSource } from '../share-visits.mjs';

// Called after the shared request policy, rate limit, and authorization checks.
// Return true only after sending a response; false lets the router continue.
export function createReferralIdentityRoutes({
  referralSession, body, walletKey, referralAuth, requestCookieUrl, store, id, referralChallengeStatement, walletSignature, referralCodeFromBytes,
  respond,
}) {

  const json = (...args) => { respond(...args); return true; };
  return async function handleReferralIdentityRoutes(req, res, url, requestId) {
    if (req.method === 'GET' && url.pathname === '/api/referrals/session') {
      const session = await referralSession(req);
      res.setHeader('cache-control', 'no-store');
      const expiresAt = Number.isFinite(session?.expiresAt) ? session.expiresAt
        : Number.isFinite(session?.createdAt) ? session.createdAt + REFERRAL_SESSION_SECONDS * 1000 : undefined;
      return session?.wallet ? json(res, 200, { authenticated:true, wallet:session.wallet, ...(expiresAt ? { expiresAt } : {}) }) : json(res, 401, { error:'Sign in with your connected wallet.' });
    }
    if (req.method === 'POST' && url.pathname === '/api/referrals/session/prepare') {
      if (!allowedAuthOrigin(req, process.env.CORS_ORIGIN)) return json(res, 403, { error:'Start referral access from the app origin.' });
      const input = await body(req);
      let wallet;
      try { wallet = walletKey(input.wallet); }
      catch { return json(res, 400, { error:'A valid wallet is required for referral access.' }); }
      try { return json(res, 200, await referralAuth.start(wallet)); }
      catch (error) {
        console.error(JSON.stringify({ event:'referral_session_preparation_failure', requestId }));
        return json(res, 503, { error:'Referral access is temporarily unavailable.' });
      }
    }
    if (req.method === 'POST' && url.pathname === '/api/referrals/session/verify') {
      let cookieUrl;
      try { cookieUrl = requestCookieUrl(req); } catch (error) { return json(res, 403, { error:error.message }); }
      const input = await body(req);
      const verified = await referralAuth.verify(input.challengeId, input.wallet, input.signature);
      if (!verified) return json(res, 401, { error:'Referral access approval is invalid or expired.' });
      res.setHeader('set-cookie', authCookie('funded_referral_session', verified.token, REFERRAL_SESSION_SECONDS, cookieUrl));
      return json(res, 200, { authenticated:true, wallet:verified.wallet, expiresAt:verified.expiresAt });
    }
    if (req.method === 'POST' && url.pathname === '/api/referrals/session/logout') {
      let cookieUrl;
      try { cookieUrl = requestCookieUrl(req); } catch (error) { return json(res, 403, { error:error.message }); }
      await referralAuth.revoke(cookieValue(req, 'funded_referral_session'));
      res.setHeader('set-cookie', authCookie('funded_referral_session', '', 0, cookieUrl));
      return json(res, 200, { authenticated:false });
    }
    if (req.method === 'POST' && url.pathname === '/api/referrals/registration/prepare') {
      const input = await body(req); const wallet = walletKey(input.wallet);
      const challenge = await store.update(state => {
        const item = { id: id('referral_registration'), action: 'registration', wallet, nonce: randomBytes(24).toString('hex'), expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(), status: 'awaiting-signature' };
        state.referrals.challenges[item.id] = item; return item;
      });
      return json(res, 200, { challengeId: challenge.id, statement: referralChallengeStatement(challenge), expiresAt: challenge.expiresAt });
    }
    if (req.method === 'POST' && url.pathname === '/api/referrals/registration/verify') {
      const input = await body(req); const state = await store.read(); const challenge = state.referrals.challenges[String(input.challengeId || '')];
      if (!challenge || challenge.action !== 'registration' || challenge.status !== 'awaiting-signature' || Date.parse(challenge.expiresAt) < Date.now()) return json(res, 409, { error: 'Referral registration challenge is invalid or expired.' });
      const publicKey = new PublicKey(walletKey(input.wallet)); if (publicKey.toBase58() !== challenge.wallet) return json(res, 401, { error: 'Wallet does not match the registration challenge.' });
      if (input.useWalletSession === true) {
        if (!allowedAuthOrigin(req, process.env.CORS_ORIGIN)) return json(res, 403, { error:'Use wallet sign-in from the app origin.' });
        const session = await referralSession(req);
        if (session?.wallet !== challenge.wallet) return json(res, 401, { error:'Sign in with this wallet before continuing.' });
      } else {
        const signature = walletSignature(input.signature); const message = new TextEncoder().encode(referralChallengeStatement(challenge));
        if (!nacl.sign.detached.verify(message, signature, publicKey.toBytes())) return json(res, 401, { error: 'Wallet signature is invalid.' });
      }
      const result = await store.update(current => {
        const existing = current.referrals.wallets[challenge.wallet]; if (existing) return existing;
        let code = referralCodeFromBytes(); while (current.referrals.codes[code]) code = referralCodeFromBytes();
        const record = { wallet: challenge.wallet, code, createdAt: new Date().toISOString() };
        current.referrals.codes[code] = record; current.referrals.wallets[challenge.wallet] = record; current.referrals.challenges[challenge.id] = { ...challenge, status: 'verified', verifiedAt: record.createdAt }; return record;
      });
      return json(res, 200, result);
    }
    if (req.method === 'POST' && url.pathname === '/api/referrals/attribution/prepare') {
      const input = await body(req); const wallet = walletKey(input.wallet); const code = validateInput(() => normalizeReferralCode(input.code));
      const state = await store.read(); const inviter = state.referrals.codes[code];
      if (!inviter) return json(res, 404, { error: 'Referral code is not registered.' });
      if (inviter.wallet === wallet) return json(res, 400, { error: 'Self-referral is not allowed.' });
      const challenge = await store.update(current => {
        const item = { id: id('referral_attribution'), action: 'attribution', wallet, code, source:cleanShareSource(input.source), inviterWallet: inviter.wallet, nonce: randomBytes(24).toString('hex'), expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(), status: 'awaiting-signature' };
        current.referrals.challenges[item.id] = item; return item;
      });
      return json(res, 200, { challengeId: challenge.id, statement: referralChallengeStatement(challenge), expiresAt: challenge.expiresAt });
    }
    if (req.method === 'POST' && url.pathname === '/api/referrals/attribution/verify') {
      const input = await body(req); const state = await store.read(); const challenge = state.referrals.challenges[String(input.challengeId || '')];
      if (!challenge || challenge.action !== 'attribution' || challenge.status !== 'awaiting-signature' || Date.parse(challenge.expiresAt) < Date.now()) return json(res, 409, { error: 'Referral attribution challenge is invalid or expired.' });
      const publicKey = new PublicKey(walletKey(input.wallet)); if (publicKey.toBase58() !== challenge.wallet) return json(res, 401, { error: 'Wallet does not match the attribution challenge.' });
      if (input.useWalletSession === true) {
        if (!allowedAuthOrigin(req, process.env.CORS_ORIGIN)) return json(res, 403, { error:'Use wallet sign-in from the app origin.' });
        const session = await referralSession(req);
        if (session?.wallet !== challenge.wallet) return json(res, 401, { error:'Sign in with this wallet before continuing.' });
      } else {
        const signature = walletSignature(input.signature); const message = new TextEncoder().encode(referralChallengeStatement(challenge));
        if (!nacl.sign.detached.verify(message, signature, publicKey.toBytes())) return json(res, 401, { error: 'Wallet signature is invalid.' });
      }
      const attribution = await store.update(current => {
        const existing = current.referrals.attributions[challenge.wallet];
        if (existing) return existing;
        const record = { wallet: challenge.wallet, inviterWallet: challenge.inviterWallet, inviterCode: challenge.code, source:challenge.source || 'direct', capturedAt: new Date().toISOString(), lock: 'first-touch', status: 'active' };
        current.referrals.attributions[challenge.wallet] = record; current.referrals.challenges[challenge.id] = { ...challenge, status: 'verified', verifiedAt: record.capturedAt }; return record;
      });
      return json(res, 200, attribution);
    }
    return false;
  };
}
