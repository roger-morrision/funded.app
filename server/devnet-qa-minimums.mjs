export const STANDARD_BUYBACK_TRIGGER_LAMPORTS = 5_000_000_000n;

export const QA_HOLDER_POLICY = 'usd-qa-hourly-v1';

// Apply a smaller holder threshold to one disposable Devnet mint only. The
// values are copied into the reward program so later env changes cannot alter
// the eligibility rule for a prepared cycle.
export function qaHolderMinimums(mint, cluster, env = process.env) {
  if (env.FUNDED_DEVNET_QA_MINIMUMS_ENABLED !== 'true'
    || env.FUNDED_DEVNET_QA_HOLDER_MINT !== mint) return null;
  if (cluster !== 'devnet')
    throw new Error('Devnet QA holder minimums cannot be enabled outside Devnet.');
  const integer = (key, lower, upper) => {
    const raw = String(env[key] || '');
    if (!/^[1-9]\d*$/.test(raw)) throw new Error(`${key} must be a positive integer.`);
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value < lower || value > upper)
      throw new Error(`${key} is outside the bounded Devnet QA range.`);
    return value;
  };
  return {
    minimumHolderUsd:integer('FUNDED_DEVNET_QA_HOLDER_MIN_USD', 1, 19),
    minimumPoolUsd:integer('FUNDED_DEVNET_QA_HOLDER_POOL_MIN_USD', 1, 19),
    minimumFundingLamports:integer('FUNDED_DEVNET_QA_HOLDER_MIN_LAMPORTS', 1_000_000, 9_999_999),
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
  if (amount < 10_000_000n || amount > 100_000_000n)
    throw new Error('Devnet QA buyback trigger must be between 0.01 and 0.1 SOL.');
  return amount;
}
