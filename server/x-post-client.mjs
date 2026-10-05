import { xOAuth1Authorization } from './x-oauth1.mjs';

// Separate user-context credentials for the platform account. Never reuse creator-login
// tokens or the app-only bearer token used for public profile lookup.
function failure(message, delivery, status, retryAfterMs) {
  return Object.assign(new Error(message), { delivery, status, retryAfterMs });
}

function retryDelay(response) {
  const retry = response.headers.get('retry-after');
  const reset = Number(response.headers.get('x-rate-limit-reset')) * 1000;
  const delay = retry && /^\d+$/.test(retry) ? Number(retry) * 1000
    : retry && Number.isFinite(Date.parse(retry)) ? Date.parse(retry) - Date.now()
      : Number.isFinite(reset) && reset > Date.now() ? reset - Date.now() : 60_000;
  return Math.min(86_400_000, Math.max(1000, delay));
}

export function createXPublisher({ accessToken, oauth1, expectedHandle, expectedAccountId, fetchImpl = globalThis.fetch, timeoutMs = 15_000 } = {}) {
  const usingOAuth1 = oauth1 != null;
  if (usingOAuth1 && accessToken) throw new Error('Choose exactly one X user authentication method.');
  if (usingOAuth1) {
    if (['apiKey', 'apiSecret', 'accessToken', 'accessTokenSecret'].some(key => typeof oauth1[key] !== 'string' || !oauth1[key].trim()))
      throw new Error('Complete X OAuth 1.0a user credentials are required.');
  } else if (typeof accessToken !== 'string' || !accessToken.trim()) {
    throw new Error('X_POST_ACCESS_TOKEN must be a user-context token with tweet.write permission.');
  }
  const handle = String(expectedHandle || '').replace(/^@/, '');
  if (!/^[A-Za-z0-9_]{1,15}$/.test(handle)) throw new Error('Configure the intended X_POST_EXPECTED_HANDLE before publishing.');
  if (expectedAccountId && !/^\d{1,30}$/.test(String(expectedAccountId))) throw new Error('X_POST_ACCOUNT_ID must be a numeric X user ID.');
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 60_000) throw new Error('X posting timeout must be between 100 and 60000 milliseconds.');
  let account = null;

  async function request(path, { method = 'GET', body, signal } = {}) {
    const deadline = AbortSignal.timeout(timeoutMs);
    const combined = signal ? AbortSignal.any([signal, deadline]) : deadline;
    let response;
    try {
      const url = new URL(path, 'https://api.x.com');
      response = await fetchImpl(url.href, {
        method, redirect: 'error', signal: combined,
        headers: { authorization: usingOAuth1 ? xOAuth1Authorization({ method, url, ...oauth1 }) : `Bearer ${accessToken}`,
          accept: 'application/json', ...(body ? { 'content-type': 'application/json' } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    } catch {
      throw failure(method === 'POST' ? 'X delivery outcome is unknown; reconcile the account before retrying.' : 'X account verification is unavailable.', method === 'POST' ? 'unknown' : 'rejected');
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      if (response.status === 429) throw failure('X rate limit reached; wait for the provider retry window.', 'not-sent', 429, retryDelay(response));
      const uncertain = response.status >= 500 || response.status === 408;
      throw failure(uncertain ? 'X delivery outcome is unknown; reconcile before retrying.' : 'X rejected the request. Check account access and posting permissions.', uncertain && method === 'POST' ? 'unknown' : 'rejected', response.status);
    }
    try { return await response.json(); }
    catch { throw failure('X returned an unreadable response; delivery cannot be confirmed.', method === 'POST' ? 'unknown' : 'rejected', response.status); }
  }

  return {
    async verifyAccount({ signal } = {}) {
      // Clear any previous approval before re-verifying a potentially rotated token.
      account = null;
      const result = await request(usingOAuth1 ? '/1.1/account/verify_credentials.json' : '/2/users/me', { signal });
      const user = usingOAuth1 ? { id: result?.id_str, username: result?.screen_name } : result?.data;
      if (!/^\d{1,30}$/.test(user?.id || '') || String(user?.username || '').toLowerCase() !== handle.toLowerCase()
        || (expectedAccountId && user.id !== String(expectedAccountId))) {
        throw failure('X token belongs to a different account than the configured publishing account.', 'rejected');
      }
      account = { id: user.id, handle: user.username };
      return { ...account };
    },
    async publish(event, { signal } = {}) {
      if (!account) throw failure('Verify the publishing account before posting to X.', 'rejected');
      if (typeof event?.text !== 'string' || !event.text.trim() || Buffer.byteLength(event.text, 'utf8') > 280) {
        throw failure('X post text must contain between 1 and 280 UTF-8 bytes.', 'rejected');
      }
      const result = await request('/2/tweets', { method: 'POST', body: { text: event.text }, signal });
      const id = result?.data?.id;
      if (!/^\d{1,30}$/.test(id || '')) throw failure('X did not return a valid post ID; reconcile before retrying.', 'unknown');
      return { id, url: `https://x.com/i/web/status/${id}` };
    },
  };
}
