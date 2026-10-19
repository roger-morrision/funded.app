import { marketingAgencyCapabilities } from '../marketing-agency-policy.mjs';

export function createMarketingAgencyRoutes({ respond }) {
  return async function handleMarketingAgency(req, res, url) {
    if (url.pathname !== '/api/marketing-agency') return false;
    if (req.method !== 'GET') { respond(res, 405, { error: 'Agency execution is not activated.' }); return true; }
    // Do not expose unverified DB balances as spendable funds. There are no
    // agency-enabled on-chain launches until contract support is verified.
    respond(res, 200, { ...marketingAgencyCapabilities(),
      funding: { status: 'unavailable', collectedLamports: null, spentLamports: null },
      launches: [], history: [], historyStatus: 'unavailable' });
    return true;
  };
}
