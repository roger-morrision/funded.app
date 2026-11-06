const validList = list => Array.isArray(list) && list.length <= 200 && list.every(mint => typeof mint === 'string' && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint));
const validAccount = value => /^\d{1,24}$/.test(value) || /^wallet:[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value);
const guestMessage = 'Verify a wallet or sign in with X to sync favorites across devices.';

export function createWatchlistSync({ request, onChange = () => {}, onStatus = () => {} }) {
  let accountId, mints = [], csrf = '', ready = false, epoch = 0;
  let queue = Promise.resolve();
  function publish() { onChange([...mints]); }
  function schedule(work) {
    const operation = queue.then(work);
    queue = operation.catch(() => {});
    return operation;
  }
  async function api(options, expected) {
    let response;try{response = await request(`/api/watchlist?accountId=${encodeURIComponent(expected)}`, { credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(18000), ...options });}catch(error){if(error instanceof TypeError||error?.name==='TimeoutError')throw new Error('Favorites sync is unavailable. Check your connection and retry.');throw error;}
    if (!response.available || !validList(response.data?.mints)) throw new Error('Favorites sync is unavailable. Try again.');
    if (response.data.accountId !== expected) throw new Error('Your account changed. Sign in again to load its favorites.');
    return response.data;
  }
  async function load(expected, generation) {
    try {
      onStatus('syncing', 'Syncing favorites…');
      const data = await api({}, expected);
      if (generation !== epoch) return false;
      csrf = data.csrf;
      mints = data.mints;
      ready = true;
      publish();
      onStatus('synced', 'Favorites synced to your account.');
      return true;
    } catch (error) {
      if (generation === epoch) { ready = false; onStatus('error', error.message); }
      return false;
    }
  }
  return {
    get() { return [...mints]; },
    identity() { return accountId; },
    setIdentity(next) {
      if (next !== null && next !== undefined && !validAccount(next)) next = undefined;
      if (next === accountId && ready) return Promise.resolve(true);
      accountId = next; csrf = ''; ready = false; mints = [];
      const generation = ++epoch;
      if (next === null) {
        publish();
        onStatus('guest', guestMessage);
        return Promise.resolve(false);
      }
      publish();
      if (next === undefined) { onStatus('checking', 'Checking sign-in before loading favorites.'); return Promise.resolve(false); }
      return schedule(() => generation === epoch ? load(next, generation) : false);
    },
    refresh() {
      const expected = accountId, generation = epoch;
      if (!expected) return Promise.resolve(false);
      return schedule(() => generation === epoch ? load(expected, generation) : false);
    },
    save(mint, remove) {
      const expected = accountId, generation = epoch;
      return schedule(async () => {
        if (generation !== epoch) return false;
        try {
          if (!validList([mint])) throw new Error('Invalid token address.');
          if (!ready) {
            if (!expected || !await load(expected, generation)) throw new Error('Favorites could not be synced. Sign in or retry before saving.');
          }
          if (generation !== epoch) return false;
          {
            onStatus('syncing', 'Saving favorites…');
            const data = await api({ method: 'POST', headers: { 'x-watchlist-csrf': csrf }, body: {
              accountId: expected, action: remove ? 'remove' : 'add', mint,
            } }, expected);
            if (generation !== epoch) return false;
            mints = data.mints;
          }
          publish();
          onStatus(expected ? 'synced' : 'guest', expected ? 'Favorites synced to your account.' : guestMessage);
          return true;
        } catch (error) {
          if (generation === epoch) onStatus('error', error.message);
          return false;
        }
      });
    },
  };
}
