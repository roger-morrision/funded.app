import { PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';
import nacl from 'tweetnacl';
import { SOLANA_GENESIS } from '../../solana-network.js';
import { readVerifiedListingMint } from '../token-metadata.mjs';
import { allowedAuthOrigin } from '../x-auth.mjs';

// Admin wallets (FUNDED_ADMIN_WALLETS) may list an external token without the
// $RICH listing burn. Ownership is proven per listing by a wallet signature over
// a message naming the mint, wallet and time; the token itself is still read and
// verified on-chain, exactly as for a paid listing.
export const ADMIN_LISTING_WINDOW_MS = 5 * 60_000;
export const adminListingMessage = ({ mint, wallet, issuedAt }) =>
  `richpad.fun admin listing\nList this token without a fee.\nMint: ${mint}\nWallet: ${wallet}\nIssued: ${issuedAt}`;

export function createAdminListingRoutes({ body, store, solanaCluster, solanaRpcUrl, clientKey, respond, env = process.env,
  connectionFactory, readListingMint = readVerifiedListingMint, now = Date.now }) {
  const json = (...args) => { respond(...args); return true; };
  const admins = () => new Set(String(env.FUNDED_ADMIN_WALLETS || '').split(',').map(value => value.trim())
    .filter(value => { try { return new PublicKey(value).toBase58() === value; } catch { return false; } }));
  return async function handleAdminListingRoutes(req, res, url) {
    if (req.method === 'GET' && url.pathname === '/api/listings/admin-status') {
      const wallet = String(url.searchParams.get('wallet') || '');
      return json(res, 200, { wallet, admin: admins().has(wallet) });
    }
    if (req.method !== 'POST' || url.pathname !== '/api/listings/admin') return false;
    if (!Object.hasOwn(SOLANA_GENESIS, solanaCluster)) return json(res, 503, { error: 'Listings are unavailable on this network.' });
    if (!allowedAuthOrigin(req, env.CORS_ORIGIN)) return json(res, 403, { error: 'List from richpad.fun.' });
    if (!await store.chargeRpcRate(`admin-listing:${clientKey(req)}`, 1, 10, Math.floor(now() / 60_000) * 60_000))
      return json(res, 429, { error: 'Too many listing requests; retry shortly.' });
    const input = await body(req) || {};
    let mint, wallet;
    try { mint = new PublicKey(String(input.mint || '')).toBase58(); wallet = new PublicKey(String(input.wallet || '')).toBase58(); }
    catch { return json(res, 400, { error: 'A valid token mint and admin wallet are required.' }); }
    if (!admins().has(wallet)) return json(res, 403, { error: 'This wallet is not configured as an administrator.' });
    const issuedAt = String(input.issuedAt || ''), issued = Date.parse(issuedAt);
    if (!Number.isFinite(issued) || Math.abs(now() - issued) > ADMIN_LISTING_WINDOW_MS)
      return json(res, 401, { error: 'The admin signature expired. Sign again.' });
    let signature;
    try { signature = bs58.decode(String(input.signature || '')); } catch { signature = null; }
    const message = new TextEncoder().encode(adminListingMessage({ mint, wallet, issuedAt }));
    if (signature?.length !== nacl.sign.signatureLength || !nacl.sign.detached.verify(message, signature, new PublicKey(wallet).toBytes()))
      return json(res, 401, { error: 'The admin wallet signature is invalid.' });
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
      adminListing: true, adminSignature: bs58.encode(signature), usd: 0, status: 'listed', onchainVerified: true,
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
