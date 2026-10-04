import { PILOT_STORAGE_KEY, PILOT_CONSENT_KEY, normalizePilotRecord } from './pilot-metrics-model.js';

export const PILOT_DB_NAME = 'funded-pilot-local';
export const PILOT_DB_STORE = 'state';
export const PILOT_DB_KEY = 'record-and-consent';
const unavailable = () => new Error('Device storage is unavailable. Recording and export stopped.');

export function pilotLegacySnapshot(encoded, grant) {
  let raw;
  try { raw = JSON.parse(encoded || 'null'); } catch {}
  const record = normalizePilotRecord(raw);
  const consented = record && (grant === record.participantId || grant === null && raw.version !== 2);
  return { version:1, record:consented ? JSON.stringify(record) : null,
    grant:consented ? record.participantId : 'off', consentEpoch:0 };
}

export function pilotStorageSnapshot(value) {
  if (!value || value.version !== 1 || value.record !== null && typeof value.record !== 'string'
    || value.grant !== null && typeof value.grant !== 'string'
    || !Number.isSafeInteger(value.consentEpoch ?? 0) || (value.consentEpoch ?? 0) < 0) throw unavailable();
  return { version:1, record:value.record, grant:value.grant, consentEpoch:value.consentEpoch ?? 0 };
}

// IndexedDB serializes these readwrite transactions across browser renderers.
// Web Locks around localStorage do not make its per-renderer caches coherent.
export function createPilotStorage({ indexedDB = globalThis.indexedDB,
  legacyStorage = { getItem:key => globalThis.localStorage.getItem(key),
    setItem:(key,value) => globalThis.localStorage.setItem(key,value),
    removeItem:key => globalThis.localStorage.removeItem(key) }, timeoutMs = 10_000 } = {}) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30_000) throw new Error('Invalid pilot storage timeout.');
  let opened, closed = false, active = null;
  const field = key => {
    if (!active) throw new Error('Pilot storage is accessible only inside its transaction.');
    if (key === PILOT_STORAGE_KEY) return 'record';
    if (key === PILOT_CONSENT_KEY) return 'grant';
    throw new Error('Unsupported pilot storage key.');
  };
  const storage = {
    getItem:key => active[field(key)],
    setItem(key,value) { if (typeof value !== 'string') throw new Error('Pilot storage values must be strings.'); active[field(key)] = value; },
    removeItem(key) { active[field(key)] = null; },
  };
  async function open() {
    if (closed) throw unavailable();
    if (!opened) opened = new Promise((resolve,reject) => {
      let request, settled = false;
      const finish = (error,db) => { if (settled) { db?.close(); return; } settled = true; clearTimeout(timer); error ? reject(error) : resolve(db); };
      const timer = setTimeout(() => finish(unavailable()), timeoutMs);
      try {
        request = indexedDB.open(PILOT_DB_NAME,1);
        request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains(PILOT_DB_STORE)) request.result.createObjectStore(PILOT_DB_STORE); };
        request.onerror = () => finish(unavailable());
        request.onblocked = () => finish(unavailable());
        request.onsuccess = () => {
          const db = request.result;
          db.onversionchange = () => { closed = true; db.close(); };
          if (closed) { db.close(); finish(unavailable()); } else finish(null,db);
        };
      } catch { finish(unavailable()); }
    });
    return opened;
  }
  function clearLegacy() {
    let failed = false;
    // Leave an off marker for already-open legacy tabs. New code never uses
    // this marker as its authority once the IndexedDB snapshot exists.
    try { legacyStorage.setItem(PILOT_CONSENT_KEY,'off'); } catch { failed = true; }
    try { legacyStorage.removeItem(PILOT_STORAGE_KEY); } catch { failed = true; }
    return failed;
  }
  return {
    storage,
    async run(action, {clearLegacy: deleting = false, revoke = false, expectedConsentEpoch} = {}) {
      if (typeof action !== 'function') throw new Error('A synchronous pilot storage action is required.');
      if (expectedConsentEpoch !== undefined && (!Number.isSafeInteger(expectedConsentEpoch) || expectedConsentEpoch < 0)) throw new Error('Invalid pilot consent epoch.');
      const db = await open();
      if (closed) throw unavailable();
      return new Promise((resolve,reject) => {
        let transaction, callbackError, value, consentEpoch, processed = false, changed = false, settled = false;
        const finish = (error,result) => { if (settled) return; settled = true; clearTimeout(timer); error ? reject(error) : resolve(result); };
        const timer = setTimeout(() => { try { transaction?.abort(); } catch {} finish(unavailable()); },timeoutMs);
        try {
          transaction = db.transaction(PILOT_DB_STORE,'readwrite');
          transaction.onabort = () => finish(callbackError || unavailable());
          transaction.onerror = () => {}; // The abort event decides the outcome.
          transaction.oncomplete = () => {
            if (settled) return;
            if (!processed) { finish(unavailable()); return; }
            finish(null,{value,changed,consentEpoch,legacyCleanupFailed:clearLegacy()});
          };
          const table = transaction.objectStore(PILOT_DB_STORE);
          const request = table.get(PILOT_DB_KEY);
          request.onsuccess = () => {
            try {
              let snapshot = request.result;
              const migrating = snapshot === undefined;
              if (migrating) snapshot = deleting ? pilotLegacySnapshot(null,'off')
                : pilotLegacySnapshot(legacyStorage.getItem(PILOT_STORAGE_KEY),legacyStorage.getItem(PILOT_CONSENT_KEY));
              active = pilotStorageSnapshot(snapshot);
              if (expectedConsentEpoch !== undefined && expectedConsentEpoch !== active.consentEpoch) throw Object.assign(
                new Error('Pilot consent changed in another tab. Review the current record before enabling recording again.'), {code:'PILOT_CONSENT_CHANGED'});
              const before = JSON.stringify(active);
              value = action();
              if (value && typeof value.then === 'function') throw new Error('Pilot storage actions must be synchronous.');
              const after = pilotStorageSnapshot(active);
              // A revocation fences earlier opt-in intentions even when no
              // record existed and cross-tab notifications are delayed/lost.
              if (revoke) {
                if (after.consentEpoch === Number.MAX_SAFE_INTEGER) throw unavailable();
                after.consentEpoch++;
              }
              consentEpoch = after.consentEpoch;
              changed = migrating || JSON.stringify(after) !== before;
              if (changed) table.put(after,PILOT_DB_KEY);
              processed = true;
            } catch (error) {
              callbackError = error instanceof Error && !(error instanceof DOMException) ? error : unavailable();
              try { transaction.abort(); } catch { finish(callbackError); }
            } finally { active = null; }
          };
        } catch { try { transaction?.abort(); } catch {} finish(unavailable()); }
      });
    },
    close() { closed = true; if (opened) void opened.then(db => db.close(),() => {}); },
  };
}
