import { PublicKey } from '@solana/web3.js';
import { allowedAuthOrigin } from './x-auth.mjs';
import { readJsonBody } from './request-body.mjs';
import { createHash } from 'node:crypto';
import { cookieValue } from './x-auth.mjs';

const invalid = message => Object.assign(new Error(message), { statusCode: 400 });
export function updateWatchlist(prior, input) {
  const row = structuredClone(prior || { mints: [], imports: [] });
  const incoming = input.action === 'import' ? input.mints : [input.mint];
  if (!['add', 'remove', 'import'].includes(input.action) || !Array.isArray(incoming) || incoming.length > 200) throw invalid('Choose up to 200 favorite tokens.');
  for (const mint of incoming) {
    try { if (typeof mint !== 'string' || new PublicKey(mint).toBase58() !== mint) throw new Error(); }
    catch { throw invalid('Invalid token address.'); }
  }
  if (input.action === 'import') {
    if (!/^[a-f0-9-]{36}$/.test(input.importId || '')) throw invalid('Invalid favorites import.');
    if (row.imports.includes(input.importId)) return row;
    if (row.imports.length >= 2000) throw invalid('Favorites import limit reached. Add tokens individually.');
    row.imports.push(input.importId);
  }
  row.mints = input.action === 'remove' ? row.mints.filter(mint => mint !== input.mint) : [...new Set([...row.mints, ...incoming])];
  if (row.mints.length > 200) throw invalid('Your account can save up to 200 favorite tokens.');
  return row;
}

export function createWatchlistHandler({ store, cluster, getSession, getWalletSession = async () => null, origin = process.env.CORS_ORIGIN }) {
  return async (req, res, url) => {
    if (url.pathname !== '/api/watchlist') return false;
    const reply = (status, data) => { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'private, no-store' }); res.end(JSON.stringify(data)); return true; };
    const requested = url.searchParams.get('accountId');
    let accountId, csrf;
    if (requested?.startsWith('wallet:')) {
      const session = await getWalletSession(req);
      const wallet = String(session?.wallet || '');
      if (`wallet:${wallet}` !== requested || !wallet) return reply(401, { error: 'Verify this wallet to sync favorites.' });
      accountId = requested;
      csrf = createHash('sha256').update('funded-watchlist:').update(cookieValue(req, 'funded_referral_session')).digest('hex');
    } else {
      const session = await getSession(req);
      accountId = String(session?.user?.id || '');
      csrf = session?.creatorCsrf;
      if (!/^\d{1,24}$/.test(accountId) || (requested && requested !== accountId)) return reply(401, { error: 'Sign in with X to sync favorites.' });
    }
    if (req.method === 'GET') {
      const row = await store.readWatchlist(accountId, cluster);
      return reply(200, { accountId, csrf, mints: row.mints });
    }
    if (req.method !== 'POST') return reply(405, { error: 'Method not allowed.' });
    if (!allowedAuthOrigin(req, origin) || !csrf || req.headers['x-watchlist-csrf'] !== csrf) return reply(403, { error: 'Refresh your sign-in before changing favorites.' });
    if (!await store.chargeRpcRate(`watchlist:${accountId}`, 1, 120, Math.floor(Date.now() / 60000) * 60000)) return reply(429, { error: 'Please wait before updating favorites again.' });
    try {
      const input = await readJsonBody(req, { maxBytes: 16000 });
      if (!input || typeof input !== 'object' || Array.isArray(input)) return reply(400, { error: 'Invalid favorites update.' });
      if (input.accountId !== accountId) return reply(409, { error: 'Your account changed. Reload favorites before saving.' });
      const row = await store.updateWatchlist(accountId, cluster, prior => updateWatchlist(prior, input));
      return reply(200, { accountId, mints: row.mints });
    } catch (error) {
      if (!req.complete) { res.shouldKeepAlive = false; res.setHeader('connection', 'close'); }
      if (error.statusCode) return reply(error.statusCode, { error: error.message });
      throw error;
    }
  };
}
