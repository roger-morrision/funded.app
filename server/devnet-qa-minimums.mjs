export const STANDARD_BUYBACK_TRIGGER_LAMPORTS = 5_000_000_000n;

export const QA_HOLDER_POLICY = 'usd-qa-hourly-v1';
export const STANDARD_FEE_COLLECTION_MINIMUM_LAMPORTS = 10_000_000n;

export function qaMintSelected(mint, cluster, env = process.env,
  plural = 'FUNDED_DEVNET_QA_HOLDER_MINTS', singular = 'FUNDED_DEVNET_QA_HOLDER_MINT',
  enabled = 'FUNDED_DEVNET_QA_MINIMUMS_ENABLED') {
  if (env[enabled] !== 'true') return false;
  const configured = [String(env[singular] || ''), ...String(env[plural] || '').split(',')]
    .map(value => value.trim()).filter(Boolean);
  if (!configured.length) return false;
  if (cluster !== 'devnet') throw new Error('Devnet QA mint selection cannot be enabled outside Devnet.');
  if (configured.length > 8 || configured.some(value => !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value)))
    throw new Error('Devnet QA mint allowlist must contain at most eight Solana addresses.');
  return configured.includes(String(mint));
}

export function qaShortHolderMintSelected(mint, cluster, env = process.env) {
  return qaMintSelected(mint, cluster, env, 'FUNDED_QA_HOLDER_MINTS',
    'FUNDED_QA_HOLDER_MINT', 'FUNDED_QA_SHORT_REWARD_PERIODS');
}

export function feeCollectionMinimumLamports(mint, cluster, env = process.env) {
  if (!qaMintSelected(mint, cluster, env))
    return STANDARD_FEE_COLLECTION_MINIMUM_LAMPORTS;
  const raw = String(env.FUNDED_DEVNET_QA_FEE_COLLECTION_MIN_LAMPORTS || '');
  if (!/^[1-9]\d*$/.test(raw))
    throw new Error('A positive Devnet QA fee collection minimum is required.');
  const amount = BigInt(raw);
  if (amount < 100_000n || amount >= STANDARD_FEE_COLLECTION_MINIMUM_LAMPORTS)
    throw new Error('Devnet QA fee collection minimum must be between 0.0001 and 0.01 SOL.');
  return amount;
}

// Apply a smaller holder threshold to one disposable Devnet mint only. The
// values are copied into the reward program so later env changes cannot alter
// the eligibility rule for a prepared cycle.
export function qaHolderMinimums(mint, cluster, env = process.env) {
  if (!qaMintSelected(mint, cluster, env)) return null;
  const integer = (key, lower, upper) => {
    const raw = String(env[key] || '');
    if (!/^[1-9]\d*$/.test(raw)) throw new Error(`${key} must be a positive integer.`);
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value < lower || value > upper)
      throw new Error(`${key} is outside the bounded Devnet QA range.`);
    return value;
  };
  const holderRaw = String(env.FUNDED_DEVNET_QA_HOLDER_MIN_USD || '');
  if (!/^(?:0\.\d{1,2}|[1-9]\d?(?:\.\d{1,2})?)$/.test(holderRaw))
    throw new Error('FUNDED_DEVNET_QA_HOLDER_MIN_USD must use at most two decimal places.');
  const holderCents = Math.round(Number(holderRaw) * 100);
  if (holderCents < 1 || holderCents > 1999)
    throw new Error('FUNDED_DEVNET_QA_HOLDER_MIN_USD is outside the bounded Devnet QA range.');
  const poolRaw = String(env.FUNDED_DEVNET_QA_HOLDER_POOL_MIN_USD || '');
  if (!/^(?:0\.\d{1,3}|[1-9]\d?(?:\.\d{1,3})?)$/.test(poolRaw))
    throw new Error('FUNDED_DEVNET_QA_HOLDER_POOL_MIN_USD must use at most three decimal places.');
  const poolMillis = Math.round(Number(poolRaw) * 1000);
  if (poolMillis < 1 || poolMillis > 19999)
    throw new Error('FUNDED_DEVNET_QA_HOLDER_POOL_MIN_USD is outside the bounded Devnet QA range.');
  return {
    minimumHolderUsd:holderCents / 100,
    minimumPoolUsd:poolMillis / 1000,
    minimumFundingLamports:integer('FUNDED_DEVNET_QA_HOLDER_MIN_LAMPORTS', 10_000, 9_999_999),
  };
}

// This is an application execution gate, not a change to the V3 fee split.
// A low trigger is available only for the disposable Devnet QA deployment.
export function buybackTriggerLamports(cluster, env = process.env) {
  if (env.FUNDED_DEVNET_QA_MINIMUMS_ENABLED !== 'true')
    return STANDARD_BUYBACK_TRIGGER_LAMPORTS;
  if (cluster !== 'devnet')
    throw new Error('Devnet QA minimums cannot be enabled outside Devnet.');
  const raw = String(env.FUNDED_DEVNET_QA_BUYBACK_TRIGGER_LAMPORTS || '');
  if (!/^[1-9]\d*$/.test(raw))
    throw new Error('A positive Devnet QA buyback trigger in lamports is required.');
  const amount = BigInt(raw);
  if (amount < 100_000n || amount > 100_000_000n)
    throw new Error('Devnet QA buyback trigger must be between 0.0001 and 0.1 SOL.');
  return amount;
}
