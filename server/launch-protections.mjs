// These are richpad.fun admission and authority-signing rules, not a token-transfer lock.
import {requireSolanaCluster} from '../solana-network.js';
export const LAUNCH_PROTECTION_MS = 12 * 60 * 60 * 1000;
export const SYMBOL_RESERVATION_MS = 30 * 60 * 1000;
export const symbolKey = value => String(value || '').trim().toUpperCase();
const conflict = message => Object.assign(new Error(message), { statusCode:409 });

export function verifiedLaunchTime(launch) {
  const seconds = launch?.blockTime ?? launch?.createdTimestamp;
  return Number.isSafeInteger(seconds) && seconds > 0 ? seconds * 1000 : null;
}

export function newLaunchProtection(proof) {
  const launchedAt = verifiedLaunchTime(proof);
  if (!launchedAt || launchedAt > Date.now() + 60_000)
    throw conflict('A verified launch timestamp is required for the 12-hour ticker protection.');
  return { version:2, launchedAt:new Date(launchedAt).toISOString(),
    symbolBlockedUntil:new Date(launchedAt + LAUNCH_PROTECTION_MS).toISOString(),
    creatorFeeUnlockAt:null,
    enforcement:'funded-platform-authority' };
}

export function creatorFeeLock() {
  // Retained for older clients and saved v1 records. The creator fee hold is
  // retired for all launches; token custody is enforced by a separate program.
  return { applies:false, locked:false, unlockAt:null };
}

export function assertSymbolAvailable(state, { symbol, mint, cluster='devnet' }, now = Date.now()) {
  requireSolanaCluster(cluster);
  const key = symbolKey(symbol);
  if (!/^[A-Z0-9]{1,10}$/.test(key))
    throw Object.assign(new Error('Ticker must contain 1–10 letters or numbers.'), { statusCode:400 });
  for (const launch of Object.values(state.launches || {})) {
    if (launch.mint === mint || launch.onchainVerified !== true || (launch.cluster||'devnet') !== cluster
      || symbolKey(launch.symbol) !== key) continue;
    const launchedAt = verifiedLaunchTime(launch);
    // Archiving or hiding a coin must not release its ticker early.
    if (launchedAt && now < launchedAt + LAUNCH_PROTECTION_MS)
      throw conflict(`Ticker ${key} is protected until ${new Date(launchedAt + LAUNCH_PROTECTION_MS).toISOString()} (12 hours after launch).`);
  }
  const storageKey=cluster==='devnet'?key:`${cluster}:${key}`;
  const reservation = state.launchSymbolReservations?.[storageKey];
  if (reservation && reservation.mint !== mint && now < reservation.holdUntil)
    throw conflict(`Ticker ${key} is reserved until ${new Date(reservation.holdUntil).toISOString()}. Choose another ticker or retry later.`);
  return storageKey;
}

// Signed metadata reserves a ticker before any wallet transaction. Expired leases
// are released only after an RPC read: a successful launch may be missing its
// registration receipt. RPC failures leave the lease in place (fail closed).
export async function reserveLaunchSymbol({ store, record, mintExists, now = Date.now() }) {
  const snapshot = await store.read();
  const key = assertSymbolAvailable(snapshot, record, now);
  const previous = snapshot.launchSymbolReservations?.[key];
  if ((!previous || previous.mint !== record.mint) && await mintExists(record.mint))
    throw conflict('Ticker reservations require a new mint, not an existing on-chain account.');
  let occupied = false;
  if (previous && !previous.registered && previous.expiresAt <= now && previous.holdUntil <= now)
    occupied = await mintExists(previous.mint);
  return store.update(state => {
    assertSymbolAvailable(state, record, now);
    state.launchSymbolReservations ||= {};
    const current = state.launchSymbolReservations[key];
    if (JSON.stringify(current) !== JSON.stringify(previous))
      throw conflict('Ticker reservation changed. Retry the launch review.');
    if (current && current.expiresAt > now) {
      if (current.mint !== record.mint || current.creatorWallet !== record.creatorWallet)
        throw conflict(`Ticker ${key} is reserved by another launch.`);
      return current;
    }
    // Conservatively retain a confirmed but unregistered mint for the full
    // cooldown after its lease deadline. Normal registration uses block time.
    if (current && occupied && now < current.expiresAt + LAUNCH_PROTECTION_MS)
      throw conflict(`Ticker ${key} has an on-chain launch awaiting registration. Retry after ${new Date(current.expiresAt + LAUNCH_PROTECTION_MS).toISOString()}.`);
    const launch=state.launches?.[record.mint];
    if (launch&&(launch.cluster||'devnet')===(record.cluster||'devnet')) throw conflict('This mint is already launched. Recover its saved launch receipt.');
    return state.launchSymbolReservations[key] = { mint:record.mint, creatorWallet:record.creatorWallet,
      reservedAt:now, expiresAt:now + SYMBOL_RESERVATION_MS, holdUntil:now + SYMBOL_RESERVATION_MS };
  });
}

export function registerLaunchProtection(state, record, now = Date.now()) {
  const key = assertSymbolAvailable(state, record, now);
  const reservation = state.launchSymbolReservations?.[key];
  if (reservation && !reservation.registered && reservation.mint !== record.mint && now < reservation.expiresAt + LAUNCH_PROTECTION_MS)
    throw conflict(`Ticker ${key} belongs to another launch reservation. Recover that launch or choose another ticker.`);
  state.launchSymbolReservations ||= {};
  state.launchSymbolReservations[key] = { mint:record.mint, creatorWallet:record.creatorWallet,
    registered:true, reservedAt:verifiedLaunchTime(record), expiresAt:Date.parse(record.launchProtection.symbolBlockedUntil),
    holdUntil:Date.parse(record.launchProtection.symbolBlockedUntil) };
}
