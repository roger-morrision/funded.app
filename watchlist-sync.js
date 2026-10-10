const CACHE = 'funded.app.community.watchlist';
const OWNER = 'funded.app.watchlist.cache-owner.v1';
const GUEST = 'funded.app.watchlist.guest.v1';
const validList = list => Array.isArray(list) && list.length <= 200 && list.every(mint => typeof mint === 'string' && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint));
const validAccount = value => /^\d{1,24}$/.test(value) || /^wallet:[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value);
const guestMessage = 'Verify a wallet or sign in with X to sync favorites across devices.';

export function createWatchlistSync({ request, storage, onChange = () => {}, onStatus = () => {} }) {
  let accountId, mints = [], csrf = '', ready = false, epoch = 0;
  let queue = Promise.resolve();
  let guestPrepared = false;
  const emptyGuest = () => ({ mints: [], importId: crypto.randomUUID(), targetAccount: null });
  function writeGuest(row) {
    storage.setItem(GUEST, JSON.stringify(row));
    if (storage.getItem(GUEST) !== JSON.stringify(row)) throw new Error('Browser favorites could not be saved.');
  }
  function readGuest() {
    const raw = storage.getItem(GUEST);
    if (raw) {
      const row = JSON.parse(raw);
      if (!validList(row.mints) || !/^[a-f0-9-]{36}$/.test(row.importId || '')) throw new Error('Browser favorites could not be read.');
      return row;
    }
    const row = emptyGuest();
    // The legacy key also mirrors account data; only migrate genuine guest data.
    if (!storage.getItem(OWNER)) {
      const legacy = JSON.parse(storage.getItem(CACHE) || '[]');
      if (!validList(legacy)) throw new Error('Browser favorites could not be read.');
      row.mints = [...new Set(legacy)];
    }
    writeGuest(row);
    return row;
  }
  function publish() {
    try {
      if (!guestPrepared) throw new Error('Guest favorites have not been preserved yet.');
      storage.setItem(OWNER, accountId || 'guest');
      storage.setItem(CACHE, JSON.stringify(mints));
    } catch { /* Account favorites remain available without browser storage. */ }
    onChange([...mints]);
  }
  function schedule(work) {
    const operation = queue.then(work);
    queue = operation.catch(() => {});
    return operation;
  }
  async function api(options, expected) {
    const response = await request(`/api/watchlist?accountId=${encodeURIComponent(expected)}`, { credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(18000), ...options });
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
      let guest;
      try { guest = readGuest(); } catch { /* Account reads do not require local storage. */ }
      if (guest?.mints.length && (!guest.targetAccount || guest.targetAccount === expected)) {
        // Bind a pending import before sending it. Retries cannot migrate into a different account.
        guest.targetAccount = expected;
        writeGuest(guest);
        const imported = await api({ method: 'POST', headers: { 'x-watchlist-csrf': csrf }, body: {
          accountId: expected, action: 'import', mints: guest.mints, importId: guest.importId,
        } }, expected);
        if (generation !== epoch) return false;
        mints = imported.mints;
        if (JSON.stringify(readGuest()) === JSON.stringify(guest)) writeGuest(emptyGuest());
      }
      ready = true;
      publish();
      onStatus('synced', 'Favorites synced to your account.');
      return true;
    } catch (error) {
      if (generation === epoch) { ready = false; onStatus('error', error.message); }
      return false;
    }
  }
  try { readGuest(); guestPrepared = true; } catch { /* Preserve unreadable legacy storage for recovery. */ }
  return {
    get() { return [...mints]; },
    identity() { return accountId; },
    setIdentity(next) {
      if (next !== null && next !== undefined && !validAccount(next)) next = undefined;
      if (next === accountId && ready) return Promise.resolve(true);
      accountId = next; csrf = ''; ready = false; mints = [];
      const generation = ++epoch;
      if (next === null) {
        try { mints = readGuest().mints; ready = true; }
        catch (error) { onStatus('error', error.message); publish(); return Promise.resolve(false); }
        publish();
        onStatus('guest', guestMessage);
        return Promise.resolve(true);
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
          if (expected === null) {
            const guest = readGuest();
            guest.mints = remove ? guest.mints.filter(item => item !== mint) : [...new Set([...guest.mints, mint])];
            guest.importId = crypto.randomUUID();
            if (!validList(guest.mints)) throw new Error('You can save up to 200 favorite tokens.');
            writeGuest(guest);
            mints = guest.mints;
          } else {
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
