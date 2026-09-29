const X_USERNAME = /^[A-Za-z0-9_]{1,15}$/;
const RETRYABLE_STATUS = new Set([500, 502, 503, 504]);

export function createXUserResolver({ getBearerToken, fetchUser = fetch, pause = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
  return async function resolveXUser(handle) {
    const username = String(handle || '').trim().replace(/^@/, '');
    if (!X_USERNAME.test(username)) throw new Error('Enter a valid X handle such as @account.');
    const bearer = String(getBearerToken() || '').trim();
    if (!bearer) throw new Error('X account lookup is not configured. Contact the funded.vip operator.');

    for (let attempt = 0; attempt < 2; attempt += 1) {
      let response;
      try {
        response = await fetchUser(`https://api.x.com/2/users/by/username/${encodeURIComponent(username)}`, {
          headers: { authorization: `Bearer ${bearer}` },
          signal: AbortSignal.timeout(8000),
        });
      } catch {
        if (attempt === 0) { await pause(350); continue; }
        throw new Error('X account lookup timed out or lost its connection. Retry the launch; no coin transaction was sent.');
      }

      const payload = await response.json().catch(() => ({}));
      if (response.ok) {
        const id = String(payload.data?.id || '');
        const returnedUsername = String(payload.data?.username || '');
        if (!/^\d{1,24}$/.test(id) || returnedUsername.toLowerCase() !== username.toLowerCase()) {
          throw new Error(`X returned an unexpected identity for @${username}. Retry the launch; no coin transaction was sent.`);
        }
        return { handle: `@${returnedUsername}`, id };
      }

      if (RETRYABLE_STATUS.has(response.status) && attempt === 0) { await pause(350); continue; }
      if (response.status === 404) throw new Error(`X account @${username} was not found. Check the handle and retry; no coin transaction was sent.`);
      if (response.status === 429) throw new Error('X account lookup is rate limited. Retry shortly; no coin transaction was sent.');
      if (response.status === 402) throw new Error('X API credits are unavailable for account lookup. Contact the funded.vip operator; no coin transaction was sent.');
      if (response.status === 401 || response.status === 403) throw new Error('X account lookup credentials were rejected. Contact the funded.vip operator; no coin transaction was sent.');
      throw new Error(`X account lookup failed (${response.status}). Retry the launch; no coin transaction was sent.`);
    }
  };
}
