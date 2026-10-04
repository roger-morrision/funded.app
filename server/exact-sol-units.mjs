// Convert canonical decimal SOL to exact, safely comparable RPC balance units.
// Numbers use their canonical decimal spelling, including its exponent; binary
// multiplication and rounding must never invent or discard a lamport.
export function exactSolLamports(value) {
  const numeric = typeof value === 'number';
  if ((!numeric && typeof value !== 'string') || (numeric && (!Number.isFinite(value) || value < 0))) throw new Error('Exact SOL amount unavailable.');
  const text = String(value);
  const match = text.length <= 64 && /^(0|[1-9]\d*)(?:\.(\d+))?(?:e([+-]?\d+))?$/.exec(text);
  if (!match || (!numeric && match[3] != null)) throw new Error('Exact SOL amount unavailable.');
  const fraction = match[2] || '', exponent = Number(match[3] || 0);
  const scale = 9 + exponent - fraction.length;
  if (!Number.isInteger(scale) || Math.abs(scale) > 400) throw new Error('Exact SOL amount unavailable.');
  let units = BigInt(match[1] + fraction);
  if (scale >= 0) units *= 10n ** BigInt(scale);
  else {
    const divisor = 10n ** BigInt(-scale);
    if (units % divisor !== 0n) throw new Error('Exact SOL amount unavailable.');
    units /= divisor;
  }
  if (units > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Exact SOL amount unavailable.');
  return units.toString();
}
