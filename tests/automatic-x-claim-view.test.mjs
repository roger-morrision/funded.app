import test from 'node:test';
import assert from 'node:assert/strict';
import { automaticXClaimState, rewardView } from '../reward-discovery.js';

const collection = 'collection-signature';
const mint = 'mint-address';
const wallet = 'bound-wallet';
const obligation = { id:`${collection}:${mint}:x`, claimSignature:collection, mint, xUserId:'x-user', amountLamports:'187844' };
const claim = { xUserId:'x-user', obligationId:obligation.id, publicKey:wallet, xAttestation:{ subject:'x-user' }, status:'ready-to-execute' };
const requestId = `${collection}:x`;
const scheduleId = `direct:x:${requestId}`;
const rewards = { fundingRequests:{ [requestId]:{ id:requestId, kind:'x', asset:'SOL', mint, sourceSignature:collection,
  obligationId:obligation.id, recipient:wallet, amount:'187844', status:'funded', balanceDeltaVerified:true,
  fundingSignature:'funding-signature', scheduleId } }, schedules:{ [scheduleId]:{ sourceId:requestId, mint, kind:'x', asset:'SOL',
  fundingSignature:'funding-signature', balanceDeltaVerified:true, manifest:{ totalAmount:'187844', leaves:[{ recipient:wallet, amount:'187844' }] },
  payments:{ [wallet]:{ status:'paid', amount:'187844', signature:'payout-signature', finalized:true, balanceDeltaVerified:true } } } } };

test('finalized automatic X payout is shown as paid to the verified wallet with its receipt', () => {
  const automatic = automaticXClaimState(obligation, claim, rewards);
  assert.equal(automatic.paid, true);
  assert.deepEqual(rewardView(obligation, claim, [], automatic), {
    id:obligation.id, mint, amountSol:0.000187844, status:'paid', group:'Paid', receiptVerified:true,
    payoutSignature:'payout-signature', payoutWallet:wallet, canPrepare:false,
    explanation:'Confirmed recipient balance delta.' });
});

test('enrolled payout in progress cannot be manually claimed twice', () => {
  const pending = structuredClone(rewards);
  pending.fundingRequests[requestId].status = 'pending';
  delete pending.schedules[scheduleId];
  const view = rewardView(obligation, claim, [], automaticXClaimState(obligation, claim, pending));
  assert.equal(view.receiptVerified, false);
  assert.equal(view.canPrepare, false);
  assert.equal(view.status, 'automatic-pending');
});

test('mismatched identity, recipient, amount, funding or incomplete receipt cannot mark a payout paid', () => {
  for (const change of [
    state => { state.claim.xAttestation.subject = 'another-user'; },
    state => { state.rewards.fundingRequests[requestId].recipient = 'another-wallet'; },
    state => { state.rewards.fundingRequests[requestId].amount = '1'; },
    state => { state.rewards.schedules[scheduleId].fundingSignature = 'wrong-funding'; },
    state => { state.rewards.schedules[scheduleId].payments[wallet].finalized = false; },
    state => { state.rewards.schedules[scheduleId].payments[wallet].balanceDeltaVerified = false; },
  ]) {
    const state = { claim:structuredClone(claim), rewards:structuredClone(rewards) };
    change(state);
    const automatic = automaticXClaimState(obligation, state.claim, state.rewards);
    assert.equal(rewardView(obligation, state.claim, [], automatic).receiptVerified, false);
  }
});
