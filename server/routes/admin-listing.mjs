import { randomBytes } from 'node:crypto';
import { PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';
import { SOLANA_GENESIS } from '../../solana-network.js';
import { readVerifiedListingMint } from '../token-metadata.mjs';
import { allowedAuthOrigin } from '../x-auth.mjs';

// Admin wallets (FUNDED_ADMIN_WALLETS) may list an external token without the
// $RICH listing burn. The server identifies the admin only from the admin JWT
// set at wallet sign-in (see admin-jwt.mjs); nothing the browser sends about the
// wallet is trusted. The token itself is still read and verified on-chain,
// exactly as for a paid listing.
export function createAdminListingRoutes({ body, store, solanaCluster, solanaRpcUrl, clientKey, respond, env = process.env,
  connectionFactory, readListingMint = readVerifiedListingMint, now = Date.now, adminJwt }) {
  const json = (...args) => { respond(...args); return true; };
  return async function handleAdminListingRoutes(req, res, url) {
    if (req.method === 'GET' && url.pathname === '/api/listings/admin-status') {
      res.setHeader('cache-control', 'no-store');
      const admin = adminJwt?.read(req);
      return json(res, 200, { admin: Boolean(admin), wallet: admin?.wallet || null });
    }
    if (req.method !== 'POST' || url.pathname !== '/api/listings/admin') return false;
    if (!Object.hasOwn(SOLANA_GENESIS, solanaCluster)) return json(res, 503, { error: 'Listings are unavailable on this network.' });
    if (!allowedAuthOrigin(req, env.CORS_ORIGIN)) return json(res, 403, { error: 'List from richpad.fun.' });
    const admin = adminJwt?.read(req);
    if (!admin) return json(res, 401, { error: 'Sign in with an administrator wallet.' });
    if (!await store.chargeRpcRate(`admin-listing:${clientKey(req)}`, 1, 10, Math.floor(now() / 60_000) * 60_000))
      return json(res, 429, { error: 'Too many listing requests; retry shortly.' });
    const input = await body(req) || {};
    let mint;
    try { mint = new PublicKey(String(input.mint || '')).toBase58(); }
    catch { return json(res, 400, { error: 'A valid token mint is required.' }); }
    const wallet = admin.wallet, issuedAt = new Date(now()).toISOString();
    const state = await store.read();
    if (state.listings?.[mint]) return json(res, 409, { error: 'This token is already listed.' });
    let metadata;
    try {
      const rpc = connectionFactory(solanaRpcUrl, 'finalized');
      if (await rpc.getGenesisHash() !== SOLANA_GENESIS[solanaCluster]) return json(res, 503, { error: 'Listing requires a Solana RPC.' });
      const [trustedLaunch, signedMetadata] = await Promise.all([store.readLaunch(mint), store.readMetadata(mint)]);
      metadata = await readListingMint(rpc, mint, { trustedLaunch, signedMetadata });
    } catch (error) { return json(res, 409, { error: error.message || 'The token could not be verified on Solana.' }); }
    const listedAt = new Date(now()).toISOString();
    const record = { mint, name: metadata.name, symbol: metadata.symbol, wallet, cluster: solanaCluster, signature: null,
      adminListing: true,
      // Server-issued approval id (64 random bytes, base58): kept in adminSignature so
      // existing listing checks and Featured accept it like older signed admin listings.
      adminSignature: bs58.encode(randomBytes(64)), adminSession: admin.jti, usd: 0, status: 'listed', onchainVerified: true,
      metadataSource: metadata.source, metadataAddress: metadata.address, metadataStatus: metadata.metadataStatus,
      tokenProgram: metadata.tokenProgram, tokenDecimals: metadata.decimals, metadataUri: metadata.uri || null, listedAt };
    const saved = await store.update(current => {
      current.listings ||= {};
      if (current.listings[mint]) return null;
      current.listings[mint] = record;
      (current.adminAudit ||= {})[`admin-listing:${mint}`] = { wallet, mint, issuedAt, listedAt };
      return record;
    });
    return saved ? json(res, 201, saved) : json(res, 409, { error: 'This token is already listed.' });
  };
}
