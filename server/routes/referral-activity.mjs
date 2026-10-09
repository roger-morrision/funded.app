import { normalizeReferralCode, resolveReferralNetwork } from '../../referral-program.js';
import { cleanShareSource, recordShareVisit, summarizeShareVisits } from '../share-visits.mjs';
import { allowedAuthOrigin } from '../x-auth.mjs';
import { validateInput } from '../http-policy.mjs';

function referralNetworkForWallet(state, wallet) {
  return resolveReferralNetwork(wallet, state.referrals.attributions, 3);
}

// Both handlers run after the entry point's shared request policy.
export function createReferralActivityRoutes({ store, body, clientKey, walletKey, referralSession, respond }) {
  const json = (...args) => { respond(...args); return true; };
  async function handleShareVisit(req, res, url) {
    if (req.method === 'POST' && url.pathname === '/api/shares/visit') {
      if (!allowedAuthOrigin(req, process.env.CORS_ORIGIN)) return json(res, 403, { error:'Visit origin is not allowed.' });
      const input = await body(req);
      const code = validateInput(() => normalizeReferralCode(input.code));
      if (!code || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(input.visitorId || ''))) return json(res, 400, { error:'A valid opt-in visit is required.' });
      const minute = Math.floor(Date.now() / 60_000) * 60_000;
      if (!await store.chargeRpcRate(`share-visit:${clientKey(req)}`, 1, 30, minute)) return json(res, 429, { error:'Visit limit reached.' });
      const recorded = await store.update(state => {
        if (!state.referrals.codes[code]) return false;
        state.shareVisits ||= {};
        recordShareVisit(state.shareVisits, { code, visitorId:input.visitorId, source:input.source });
        return true;
      });
      return recorded ? json(res, 202, { recorded:true, scope:'consented-browser-day' }) : json(res, 404, { error:'Referral code is not registered.' });
    }
    return false;
  }
  async function handleReferralActivity(req, res, url) {
    if (req.method === 'GET' && url.pathname === '/api/referral-claims') {
      let wallet;
      try { wallet = walletKey(url.searchParams.get('wallet')); } catch { return json(res, 400, { error: 'A valid wallet query parameter is required.' }); }
      const session = await referralSession(req);
      if (session?.wallet !== wallet) return json(res, 401, { error:'Approve referral dashboard access with this wallet.' });
      const claims = (await store.readReferralClaimsForWallet(wallet)).map(item => ({ id: item.id, level: item.level, amount: item.amount, asset: item.asset, status: item.status, createdAt: item.createdAt, expiresAt: item.expiresAt, statement: `funded.app referral reward claim ${item.id} nonce ${item.nonce}`, payoutSignature: item.payoutSignature }));
      return json(res, 200, { wallet, claims });
    }
    if (req.method === 'GET' && url.pathname === '/api/referrals/dashboard') {
      let wallet;
      try { wallet = walletKey(url.searchParams.get('wallet')); } catch { return json(res, 400, { error: 'A valid wallet query parameter is required.' }); }
      const session = await referralSession(req);
      if (session?.wallet !== wallet) return json(res, 401, { error:'Approve referral dashboard access with this wallet.' });
      const state = await store.read(); const network = referralNetworkForWallet(state, wallet); const qualified = new Set(Object.values(state.settlements).filter(item => network.includes(item.creatorWallet)).map(item => item.creatorWallet));
      const code = state.referrals.wallets[wallet]?.code;
      const direct = Object.values(state.referrals.attributions).filter(item => item.inviterWallet === wallet);
      const directCreatorsBySource = {};
      for (const item of direct) directCreatorsBySource[cleanShareSource(item.source)] = (directCreatorsBySource[cleanShareSource(item.source)] || 0) + 1;
      return json(res, 200, { wallet, directCreators: direct.length, directCreatorsBySource, networkCreators: network.length, qualifiedCreators: qualified.size, conversionRate: network.length ? Number((qualified.size / network.length * 100).toFixed(1)) : null, shareVisits:code ? summarizeShareVisits(state.shareVisits, code) : null });
    }
    return false;
  }
  return { handleShareVisit, handleReferralActivity };
}
