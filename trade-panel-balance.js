export function formatTokenBaseAmount(rawAmount, decimals, fractionDigits = decimals) {
  const raw = BigInt(rawAmount);
  if (raw < 0n || !Number.isInteger(decimals) || decimals < 0 || decimals > 18) throw new RangeError('Invalid token balance.');
  const digits = Math.min(decimals, Math.max(0, fractionDigits));
  const divisor = 10n ** BigInt(decimals);
  const whole = raw / divisor;
  const fraction = (raw % divisor).toString().padStart(decimals, '0').slice(0, digits).replace(/0+$/, '');
  return `${whole}${fraction ? `.${fraction}` : ''}`;
}

export function tokenBalancePercentage(rawAmount, decimals, percentage) {
  if (!Number.isInteger(percentage) || percentage <= 0 || percentage > 100) throw new RangeError('Invalid percentage.');
  return formatTokenBaseAmount(BigInt(rawAmount) * BigInt(percentage) / 100n, decimals);
}
