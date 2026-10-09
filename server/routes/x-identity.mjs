import { authCookie, OAUTH_SECONDS, cookieValue, SESSION_SECONDS, allowedAuthOrigin } from '../x-auth.mjs';
import { xLookupHttpError } from '../x-user-lookup.mjs';
import { rewardView, automaticXClaimState } from '../../reward-discovery.js';

// Called after the shared request policy, rate limit, and authorization checks.
// Return true only after sending a response; false lets the router continue.
export function createXIdentityRoutes({
  xConfig,
  store,
  clientKey,
  xOAuthConfigured,
  xCallbackUrl,
  xAuth,
  html: respondHtml,
  xSession,
  xFeeReadiness,
  resolveXUser,
  mintRouterReadiness,
  solanaCluster,
  readReceiptEvidence,
  automaticRewardStore,
  respond,
}) {
  const json = (...args) => { respond(...args); return true; };
  const html = (...args) => { respondHtml(...args); return true; };
  return async function handleXIdentityRoutes(req, res, url) {
    if (req.method === 'GET' && url.pathname === '/api/x/oauth/start') {
      const config = xConfig();
      if (!config.clientId || !config.clientSecret) return json(res, 503, { error: 'X OAuth is not configured on the server.' });
      if (!await store.chargeRpcRate(`x-start:${clientKey(req)}`, 1, 10, Math.floor(Date.now()/60000)*60000)) return json(res, 429, { error: 'Please wait before signing in again.' });
      if (!xOAuthConfigured(req)) return json(res, 503, { error: 'Configure an exact X OAuth callback URL for this app origin.' });
      const callbackUrl = xCallbackUrl(req);
      const { state, binding, challenge } = await xAuth.start(callbackUrl);
      const params = new URLSearchParams({ response_type: 'code', client_id: config.clientId, redirect_uri: callbackUrl, scope: 'tweet.read users.read', state, code_challenge: challenge, code_challenge_method: 'S256' });
      res.writeHead(302, { location: `https://x.com/i/oauth2/authorize?${params.toString()}`, 'cache-control': 'no-store', 'set-cookie': authCookie('funded_x_oauth', binding, OAUTH_SECONDS, callbackUrl) });
      res.end(); return true;
    }
    if (req.method === 'GET' && url.pathname === '/api/x/oauth/callback') {
      const state = String(url.searchParams.get('state') || '');
      const code = String(url.searchParams.get('code') || '');
      const request = await xAuth.consume(state, cookieValue(req, 'funded_x_oauth'));
      res.setHeader('cache-control', 'no-store');
      res.setHeader('referrer-policy', 'no-referrer');
      if (!request) return html(res, 400, 'X sign-in expired', 'Start sign-in again in this browser. The request expired or was already used.');
      res.setHeader('set-cookie', authCookie('funded_x_oauth', '', 0, request.callbackUrl));
      if (url.searchParams.get('error')) return html(res, 400, 'X sign-in cancelled', 'X sign-in was cancelled. Start again when ready.');
      if (!code) return html(res, 400, 'X sign-in failed', 'No authorization code was received. Start again.');
      const config = xConfig();
      const form = new URLSearchParams({ code, grant_type: 'authorization_code', redirect_uri: request.callbackUrl, code_verifier: request.verifier });
      let tokenResponse;
      try { tokenResponse = await fetch('https://api.x.com/2/oauth2/token', { method: 'POST', headers: { authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64')}`, 'content-type': 'application/x-www-form-urlencoded' }, body: form, signal: AbortSignal.timeout(10000) }); }
      catch { return html(res, 503, 'X sign-in unavailable', 'X could not be reached. Start sign-in again shortly.'); }
      const token = await tokenResponse.json().catch(() => ({}));
      if (tokenResponse.status === 402) return html(res, 503, 'X sign-in unavailable', 'X API credits are unavailable. Contact the funded.vip operator.');
      if (!tokenResponse.ok || !token.access_token) return html(res, 502, 'X sign-in failed', 'X did not issue an access token. Check the exact callback URL and OAuth settings.');
      let userResponse;
      try { userResponse = await fetch('https://api.x.com/2/users/me?user.fields=id,name,username', { headers: { authorization: `Bearer ${token.access_token}` }, signal: AbortSignal.timeout(10000) }); }
      catch { return html(res, 503, 'X profile unavailable', 'X could not load the account profile. Start sign-in again shortly.'); }
      const profile = await userResponse.json().catch(() => ({}));
      if (userResponse.status === 402) return html(res, 503, 'X profile unavailable', 'X API credits are unavailable. Contact the funded.vip operator.');
      if (!userResponse.ok || !profile.data?.id) return html(res, 502, 'X profile lookup failed', 'X sign-in succeeded but the account profile could not be loaded.');
      await xAuth.revoke(cookieValue(req, 'funded_x_session'));
      const sessionId = await xAuth.issue(profile.data);
      res.writeHead(302, { location: '/?x=connected', 'set-cookie': [authCookie('funded_x_session', sessionId, SESSION_SECONDS, request.callbackUrl), authCookie('funded_x_oauth', '', 0, request.callbackUrl)] });
      res.end(); return true;
    }
    if (req.method === 'GET' && url.pathname === '/api/x/me') {
      const session = await xSession(req);
      res.setHeader('cache-control', 'no-store');
      return json(res, 200, { configured: xOAuthConfigured(req), authenticated: Boolean(session), user: session?.user || null });
    }
    if (req.method === 'GET' && url.pathname === '/api/x/resolve') {
      // A prior provider failure must not block a fresh lookup after X recovers.
      const readiness = await xFeeReadiness({ includeLookupHealth: false });
      if (!readiness.ready) return json(res, 503, { error: 'X fee claims are not operational on Solana yet.', reasons: readiness.reasons });
      if (!await store.chargeRpcRate(`x-resolve:${clientKey(req)}`, 1, 10, Math.floor(Date.now() / 60_000) * 60_000)) return json(res, 429, { error: 'X account lookup limit reached; retry shortly.' });
      let resolved;
      try { resolved = await resolveXUser(url.searchParams.get('handle')); }
      catch (error) {
        const failure = xLookupHttpError(error);
        if (failure) return json(res, failure.status, { error: failure.message });
        throw error;
      }
      if ((await store.read()).creatorProfiles?.[resolved.id]?.optedOut) return json(res, 409, { error: 'This creator has opted out of new support launches.' });
      return json(res, 200, resolved);
    }
    if (req.method === 'GET' && url.pathname === '/api/mint-router/status') return json(res, 200, await mintRouterReadiness());
    if (req.method === 'GET' && url.pathname === '/api/x-fee/status') return json(res, 200, await xFeeReadiness());
    if (req.method === 'GET' && url.pathname === '/api/x-fee/claims') {
      const session = await xSession(req);
      res.setHeader('cache-control', 'no-store');
      if (!session?.user?.username) return json(res, 401, { error: 'Sign in with X to view claims.' });
      const handle = `@${session.user.username}`.toLowerCase();
      const state = await store.readCreatorState(String(session.user.id), solanaCluster);
      const evidence=await readReceiptEvidence(state);
      const rewards = await automaticRewardStore.read();
      const claims = Object.values(state.obligations || {}).filter(item => item.source === 'verified-per-mint-router-collection' && item.xUserId === String(session.user.id)).map(item => {
        const claim = state.claims?.[item.id];
        return rewardView(item, claim, evidence.verifiedPayouts, automaticXClaimState(item, claim, rewards));
      });
      return json(res, 200, { handle, claims });
    }
    if (req.method === 'POST' && url.pathname === '/api/x/logout') {
      if (!allowedAuthOrigin(req, process.env.CORS_ORIGIN)) return json(res, 403, { error: 'Sign out from the app origin.' });
      await xAuth.revoke(cookieValue(req, 'funded_x_session'));
      res.writeHead(204, { 'cache-control': 'no-store', 'set-cookie': authCookie('funded_x_session', '', 0, xCallbackUrl(req)) });
      res.end(); return true;
    }
    return false;
  };
}
