import { createHash } from 'node:crypto';
import { MARKETING_AGENCY_POLICY as POLICY, canonicalAgencySelection } from '../config/marketing-agency.js';

export const AGENCY_CONTRACT_BLOCKER = 'The current reviewed V3 agency vault, immutable launch selection, and protected spending must be independently verified.';
export const AGENCY_EXECUTOR_BLOCKER = 'Agency X publishing and own-coin milestone purchase/burn executors are not activated.';
export const agencyPolicyHash = createHash('sha256').update(JSON.stringify(POLICY)).digest('hex');
const unsigned = value => {
  if (typeof value !== 'string' || value.length > 20 || !/^(0|[1-9]\d*)$/.test(value)) throw new Error('An exact unsigned decimal lamport string is required.');
  const n = BigInt(value);
  if (n > 0xffff_ffff_ffff_ffffn) throw new Error('Lamports exceed u64.');
  return n;
};

// A candidate calculation only. Never infer funding from collected fees or
// change an existing mint's saved immutable V3 policy with this projection.
export function projectAgencyAllocation({ totalGrossLamports, previousGrossLamports = '0', selectedAgents = [] }) {
  const total = unsigned(totalGrossLamports), before = unsigned(previousGrossLamports);
  if (before > total) throw new Error('Cumulative gross fees cannot decrease.');
  const selected = canonicalAgencySelection(selectedAgents);
  const rates = [POLICY.creatorUnits, POLICY.operationsUnits, ...POLICY.referralUnits,
    POLICY.communityUnits, POLICY.fundedBuybackUnits, POLICY.agencyUnits];
  if (rates.reduce((sum, n) => sum + n, 0) !== POLICY.grossUnits) throw new Error('Agency policy does not conserve gross fees.');
  const targets = amount => {
    let boundary = 0n, prior = 0n;
    return rates.map(rate => {
      boundary += BigInt(rate);
      const next = amount * boundary / BigInt(POLICY.grossUnits), delta = next - prior;
      prior = next;
      return delta;
    });
  };
  const after = targets(total), prior = targets(before);
  const category = after.map((n, index) => n - prior[index]);
  if (category.some(value => value < 0n)) throw new Error('Accumulate more fees before projecting this cumulative rounding boundary.');
  // Split cumulative agency entitlement, not each receipt independently, to
  // avoid repeated one-lamport receipts always favouring the same agent.
  const agentTargets = budget => selected.map((id, index) => ({ id,
    amount: budget * BigInt(index + 1) / BigInt(selected.length)
      - budget * BigInt(index) / BigInt(selected.length) }));
  const priorAgents = agentTargets(prior[7]);
  return { status: 'projection-not-funded', policyHash: agencyPolicyHash,
    grossLamports: String(total - before), creatorLamports: String(category[0]),
    operationsLamports: String(category[1]), referralLamports: category.slice(2, 5).map(String),
    agencyLamports: String(category[7]), communityLamports: String(category[5]),
    fundedBuybackLamports: String(category[6]),
    agents: agentTargets(after[7]).map((row, index) => ({ id: row.id, lamports: String(row.amount - priorAgents[index].amount) })),
    retainedAgencyLamports: selected.length ? '0' : String(category[7]) };
}

// No environment switch can assert that the current seven-category contract
// enforces an eighth budget. A verified contract/receipt implementation must
// replace this readiness result before execution can be wired into workers.
export function marketingAgencyCapabilities() {
  return { status: 'activation-blocked', active: false, executionEnabled: false,
    policyHash: agencyPolicyHash, policy: POLICY,
    requiredGrossPercent: { creator: 80, operations: 8, referrals: 1, agency: 2, dailyBonus: 4, fundedBuyback: 5 },
    referralGrossPercents: POLICY.referralUnits.map(units=>units*100/POLICY.grossUnits),
    blockers: [AGENCY_CONTRACT_BLOCKER, AGENCY_EXECUTOR_BLOCKER] };
}
