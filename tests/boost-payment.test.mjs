import test from 'node:test';
import assert from 'node:assert/strict';
import { PublicKey, SystemProgram } from '@solana/web3.js';
import { BOOST_MEMO_PROGRAM, BOOST_PACKAGES, activeBoostMultiplier, activeBoosts, boostLamports, boostMemo } from '../boost-offer.js';
import { verifyBoostPayment } from '../server/boost-proof.mjs';
import { filterMarketRecords } from '../market-intelligence.js';

const payer = new PublicKey(Uint8Array.from({ length:32 }, (_, index) => index + 1)).toBase58();
const recipient = new PublicKey(Uint8Array.from({ length:32 }, (_, index) => index + 33)).toBase58();
const quote = { id:'boost_123456_0123456789abcdef', payer, recipient, mint:recipient, lamports:1_000_000_000,
  cluster:'devnet', hours:12, createdAt:'2026-10-02T00:00:00.000Z', expiresAt:'2026-10-02T00:05:00.000Z' };
function receipt(overrides = {}) {
  return { blockTime:Math.floor(Date.parse('2026-10-02T00:01:00.000Z') / 1000), slot:123,
    meta:{ err:null }, transaction:{ message:{ accountKeys:[{ pubkey:new PublicKey(payer), signer:true }, { pubkey:new PublicKey(recipient), signer:false }],
      instructions:[{ programId:SystemProgram.programId, parsed:{ type:'transfer', info:{ source:payer, destination:recipient, lamports:quote.lamports } } },
        { programId:new PublicKey(BOOST_MEMO_PROGRAM), parsed:boostMemo(quote.id) }] } }, ...overrides };
}

test('package pricing uses safe integer lamports and refuses stale or invalid rates', () => {
  assert.deepEqual(BOOST_PACKAGES.map(item => [item.id,item.hours,item.usd]), [['10x',12,99],['30x',12,249],['50x',12,399],['100x',24,899],['500x',24,3999]]);
  assert.equal(boostLamports(99, 100), 990_000_000);
  assert.throws(() => boostLamports(99, 0));
});

test('receipt requires exact payer, recipient, amount, memo, and finalized proof', () => {
  assert.deepEqual(verifyBoostPayment(receipt(), quote), { slot:123, startsAt:'2026-10-02T00:01:00.000Z', expiresAt:'2026-10-02T12:01:00.000Z' });
  const badAmount = receipt(); badAmount.transaction.message.instructions[0].parsed.info.lamports -= 1;
  assert.throws(() => verifyBoostPayment(badAmount, quote), /transfer/);
  const badMemo = receipt(); badMemo.transaction.message.instructions[1].parsed = 'other';
  assert.throws(() => verifyBoostPayment(badMemo, quote), /memo/);
  const badSigner = receipt(); badSigner.transaction.message.accountKeys[0].signer = false;
  assert.throws(() => verifyBoostPayment(badSigner, quote), /signer/);
  const failed = receipt({ meta:{err:{InstructionError:[0,'Custom']}} });
  assert.throws(() => verifyBoostPayment(failed, quote), /finalized/);
  const late = receipt({ blockTime:Math.floor(Date.parse('2026-10-02T00:07:00.000Z') / 1000) });
  assert.throws(() => verifyBoostPayment(late, quote), /window/);
});

test('overlapping finalized boosts stack and expire independently', () => {
  const at = Date.parse('2026-10-02T01:00:00Z');
  const base = { mint:recipient, cluster:'devnet', status:'finalized', startsAt:'2026-10-02T00:00:00Z', expiresAt:'2026-10-02T12:00:00Z' };
  const active = activeBoosts({ a:{ ...base, multiplier:10 }, b:{ ...base, multiplier:500, expiresAt:'2026-10-03T00:00:00Z' }, c:{ ...base, multiplier:100, status:'pending' } }, at);
  assert.equal(active[recipient].multiplier, 510);
  assert.equal(active[recipient].golden, true);
  assert.equal(active[recipient].count, 2);
  assert.equal(active[recipient].nextExpiry, '2026-10-02T12:00:00Z');
  assert.equal(activeBoostMultiplier(active[recipient], at), 510);
  assert.equal(activeBoostMultiplier(active[recipient], Date.parse('2026-10-02T12:00:00Z')), 0);
  assert.equal(activeBoostMultiplier(active[recipient], Date.parse('2026-10-03T01:00:00Z')), 0);
  assert.equal(activeBoostMultiplier({ multiplier: 500, expiresAt: 'invalid' }, at), 0);
  assert.deepEqual(activeBoosts({ a:{ ...base, multiplier:10 } }, Date.parse('2026-10-03T01:00:00Z')), {});
});

test('active SOL boosts appear in paid promotion filters without changing launch tier', () => {
  const records = [
    { address:'paid', symbol:'PAID', name:'Paid', promotionTier:'standard', postLaunchBoostMultiplier:10 },
    { address:'plain', symbol:'PLAIN', name:'Plain', promotionTier:'standard', postLaunchBoostMultiplier:0 },
  ];
  assert.deepEqual(filterMarketRecords(records, { promotion:'promoted' }).map(item => item.address), ['paid']);
  assert.deepEqual(filterMarketRecords(records, { promotion:'boost' }).map(item => item.address), ['paid']);
  assert.deepEqual(filterMarketRecords(records, { promotion:'standard' }).map(item => item.address), ['plain']);
  assert.equal(records[0].promotionTier, 'standard');
});
