const validList = list => Array.isArray(list) && list.length <= 200 && list.every(mint => typeof mint === 'string' && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint));
const validAccount = value => /^\d{1,24}$/.test(value) || /^wallet:[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value);
const guestMessage = 'Saved on this device. Verify a wallet or sign in with X to sync favorites across devices.';
// Without an account, favorites live in this browser; the first account that
// loads afterwards receives them (added once, then the local copy is cleared).
const GUEST_KEY = 'richpad.favorites.guest';
const defaultGuestStore = {
  read() { try { const list = JSON.parse(globalThis.localStorage?.getItem(GUEST_KEY) || '[]'); return validList(list) ? list : []; } catch { return []; } },
  write(list) { try { if (list.length) globalThis.localStorage?.setItem(GUEST_KEY, JSON.stringify(list)); else globalThis.localStorage?.removeItem(GUEST_KEY); } catch {} },
};

export function createWatchlistSync({ request, onChange = () => {}, onStatus = () => {}, guestStore = defaultGuestStore }) {
  let accountId, mints = guestStore.read(), csrf = '', ready = false, epoch = 0, loading = null;
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
      const guest = guestStore.read().filter(mint => !mints.includes(mint));
      for (const mint of guest) {
        try {
          const merged = await api({ method: 'POST', headers: { 'x-watchlist-csrf': csrf }, body: { accountId: expected, action: 'add', mint } }, expected);
          if (generation !== epoch) return false;
          mints = merged.mints;
        } catch { break; }
      }
      if (guest.every(mint => mints.includes(mint))) guestStore.write([]);
      publish();
      onStatus('synced', 'Favorites synced to your account.');
      return true;
    } catch (error) {
      if (generation === epoch) { ready = false; onStatus('error', 'Favorites sync is unavailable. Try again.'); }
      return false;
    }
  }
  return {
    get() { return [...mints]; },
    identity() { return accountId; },
    setIdentity(next) {
      if (next !== null && next !== undefined && !validAccount(next)) next = undefined;
      if (next === accountId && ready) return Promise.resolve(true);
      // Wallet connect, session restore and an explicit verify can all name the
      // same account at once; restarting the load would cancel the caller that
      // is waiting to save, so they share the load already in flight.
      if (next === accountId && loading) return loading;
      accountId = next; csrf = ''; ready = false; mints = next ? [] : guestStore.read(); loading = null;
      const generation = ++epoch;
      if (next === null) {
        publish();
        onStatus('guest', guestMessage);
        return Promise.resolve(false);
      }
      publish();
      if (next === undefined) { onStatus('checking', 'Checking sign-in before loading favorites.'); return Promise.resolve(false); }
      const pending = schedule(() => generation === epoch ? load(next, generation) : false);
      loading = pending;
      pending.finally(() => { if (loading === pending) loading = null; }).catch(() => {});
      return pending;
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
          if (!expected) {
            // No account yet: keep the favorite in this browser.
            const list = guestStore.read().filter(item => item !== mint);
            if (!remove) list.unshift(mint);
            guestStore.write(list.slice(0, 200)); mints = list.slice(0, 200);
            publish(); onStatus('guest', guestMessage);
            return true;
          }
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
