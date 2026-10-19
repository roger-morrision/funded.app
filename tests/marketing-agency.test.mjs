import test from 'node:test';
import assert from 'node:assert/strict';
import { MARKETING_AGENCY_POLICY as P, canonicalAgencySelection, marketingAgencySelectionStatement } from '../config/marketing-agency.js';
import { projectAgencyAllocation, marketingAgencyCapabilities } from '../server/marketing-agency-policy.mjs';
import { evaluateAgencyTrigger } from '../server/marketing-agency-triggers.mjs';
import { createMarketingAgencyRoutes } from '../server/routes/marketing-agency.mjs';
import { createLaunchSubmitController } from '../src/app/controllers/launch-submit.js';
import { createLaunchRegistrationRoutes } from '../server/routes/launch-registration.mjs';
import { PROTOCOL_FEE_SPLIT } from '../config/protocol-fee-split.js';

const ids = P.agents.map(row => row.id);
const mint = 'So11111111111111111111111111111111111111112';
const now = Date.parse('2026-10-19T10:00:00.000Z');
const base = { mint, agentId: ids[1], selectedAgents: ids, budgetLamports: '10000', now,
  observation: { mint, cluster: 'devnet', commitment: 'finalized', slot: 10,
    observedAt: new Date(now).toISOString(), quoteCurrency: 'USD', marketCapUsdMicros: '100000000000' } };

test('approved candidate conserves 100 SOL and reduces referrals to exactly 1%', () => {
  const row = projectAgencyAllocation({ totalGrossLamports: '100000000000', selectedAgents: ids });
  assert.equal(row.creatorLamports, '80000000000');
  assert.equal(row.operationsLamports, '8000000000');
  assert.deepEqual(row.referralLamports, ['600000000', '250000000', '150000000']);
  assert.deepEqual(marketingAgencyCapabilities().referralGrossPercents,[0.6,0.25,0.15]);
  assert.equal(row.agencyLamports, '2000000000');
  assert.equal(row.communityLamports, '4000000000');
  assert.equal(row.fundedBuybackLamports, '5000000000');
  assert.deepEqual(row.agents.map(a => a.lamports), ['666666666', '666666667', '666666667']);
  assert.equal(row.status, 'projection-not-funded');
});

test('agency applies with no selection; budget remains reserved rather than returned to referrals', () => {
  const row = projectAgencyAllocation({ totalGrossLamports: '1000000000' });
  assert.equal(row.agencyLamports, '20000000');
  assert.equal(row.retainedAgencyLamports, row.agencyLamports);
  assert.deepEqual(row.agents, []);
  assert.equal(row.referralLamports.reduce((n, s) => n + BigInt(s), 0n), 10000000n);
});

test('every subset splits only across selected agents, canonical order and exact integers', () => {
  for (let mask = 1; mask < 8; mask++) {
    const selected = ids.filter((_, i) => mask & (1 << i));
    const row = projectAgencyAllocation({ totalGrossLamports: '18446744073709551615', selectedAgents: [...selected].reverse() });
    assert.deepEqual(row.agents.map(a => a.id), selected);
    assert.equal(row.agents.reduce((n, a) => n + BigInt(a.lamports), 0n), BigInt(row.agencyLamports));
    const total = ['creatorLamports','operationsLamports','agencyLamports','communityLamports','fundedBuybackLamports'].reduce((n, k) => n + BigInt(row[k]), 0n)
      + row.referralLamports.reduce((n, n2) => n + BigInt(n2), 0n);
    assert.equal(total, 18446744073709551615n);
  }
});

