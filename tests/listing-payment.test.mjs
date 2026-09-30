import test from 'node:test';
import assert from 'node:assert/strict';
import { listingBurnBaseUnits, listingMemo } from '../listing-policy.js';
import { readVerifiedBurnChecked } from '../server/burn-verification.mjs';
import { isAppPagePath } from '../server/page-routes.mjs';
import bs58 from 'bs58';

const wallet = '11111111111111111111111111111111';
const mint = 'So11111111111111111111111111111111111111112';
const fundedMint = 'FUNDEDmint';
const amount = listingBurnBaseUnits(6);

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

test('listing fee is exactly 25,000 tokens at the mint precision', () => {
  assert.equal(amount, 25_000_000_000n);
  assert.throws(() => listingBurnBaseUnits(-1));
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
