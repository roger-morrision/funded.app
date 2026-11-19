// File stores retain their serialized compatibility path. PostgreSQL performs
// the same mutation against only the selected boost's records.
export const readBoostState = (store, scope) => typeof store.readBoostState === 'function' ? store.readBoostState(scope) : store.read();
export const updateBoostState = (store, scope, mutate) => typeof store.updateBoostState === 'function' ? store.updateBoostState(scope, mutate) : store.update(mutate);
