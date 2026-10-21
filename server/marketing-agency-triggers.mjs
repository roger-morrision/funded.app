import {DEFAULT_AGENCY_RULES,validateAgencyRules} from '../config/agency-rules.js';
import { PublicKey } from '@solana/web3.js';
import { MARKETING_AGENCY_POLICY as POLICY, canonicalAgencySelection } from '../config/marketing-agency.js';

const integer = value => typeof value === 'string' && value.length <= 30 && /^(0|[1-9]\d*)$/.test(value);
const key = value => { try { return new PublicKey(value).toBase58() === value; } catch { return false; } };

// Scheduler decision only, never an execution authorization. Production must
// derive this observation from finalized pool state and a fresh USD oracle,
// then verify protected funding and burn receipts independently.
export function evaluateAgencyTrigger({ mint, agentId, selectedAgents, budgetLamports,
  observation, execution = null, now = Date.now(), rules = DEFAULT_AGENCY_RULES }) {
  rules=validateAgencyRules(rules);
  if (!key(mint)) throw new Error('A canonical launched mint is required.');
  const selected = canonicalAgencySelection(selectedAgents);
  const agent = POLICY.agents.find(row => row.id === agentId);
  if (!agent || !selected.includes(agentId)) return { status: 'not-selected' };
  let promotionSequence=0;
  if (execution != null) {
    if (execution.mint !== mint || execution.agentId !== agentId) throw new Error('Agency execution belongs to another mint or agent.');
    // Submitted, ambiguous, or failed delivery cannot be treated as fresh;
    // reconcile the same durable intent before any new spend or public post.
    if (execution.status !== 'finalized' || execution.receiptVerified !== true) return { status: 'reconciliation-required' };
    if(agent.kind!=='x-post')return {status:'completed'};
    if(execution.billingVerified!==true)return {status:'awaiting-verified-billing'};
    const completed=Date.parse(execution.completedAt);
    if(!Number.isSafeInteger(now)||!Number.isSafeInteger(completed)||completed>now
      ||!Number.isSafeInteger(execution.sequence)||execution.sequence<0||execution.sequence>=0xffff_ffff)
      return {status:'reconciliation-required'};
    const nextEligibleAt=completed+rules.promotionIntervalSeconds*1000;
    if(now<nextEligibleAt)return {status:'cooldown',nextEligibleAt:new Date(nextEligibleAt).toISOString()};
    promotionSequence=execution.sequence+1;
  }
  if (!integer(budgetLamports) || BigInt(budgetLamports) > 0xffff_ffff_ffff_ffffn) throw new Error('An exact agency budget is required.');
  if (BigInt(budgetLamports) === 0n) return { status: 'awaiting-funding' };
  const intentId = `agency:${POLICY.version}:${mint}:${agentId}${agent.kind==='x-post'?`:${promotionSequence}`:''}`;
  if (agent.kind === 'x-post') return { status: 'candidate', intentId, kind: agent.kind,
    sequence:promotionSequence,billAfter:POLICY.promotionBilling,
    maxDebitLamports: budgetLamports, executionAuthorized: false };
  const age = now - Date.parse(observation?.observedAt);
  if (observation?.mint !== mint || observation?.cluster !== 'devnet'
    || observation?.commitment !== 'finalized' || !Number.isSafeInteger(observation.slot) || observation.slot < 1
    || !Number.isSafeInteger(now) || !Number.isFinite(age) || age < 0 || age > POLICY.maxObservationAgeMs
    || observation.quoteCurrency !== 'USD' || !integer(observation.marketCapUsdMicros)) {
    return { status: 'awaiting-verified-market-cap' };
  }
  const thresholdUsd=rules.marketCapUsd[POLICY.agents.indexOf(agent)-1];
  const threshold = BigInt(thresholdUsd) * 1_000_000n;
  if (BigInt(observation.marketCapUsdMicros) < threshold) return { status: 'below-threshold', thresholdUsd };
  return { status: 'candidate', intentId, kind: agent.kind, mint,
    thresholdUsd, maxDebitLamports: budgetLamports,
    observationSlot: observation.slot, executionAuthorized: false };
}
