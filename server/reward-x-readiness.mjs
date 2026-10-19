import { v3XCapability } from './v3-x-capability.mjs';

export function createRewardXReadiness({ cluster, xOAuthConfigured, resolveXUser,
  env = process.env }) {
  return (req, launch) => v3XCapability({ cluster, launch,
    enabled:env.FUNDED_V3_X_CLAIMS_ENABLED === 'true',
    oauthConfigured:xOAuthConfigured(req),
    lookupConfigured:Boolean(String(env.X_BEARER_TOKEN || '').trim()),
    lookupError:resolveXUser.health() });
}
