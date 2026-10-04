// Transfers use unsigned 64-bit lamports. JSON can lose precision before this
// code runs, so an unsafe Number must never be converted back into an amount.
const MAX_LAMPORTS = 18_446_744_073_709_551_615n;
export function exactLamports(value) {
  let units;
  if (typeof value === 'bigint') units = value;
  else if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) throw new Error('Invalid SOL amount.');
    units = BigInt(value);
  } else {
    if (typeof value !== 'string' || value.length > 20 || !/^(0|[1-9]\d*)$/.test(value)) throw new Error('Invalid SOL amount.');
    units = BigInt(value);
  }
  if (units < 0n || units > MAX_LAMPORTS) throw new Error('Invalid SOL amount.');
  return units;
}
