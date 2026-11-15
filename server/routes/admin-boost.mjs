import { PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';
import nacl from 'tweetnacl';
import { boostPackage } from '../../boost-offer.js';
import { STACKED_BOOST_POLICY } from '../../boost-timeline.js';
import { allowedAuthOrigin } from '../x-auth.mjs';

// Admin wallets (FUNDED_ADMIN_WALLETS) may boost a token without paying. The
// wallet signs a message naming the mint, package and time (no transaction, no
// fee); the server checks the signature against its admin list and records a
// boost receipt shaped like a paid one, marked adminBoost with usd 0.
export const ADMIN_BOOST_WINDOW_MS = 5 * 60_000;
export const adminBoostMessage = ({ mint, packageId, wallet, issuedAt }) =>
  `richpad.fun admin boost\nBoost this token without a fee.\nMint: ${mint}\nPackage: ${packageId}\nWallet: ${wallet}\nIssued: ${issuedAt}`;

export function createAdminBoostRoute({ body, store, solanaCluster, clientKey, respond, env = process.env, mintVerified, now = Date.now }) {
  const json = (...args) => { respond(...args); return true; };
  const admins = () => new Set(String(env.FUNDED_ADMIN_WALLETS || '').split(',').map(value => value.trim())
    .filter(value => { try { return new PublicKey(value).toBase58() === value; } catch { return false; } }));
  return async function handleAdminBoost(req, res, url) {
    if (req.method !== 'POST' || url.pathname !== '/api/boosts/admin') return false;
    if (!allowedAuthOrigin(req, env.CORS_ORIGIN)) return json(res, 403, { error: 'Boost from richpad.fun.' });
    if (!await store.chargeRpcRate(`admin-boost:${clientKey(req)}`, 1, 10, Math.floor(now() / 60_000) * 60_000))
      return json(res, 429, { error: 'Too many boost requests; retry shortly.' });
    const input = await body(req) || {};
    let mint, wallet;
    try { mint = new PublicKey(String(input.mint || '')).toBase58(); wallet = new PublicKey(String(input.wallet || '')).toBase58(); }
    catch { return json(res, 400, { error: 'A valid token mint and admin wallet are required.' }); }
    const pack = boostPackage(String(input.packageId || ''));
    if (!pack) return json(res, 400, { error: 'Choose a boost package.' });
    if (!admins().has(wallet)) return json(res, 403, { error: 'This wallet is not configured as an administrator.' });
    const issuedAt = String(input.issuedAt || ''), issued = Date.parse(issuedAt);
    if (!Number.isFinite(issued) || Math.abs(now() - issued) > ADMIN_BOOST_WINDOW_MS)
      return json(res, 401, { error: 'The admin signature expired. Sign again.' });
    let signature;
    try { signature = bs58.decode(String(input.signature || '')); } catch { signature = null; }
    const message = new TextEncoder().encode(adminBoostMessage({ mint, packageId: pack.id, wallet, issuedAt }));
    if (signature?.length !== nacl.sign.signatureLength || !nacl.sign.detached.verify(message, signature, new PublicKey(wallet).toBytes()))
      return json(res, 401, { error: 'The admin wallet signature is invalid.' });
    if (mintVerified && !await mintVerified(mint)) return json(res, 409, { error: 'The token could not be verified on Solana.' });
    const key = bs58.encode(signature), startsAt = new Date(now()).toISOString();
    const record = { signature: key, quoteId: `admin:${key}`, mint, payer: wallet, recipient: null,
      packageId: pack.id, multiplier: pack.multiplier, hours: pack.hours, usd: 0, solUsd: null, lamports: 0,
      cluster: solanaCluster, status: 'finalized', slot: 0, startsAt,
      expiresAt: new Date(now() + pack.hours * 3_600_000).toISOString(), durationPolicy: STACKED_BOOST_POLICY, adminBoost: true };
    const saved = await store.update(current => {
      current.boostReceipts ||= {};
      if (current.boostReceipts[key]) return null;
      current.boostReceipts[key] = record;
      (current.adminAudit ||= {})[`admin-boost:${key}`] = { wallet, mint, packageId: pack.id, issuedAt, startsAt };
      return record;
    });
    return saved ? json(res, 201, saved) : json(res, 409, { error: 'This admin boost was already recorded.' });
  };
}
