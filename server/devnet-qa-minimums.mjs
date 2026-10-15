export const STANDARD_BUYBACK_TRIGGER_LAMPORTS = 5_000_000_000n;

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
