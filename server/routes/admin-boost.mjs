import { randomBytes } from 'node:crypto';
import { PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';
import { boostPackage } from '../../boost-offer.js';
import { STACKED_BOOST_POLICY } from '../../boost-timeline.js';
import { allowedAuthOrigin } from '../x-auth.mjs';

// Admin wallets (FUNDED_ADMIN_WALLETS) may boost a token without paying. The
// server identifies the admin only from the admin JWT set at wallet sign-in
// (see admin-jwt.mjs) and records a boost receipt shaped like a paid one,
// marked adminBoost with usd 0.
export function createAdminBoostRoute({ body, store, solanaCluster, clientKey, respond, env = process.env, mintVerified, now = Date.now, adminJwt }) {
  const json = (...args) => { respond(...args); return true; };
  return async function handleAdminBoost(req, res, url) {
    if (req.method !== 'POST' || url.pathname !== '/api/boosts/admin') return false;
    if (!allowedAuthOrigin(req, env.CORS_ORIGIN)) return json(res, 403, { error: 'Boost from richpad.fun.' });
    const admin = adminJwt?.read(req);
    if (!admin) return json(res, 401, { error: 'Sign in with an administrator wallet.' });
    if (!await store.chargeRpcRate(`admin-boost:${clientKey(req)}`, 1, 10, Math.floor(now() / 60_000) * 60_000))
      return json(res, 429, { error: 'Too many boost requests; retry shortly.' });
    const input = await body(req) || {};
    let mint;
    try { mint = new PublicKey(String(input.mint || '')).toBase58(); }
    catch { return json(res, 400, { error: 'A valid token mint is required.' }); }
    const pack = boostPackage(String(input.packageId || ''));
    if (!pack) return json(res, 400, { error: 'Choose a boost package.' });
    if (mintVerified && !await mintVerified(mint)) return json(res, 409, { error: 'The token could not be verified on Solana.' });
    // Server-issued receipt id (64 random bytes, base58) in the signature slot so
    // boost history, Featured and de-duplication treat it like a paid receipt.
    const key = bs58.encode(randomBytes(64)), startsAt = new Date(now()).toISOString();
    const record = { signature: key, quoteId: `admin:${key}`, mint, payer: admin.wallet, recipient: null,
      packageId: pack.id, multiplier: pack.multiplier, hours: pack.hours, usd: 0, solUsd: null, lamports: 0,
      cluster: solanaCluster, status: 'finalized', slot: 0, startsAt,
      expiresAt: new Date(now() + pack.hours * 3_600_000).toISOString(), durationPolicy: STACKED_BOOST_POLICY,
      adminBoost: true, adminSession: admin.jti };
    const saved = await store.update(current => {
      current.boostReceipts ||= {};
      current.boostReceipts[key] = record;
      (current.adminAudit ||= {})[`admin-boost:${key}`] = { wallet: admin.wallet, mint, packageId: pack.id, startsAt, session: admin.jti };
      return record;
    });
    return json(res, 201, saved);
  };
}
