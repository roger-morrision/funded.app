import test from 'node:test';
import assert from 'node:assert/strict';
import { LISTING_PRICE_USD, listingBurnBaseUnits, listingBurnBaseUnitsForUsd, listingBurnTokens, listingMemo, listingQuoteCurrent } from '../listing-policy.js';
import { readVerifiedBurnChecked } from '../server/burn-verification.mjs';
import { isAppPagePath } from '../server/page-routes.mjs';
import bs58 from 'bs58';

const wallet = '11111111111111111111111111111111';
const mint = 'So11111111111111111111111111111111111111112';
const fundedMint = 'FUNDEDmint';
const amount = listingBurnBaseUnits(6, listingBurnTokens(0.01));

function transaction({ memo = listingMemo(mint), burnAmount = amount, failed = false, payer = wallet } = {}) {
  return {
    meta: { err: failed ? { InstructionError: [0, 'Custom'] } : null,
      preTokenBalances: [{ accountIndex: 1, mint: fundedMint, owner: wallet, uiTokenAmount: { amount: String(amount * 2n) } }],
      postTokenBalances: [{ accountIndex: 1, mint: fundedMint, owner: wallet, uiTokenAmount: { amount: String(amount * 2n - burnAmount) } }] },
    transaction: { message: { accountKeys: [payer, 'SourceAccount'], instructions: [
      { programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', parsed: { type: 'burnChecked', info: {
        mint: fundedMint, authority: wallet, account: 'SourceAccount', tokenAmount: { amount: String(burnAmount), decimals: 6 },
      } } },
      { programId: 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr', parsed: memo },
    ] } },
  };
}

test('listing fee is $200 converted from the verified token price', () => {
  assert.equal(LISTING_PRICE_USD, 200);
  assert.equal(amount, 20_000_000_000n);
  assert.equal(listingBurnTokens(0.02), 10_000);
  assert.equal(listingBurnTokens(0.005), 40_000);
  assert.equal(listingBurnBaseUnitsForUsd(0.03, 6), 6_666_666_667n);
  assert.throws(() => listingBurnTokens(0));
  assert.throws(() => listingBurnBaseUnits(-1));
});

test('listing quote binds the mint, payer, fee and expiry', () => {
  const quote = { id:'listing_1000_0123456789abcdef', mint, payer:wallet, fundedMint,
    usd:200, amountTokens:20_000, amountBaseUnits:'20000000000', decimals:6,
    createdAt:new Date(1000).toISOString(), expiresAt:new Date(601_000).toISOString() };
  assert.equal(listingQuoteCurrent(quote, { mint, payer:wallet, fundedMint, now:10_000 }), true);
  assert.equal(listingQuoteCurrent(quote, { mint:wallet, payer:wallet, fundedMint, now:10_000 }), false);
  assert.equal(listingQuoteCurrent(quote, { mint, payer:wallet, fundedMint, now:602_000 }), false);
  assert.equal(listingQuoteCurrent({ ...quote, usd:199 }, { now:10_000 }), false);
});

test('a confirmed burn is bound to one listing mint', () => {
  const proof = readVerifiedBurnChecked(transaction(), { fundedMint, wallet, amountBaseUnits: amount.toString(), expectedMemo: listingMemo(mint) });
  assert.equal(proof.amountBaseUnits, amount.toString());
  const rawMemo = transaction();
  rawMemo.transaction.message.instructions[1] = {
    programId: 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr',
    data: bs58.encode(Buffer.from(listingMemo(mint))),
  };
  assert.equal(readVerifiedBurnChecked(rawMemo, { fundedMint, wallet, amountBaseUnits: amount.toString(), expectedMemo: listingMemo(mint) }).amountBaseUnits, amount.toString());
  assert.throws(() => readVerifiedBurnChecked(transaction({ memo: listingMemo(wallet) }), { fundedMint, wallet, amountBaseUnits: amount.toString(), expectedMemo: listingMemo(mint) }), /not bound/);
  assert.throws(() => readVerifiedBurnChecked(transaction({ memo: '' }), { fundedMint, wallet, amountBaseUnits: amount.toString(), expectedMemo: listingMemo(mint) }), /not bound/);
});

test('underpayment, wrong payer, and failed transactions cannot list', () => {
  const expected = { fundedMint, wallet, amountBaseUnits: amount.toString(), expectedMemo: listingMemo(mint) };
  assert.throws(() => readVerifiedBurnChecked(transaction({ burnAmount: amount - 1n }), expected), /does not match/);
  assert.throws(() => readVerifiedBurnChecked(transaction({ payer: mint }), expected), /fee payer/);
  assert.throws(() => readVerifiedBurnChecked(transaction({ failed: true }), expected), /not confirmed/);
});

test('direct /list route is available to the production app', () => {
  assert.equal(isAppPagePath('/list'), true);
  assert.equal(isAppPagePath('/list/'), true);
});