test('cumulative allocation and equal split reconcile across repeated collection batches', () => {
  const sums = Object.fromEntries(ids.map(id => [id, 0n]));
  let category = 0n;
  for (let i = 1; i <= 100; i++) {
    const row = projectAgencyAllocation({ totalGrossLamports: String(i * 10000), previousGrossLamports: String((i - 1) * 10000), selectedAgents: ids });
    row.agents.forEach(a => { sums[a.id] += BigInt(a.lamports); });
    category += BigInt(row.agencyLamports);
  }
  const once = projectAgencyAllocation({ totalGrossLamports: '1000000', selectedAgents: ids });
  assert.equal(category, BigInt(once.agencyLamports));
  once.agents.forEach(a => assert.equal(sums[a.id], BigInt(a.lamports)));
});

test('reject malformed amounts, decreasing totals, duplicate and unknown agents', () => {
  for (const value of [-1, 1, '-1', '1.2', '01', '1e3', '18446744073709551616', '9'.repeat(1000)])
    assert.throws(() => projectAgencyAllocation({ totalGrossLamports: value }));
  assert.throws(() => projectAgencyAllocation({ totalGrossLamports: '1', previousGrossLamports: '2' }));
  for (const selection of [[ids[0], ids[0]], ['unlimited-buy'], 'all', [null]]) assert.throws(() => canonicalAgencySelection(selection));
  assert.equal(marketingAgencySelectionStatement([ids[2], ids[0]]), marketingAgencySelectionStatement([ids[0], ids[2]]));
});

test('thresholds are inclusive and each agent targets its own mint with a stable one-time intent', () => {
  const ready = evaluateAgencyTrigger(base);
  assert.equal(ready.status, 'candidate'); assert.equal(ready.executionAuthorized, false);
  assert.equal(ready.mint, mint); assert.equal(ready.maxDebitLamports, '10000');
  assert.equal(ready.intentId, evaluateAgencyTrigger({ ...base, budgetLamports: '20000' }).intentId);
  assert.equal(evaluateAgencyTrigger({ ...base, observation: { ...base.observation, marketCapUsdMicros: '99999999999' } }).status, 'below-threshold');
  assert.equal(evaluateAgencyTrigger({ ...base, agentId: ids[2] }).status, 'below-threshold');
  assert.equal(evaluateAgencyTrigger({ ...base, agentId: ids[2], observation: { ...base.observation, marketCapUsdMicros: '300000000000' } }).status, 'candidate');
});

test('reject stale, future, wrong-mint, non-USD and non-finalized cap observations', () => {
  for (const change of [{ mint: '11111111111111111111111111111111' }, { cluster: 'mainnet-beta' },
    { commitment: 'confirmed' }, { quoteCurrency: 'SOL' }, { slot: 0 }, { slot: '10' },
    { observedAt: new Date(now - 60001).toISOString() }, { observedAt: new Date(now + 1).toISOString() },
    { marketCapUsdMicros: 'NaN' }, { marketCapUsdMicros: 300000000000 }, { observedAt: null }]) {
    assert.equal(evaluateAgencyTrigger({ ...base, observation: { ...base.observation, ...change } }).status, 'awaiting-verified-market-cap');
  }
});

test('one-time buybacks cannot replay completed, submitted or uncertain intents', () => {
  for (const status of ['submitted', 'uncertain', 'failed', 'queued', 'finalized']) {
    assert.equal(evaluateAgencyTrigger({ ...base, execution: { mint, agentId: ids[1], status } }).status, 'reconciliation-required');
  }
  assert.equal(evaluateAgencyTrigger({ ...base, execution: { mint, agentId: ids[1], status: 'finalized', receiptVerified: true } }).status, 'completed');
  assert.throws(() => evaluateAgencyTrigger({ ...base, execution: { mint, agentId: ids[2] } }));
  assert.equal(evaluateAgencyTrigger({ ...base, budgetLamports: '0' }).status, 'awaiting-funding');
  assert.equal(evaluateAgencyTrigger({ ...base, selectedAgents: [ids[0]] }).status, 'not-selected');
});

test('X promotion is a candidate only after positive agency funding; does not spend or post', () => {
  assert.equal(evaluateAgencyTrigger({ ...base, agentId: ids[0], observation: null }).status, 'candidate');
  assert.equal(evaluateAgencyTrigger({ ...base, agentId: ids[0], budgetLamports: '0' }).status, 'awaiting-funding');
});

