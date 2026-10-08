import test from 'node:test';
import assert from 'node:assert/strict';
import { communityClaimSummary, communityClaimUnit } from '../community-claim-summary.js';
const ready = { launchesReady: true, reservesReady: true };
const launch = mint => ({ mint, onchainVerified: true, communityAirdrop: { reservedTokens: 30_000_000 } });
const reserve = (claimed, extra = {}) => ({ verified: true, status: 'drop-active', reservedTokens: 30_000_000, totalBaseUnits: '30000000000000', claimedBaseUnits: claimed, ...extra });
test('sums claims across distinct projects without counting duplicate policies or unclaimed reserves', () => {
  const launches = Array.from({ length: 10 }, (_, i) => launch(String(i)));
  const reserves = new Map(launches.map(row => [row.mint, reserve('30000000000000')]));
  const summary = communityClaimSummary([...launches, launches[0], launch('pending')], new Map([...reserves, ['pending', reserve('0', { status: 'funded' })]]), ready);
  assert.equal(`${summary.amount} ${communityClaimUnit(summary)}`, '300,000,000 tokens / 10 projects');
  assert.equal(summary.state, 'available');
});
test('includes closed drops and preserves fractional token amounts', () => {
  const summary = communityClaimSummary([launch('a')], new Map([['a', reserve('232636027', { status: 'drop-closed' })]]), ready);
  assert.equal(summary.amount, '232.636027');
  assert.equal(communityClaimUnit(summary), 'tokens / 1 project');
});
test('missing or invalid claim evidence is partial, not a fabricated payout', () => {
  for (const invalid of [undefined, reserve('999999999999999'), reserve('1', { verified: false }), reserve('1', { reservedTokens: 1 })]) {
    const summary = communityClaimSummary([launch('a'), launch('b')], new Map([['a', reserve('1000000')], ['b', invalid]]), ready);
    assert.equal(summary.amount, '≥1');
    assert.equal(summary.projects, 1);
    assert.equal(summary.state, 'partial');
  }
});
test('distinguishes empty, zero claims, and unavailable data', () => {
  assert.equal(communityClaimSummary([], new Map(), ready).amount, '0');
  assert.equal(communityClaimSummary([launch('a')], new Map([['a', reserve('0')]]), ready).projects, 0);
  assert.equal(communityClaimSummary([launch('a')], new Map(), ready).amount, '—');
  assert.equal(communityClaimSummary([], new Map(), { ...ready, reservesReady: false }).amount, '—');
});
