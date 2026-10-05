const X_USERNAME = /^[A-Za-z0-9_]{1,15}$/;
const RETRYABLE_STATUS = new Set([500, 502, 503, 504]);
const lookupError = (message, statusCode = 503, providerStatus = null) =>
  Object.assign(new Error(message), { name: 'XLookupError', statusCode, providerStatus });

export function xLookupHttpError(error) {
  return error?.name === 'XLookupError' && [400, 404, 503].includes(error.statusCode)
    ? { status: error.statusCode, message: error.message } : null;
}

export function createXUserResolver({ getBearerToken, fetchUser = fetch, pause = ms => new Promise(resolve => setTimeout(resolve, ms)), now = Date.now }) {
  let lastProviderFailure = null;
  async function resolveXUser(handle) {
    const username = String(handle || '').trim().replace(/^@/, '');
    if (!X_USERNAME.test(username)) throw lookupError('Enter a valid X handle such as @account.', 400);
    const bearer = String(getBearerToken() || '').trim();
    if (!bearer) throw lookupError('X account lookup is not configured. Contact the funded.vip operator.');

    for (let attempt = 0; attempt < 2; attempt += 1) {
      let response;
      try {
        response = await fetchUser(`https://api.x.com/2/users/by/username/${encodeURIComponent(username)}`, {
          headers: { authorization: `Bearer ${bearer}` },
          signal: AbortSignal.timeout(8000),
        });
      } catch {
        if (attempt === 0) { await pause(350); continue; }
        throw lookupError('X account lookup timed out or lost its connection. Retry the launch; no coin transaction was sent.');
      }

      const payload = await response.json().catch(() => ({}));
      if (response.ok) {
        const id = String(payload.data?.id || '');
        const returnedUsername = String(payload.data?.username || '');
        if (!/^\d{1,24}$/.test(id) || returnedUsername.toLowerCase() !== username.toLowerCase()) {
          throw lookupError(`X returned an unexpected identity for @${username}. Retry the launch; no coin transaction was sent.`);
        }
        lastProviderFailure = null;
        return { handle: `@${returnedUsername}`, id };
      }

      if (RETRYABLE_STATUS.has(response.status) && attempt === 0) { await pause(350); continue; }
      if (response.status === 404) {
        lastProviderFailure = null;
        throw lookupError(`X account @${username} was not found. Check the handle and retry; no coin transaction was sent.`, 404, 404);
      }
      const message = response.status === 429 ? 'X account lookup is rate limited. Retry shortly; no coin transaction was sent.'
        : response.status === 402 ? 'X API credits are unavailable for account lookup. Contact the funded.vip operator; no coin transaction was sent.'
          : response.status === 401 || response.status === 403 ? 'X account lookup credentials were rejected. Contact the funded.vip operator; no coin transaction was sent.'
            : `X account lookup failed (${response.status}). Retry the launch; no coin transaction was sent.`;
      if ([401, 402, 403, 429].includes(response.status)) {
        const reason = response.status === 402 ? 'X account lookup is blocked by unavailable API credits'
          : response.status === 429 ? 'X account lookup is rate limited'
            : 'X account lookup credentials were rejected';
        lastProviderFailure = { reason, expiresAt: now() + 60_000 };
      }
      throw lookupError(message, 503, response.status);
    }
  }
  resolveXUser.health = () => lastProviderFailure?.expiresAt > now() ? lastProviderFailure.reason : null;
  return resolveXUser;
}
