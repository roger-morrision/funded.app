// Read-only boundary check for the current automatic holder payout limit.
import assert from 'node:assert/strict';
import { AUTOMATIC_REWARDS } from '../automatic-rewards.js';
import { holderPoolMinimumLamports, holderUsdEligibility } from '../server/reward-scheduler.mjs';

const quote = { tokenPriceUsd:1, decimals:0, solUsd:100,
  observedAt:new Date().toISOString() };
const accounts = count => Array.from({ length:count }, (_, index) =>
  ({ wallet:`qa-holder-${index}`, balance:'20' }));
const allowed = AUTOMATIC_REWARDS.maxEligibleHolders;
assert.equal(holderUsdEligibility(quote, accounts(allowed)).eligible.size, allowed);
assert(BigInt(holderPoolMinimumLamports({ asset:'SOL' }, quote, allowed)) > 0n);
const error = /Eligible holder count exceeds the configured distribution limit/;
assert.throws(() => holderUsdEligibility(quote, accounts(allowed + 1)), error);
assert.throws(() => holderPoolMinimumLamports({ asset:'SOL' }, quote, allowed + 1), error);
console.log(JSON.stringify({ schemaVersion:1, scope:'local-only current holder scheduler boundary',
  checkedAt:new Date().toISOString(), maxEligibleHolders:allowed,
  acceptedHolders:allowed, rejectedHolders:allowed + 1,
  eligibilityAndPoolMinimumRejectAboveLimit:true,
  implication:'A reward cycle with more than this many eligible holders is blocked before payout.' }, null, 2));
