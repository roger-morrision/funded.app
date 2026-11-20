import { PublicKey, Connection } from '@solana/web3.js';
import { PUMP_PROGRAM_ID, PUMP_SDK, bondingCurvePda } from '@pump-fun/pump-sdk';

// GET /api/tokens/:mint/creator — the creator wallet a Pump.fun coin's bonding
// curve records (it stays on chain after migration). Other coins report null.
// A known creator is stable; retry missing curves soon after a new launch.
export function createTokenCreatorRoute({ route, solanaRpcUrl, respond, makeConnection = url => new Connection(url, 'confirmed'), now = Date.now }) {
  const cache = new Map(), inflight = new Map();
  const DAY = 86_400_000, MISSING_RETRY = 60_000;
  async function read(mint) {
    const account = await makeConnection(solanaRpcUrl).getAccountInfo(bondingCurvePda(mint), 'confirmed');
    if (!account || !account.owner.equals(PUMP_PROGRAM_ID)) return null;
    const creator = PUMP_SDK.decodeBondingCurve(account)?.creator;
    const address = creator?.toBase58?.() || '';
    return address && address !== PublicKey.default.toBase58() ? address : null;
  }
  return async function handleTokenCreator(req, res, url) {
    const match = req.method === 'GET' ? route(url.pathname, req.method, /^\/api\/tokens\/([^/]+)\/creator$/) : null;
    if (!match) return false;
    let mint;
    try { mint = new PublicKey(decodeURIComponent(match)); } catch { respond(res, 400, { error: 'A valid Solana mint is required.' }); return true; }
    const key = mint.toBase58(), hit = cache.get(key);
    if (hit && now() - hit.at < (hit.data.creator ? DAY : MISSING_RETRY)) { respond(res, 200, hit.data); return true; }
    if (!inflight.has(key)) inflight.set(key, read(mint).finally(() => setTimeout(() => inflight.delete(key), 0)));
    try {
      const creator = await inflight.get(key);
      const data = { mint: key, creator, source: creator ? 'pump-bonding-curve' : null };
      cache.set(key, { at: now(), data });
      if (cache.size > 2000) cache.delete(cache.keys().next().value);
      respond(res, 200, data);
    } catch { respond(res, 502, { error: 'Creator lookup is unavailable right now.' }); }
    return true;
  };
}
