// Public fee activity contract: collectedLamports/grossLamports are SOL base units.
// Legacy grossCreatorFees is SOL major units. Never infer units from magnitude.
import { formatTokenBaseAmount } from './trade-panel-balance.js';

export function solFromLamports(value) {
  if (typeof value === 'number' && (!Number.isSafeInteger(value) || value < 0)) return null;
  if (!['string','number','bigint'].includes(typeof value) || !/^\d+$/.test(String(value))) return null;
  return formatTokenBaseAmount(value, 9);
}

function legacySol(value) {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0 || value > Number.MAX_SAFE_INTEGER) return null;
    const exact = value.toFixed(9);
    if (Number(exact) !== value) return null;
    value = exact;
  }
  if (typeof value !== 'string' || !/^\d+(\.\d{1,9})?$/.test(value)) return null;
  const [whole, fraction = ''] = value.split('.');
  return solFromLamports(BigInt(whole) * 1_000_000_000n + BigInt(fraction.padEnd(9, '0')));
}

export function feeAllocationSol(item) {
  if (item.asset !== 'SOL' || (Object.hasOwn(item, 'grossCreatorFeesUnit') && item.grossCreatorFeesUnit !== 'SOL')) return null;
  const major = legacySol(item.grossCreatorFees);
  if (!Object.hasOwn(item, 'grossLamports')) return major;
  const base = solFromLamports(item.grossLamports);
  if (Object.hasOwn(item, 'grossCreatorFees') && major !== base) return null;
  return base;
}

export function formatFeeSol(value) {
  if (value == null) return '—';
  const [whole, fraction] = value.split('.');
  const separator = new Intl.NumberFormat().formatToParts(1.1).find(part => part.type === 'decimal')?.value || '.';
  return `${BigInt(whole).toLocaleString()}${fraction ? separator + fraction : ''}`;
}