test('X promotion waits 24 hours after verified delivery and billing, with one durable sequence per post',()=>{
  const args={...base,agentId:ids[0],observation:null};
  const first=evaluateAgencyTrigger(args);
  assert.equal(first.sequence,0);assert.equal(first.billAfter,'after-verified-x-post');
  const execution={mint,agentId:ids[0],status:'finalized',receiptVerified:true,billingVerified:true,
    sequence:0,completedAt:new Date(now).toISOString()};
  assert.equal(evaluateAgencyTrigger({...args,execution,now:now+86399999}).status,'cooldown');
  const next=evaluateAgencyTrigger({...args,execution,now:now+86400000});
  assert.equal(next.status,'candidate');assert.equal(next.sequence,1);assert.notEqual(next.intentId,first.intentId);
  assert.equal(evaluateAgencyTrigger({...args,execution:{...execution,billingVerified:false},now:now+86400000}).status,'awaiting-verified-billing');
  assert.equal(evaluateAgencyTrigger({...args,execution:{...execution,status:'uncertain'},now:now+86400000}).status,'reconciliation-required');
  assert.equal(evaluateAgencyTrigger({...args,execution:{...execution,completedAt:new Date(now+1).toISOString()}}).status,'reconciliation-required');
});

test('capability API cannot be enabled by an environment variable or assert zero funding', async () => {
  const old = process.env.FUNDED_MARKETING_AGENCY_ENABLED;
  process.env.FUNDED_MARKETING_AGENCY_ENABLED = 'true';
  try { assert.equal(marketingAgencyCapabilities().active, false); }
  finally { old === undefined ? delete process.env.FUNDED_MARKETING_AGENCY_ENABLED : process.env.FUNDED_MARKETING_AGENCY_ENABLED = old; }
  let result;
  const handle = createMarketingAgencyRoutes({ respond: (_, status, body) => { result = { status, body }; } });
  assert.equal(await handle({ method: 'GET' }, {}, new URL('http://localhost/api/marketing-agency')), true);
  assert.equal(result.body.funding.collectedLamports, null);
  assert.equal(result.body.executionEnabled, false);
  assert.equal(result.body.historyStatus, 'unavailable');
  await handle({ method: 'POST' }, {}, new URL('http://localhost/api/marketing-agency'));
  assert.equal(result.status, 405);
  assert.equal(await handle({ method: 'GET' }, {}, new URL('http://localhost/api/other')), false);
});

test('selected agency launch fails before wallet connection, signing, RPC or transaction', async () => {
  const prior = globalThis.document;
  globalThis.document = { querySelectorAll: () => [{ value: ids[0] }] };
  let message;
  try {
    await createLaunchSubmitController({ setLaunchStatus: value => { message = value; } }).launchToken();
    assert.match(message, /No transaction was sent/);
  } finally { globalThis.document = prior; }
});

test('server rejects agency launch registration before external verification or storage', async () => {
  let result;
  const handle = createLaunchRegistrationRoutes({ solanaCluster: 'devnet',
    body: async () => ({ mint, chain: 'solana', cluster: 'devnet', marketingAgency: { selectedAgents: ids } }),
    respond: (_, status, body) => { result = { status, body }; }, v3LaunchConfig: async () => { throw new Error('Must not verify/sign'); } });
  await handle({ method: 'POST' }, {}, new URL('http://localhost/api/launches'));
  assert.equal(result.status, 409); assert.match(result.body.error, /not activated/);
});

test('candidate never mutates the current six-rate policy or reprices historical launches', () => {
  assert.deepEqual(PROTOCOL_FEE_SPLIT, { operationsPercent: 40, referralLevelPercents: [10, 3, 2], communityPercent: 20, buybackPercent: 25 });
  assert.equal(marketingAgencyCapabilities().policy.scope, 'every-new-launch');
});
