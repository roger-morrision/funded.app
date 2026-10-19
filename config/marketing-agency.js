// Approved next-launch policy. This is a candidate, not the active V3 fee split.
// Activation requires a dedicated on-chain agency budget and verified executors.
export const MARKETING_AGENCY_POLICY = Object.freeze({
  version: 'marketing-agency-v1',
  scope: 'every-new-launch',
  grossUnits: 10_000_000,
  creatorUnits: 8_000_000,
  operationsUnits: 800_000,
  referralUnits: Object.freeze([66_670, 20_000, 13_330]),
  agencyUnits: 200_000,
  communityUnits: 400_000,
  fundedBuybackUnits: 500_000,
  budgetSplit: 'equal-selected-agents',
  unselectedBudget: 'retain-in-agency-reserve',
  maxObservationAgeMs: 60_000,
  agents: Object.freeze([
    Object.freeze({ id: 'x-promotion', name: 'Agent 1 · X promotion', kind: 'x-post', marketCapUsd: null,
      description: 'Publish a project promotion from the funded.vip X account after its launch and agency funding are verified.' }),
    Object.freeze({ id: 'buyback-100k', name: 'Agent 2 · $100k buyback', kind: 'buyback-burn', marketCapUsd: 100_000,
      description: 'Buy this launched coin and burn it once after its verified market cap reaches $100,000.' }),
    Object.freeze({ id: 'buyback-300k', name: 'Agent 3 · $300k buyback', kind: 'buyback-burn', marketCapUsd: 300_000,
      description: 'Buy this launched coin and burn it once after its verified market cap reaches $300,000.' }),
  ]),
});

export function canonicalAgencySelection(input = []) {
  const ids = MARKETING_AGENCY_POLICY.agents.map(agent => agent.id);
  if (!Array.isArray(input) || input.length > ids.length
    || input.some(id => typeof id !== 'string' || !ids.includes(id))
    || new Set(input).size !== input.length) throw new Error('Choose each supported marketing agent at most once.');
  return ids.filter(id => input.includes(id));
}

export function marketingAgencySelectionStatement(input = []) {
  return JSON.stringify({ version: MARKETING_AGENCY_POLICY.version,
    selectedAgents: canonicalAgencySelection(input) });
}
