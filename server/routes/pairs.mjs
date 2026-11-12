import { createPairQuotesRoute } from './pair-quotes.mjs';
import { createPairLaunchRoutes, pairLaunchEnabled } from './pair-launch.mjs';

// Paired coins: the quote-token directory (/api/pairs/quotes) and paired
// launches (/api/pair-launch/status, /api/pair-launch/record).
export { pairLaunchEnabled };
export function createPairRoutes({ solanaCluster, solanaRpcUrl, store, body, respond }) {
  const pairQuotes = createPairQuotesRoute({ solanaRpcUrl, respond });
  const launch = createPairLaunchRoutes({ solanaCluster, solanaRpcUrl, store, pairQuotes, body, respond });
  return async (req, res, url) => await pairQuotes.handle(req, res, url) || await launch(req, res, url);
}
