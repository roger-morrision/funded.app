export const DEVELOPER_TOKEN_LOCK_SECONDS = 43_200;
export const DEVELOPER_TOKEN_LOCK_PERIODS = Object.freeze([21_600, 43_200, 86_400, 172_800]);

export function normalizeDeveloperLockSeconds(value = DEVELOPER_TOKEN_LOCK_SECONDS) {
  const seconds = Number(value);
  if (!DEVELOPER_TOKEN_LOCK_PERIODS.includes(seconds)) throw Error('Choose a developer token lock of 6h, 12h, 24h or 48h.');
  return seconds;
}

export function readDeveloperLockSeconds(root = document) {
  return normalizeDeveloperLockSeconds(root.querySelector('#creator-buy-lock-period')?.value);
}
