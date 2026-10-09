import { airdropClaimState } from '../../../airdrop-directory-model.js';

export const formatTokens = value => Number(value).toLocaleString(undefined, { maximumFractionDigits:0 });

export const safeLamports = value => /^(?:0|[1-9]\d*)$/.test(String(value));

export const solAmount = value => {
  const amount = BigInt(value);
  return `${amount / 1_000_000_000n}.${String(amount % 1_000_000_000n).padStart(9, '0').replace(/0+$/, '') || '0'} SOL`;
};

export const claimedTokenAmount = (reserve, launch) => {
  if (!safeLamports(reserve.claimedBaseUnits) || !safeLamports(reserve.totalBaseUnits)) return null;
  const planned = BigInt(launch.communityAirdrop.reservedTokens);
  const total = BigInt(reserve.totalBaseUnits), claimed = BigInt(reserve.claimedBaseUnits);
  if (planned <= 0n || total <= 0n || total % planned !== 0n || claimed > total) return null;
  const scale = total / planned;
  if (scale > 1_000_000_000n || !/^10*$/.test(String(scale))) return null;
  const whole = (claimed / scale).toLocaleString();
  const fraction = scale === 1n ? '' : String(claimed % scale).padStart(String(scale).length - 1, '0').replace(/0+$/, '');
  return `${whole}${fraction ? '.' + fraction : ''} ${launch.symbol || 'tokens'}`;
};

export const airdropFinished = (reserve, nowSeconds) => {
  if (airdropClaimState(reserve, nowSeconds).status === 'closed') return true;
  return reserve?.status === 'drop-active'
    && safeLamports(reserve.totalBaseUnits) && safeLamports(reserve.claimedBaseUnits)
    && BigInt(reserve.totalBaseUnits) > 0n
    && BigInt(reserve.claimedBaseUnits) === BigInt(reserve.totalBaseUnits);
};

export const utcMoment = value => {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? `${new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(date)} UTC`
    : '—';
};
