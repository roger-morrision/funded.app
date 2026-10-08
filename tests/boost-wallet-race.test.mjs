import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import bs58 from 'bs58';
import { validateBoostQuote, archiveBoostPayment } from '../boost-checkout-recovery.js';
const source = await readFile(new URL('../app.js', import.meta.url), 'utf8');
const handler = source.slice(source.indexOf('async function handleExploreBoostPay(){'), source.indexOf('async function verifyExploreBoostPayment('));
test('wallet change during boost broadcast preserves the signed quote for payment verification', async () => {
  const quote = { id: 'boost_123_0123456789abcdef', cluster: 'devnet', mint: 'mint', packageId: '10x', payer: 'payer', expiresAt: new Date(Date.now() + 60_000).toISOString(), recipient: '1'.repeat(32), lamports: 10, usd: 99, solUsd: 100, memo: 'funded.vip:boost:devnet:boost_123_0123456789abcdef' };
  const checkout = { mint: 'mint', packageId: '10x', quote, busy: false, pendingSignature: null };
  class Transaction { add() { return this; } compileMessage() { return {}; } }
  const saved = [];
  let verified = false, sends = 0;
  const signature = bs58.encode(new Uint8Array(64).fill(1));
  const context = {
    saveSignedBoostPayment: async record => context.localStorage.setItem('pending', JSON.stringify(record)), validateBoostQuote, archiveBoostPayment, bs58, boostCheckout: checkout, wallet: {}, renderExploreBoostDialog() {}, canSignTransactions: () => true,
    captureWalletSession: () => ({ address: 'payer', provider: { publicKey: 'payer', signTransaction: async () => ({ signature: new Uint8Array(64).fill(1), serialize: () => new Uint8Array() }) } }),
    assertWalletSessionCurrent() {}, TextEncoder, BOOST_MEMO_PROGRAM: 'memo-program',
    getSolana: async () => ({ PublicKey: class {}, Transaction, TransactionInstruction: class {}, SystemProgram: { transfer() {} } }),
    connection: { getBalance: async () => 100, getFeeForMessage: async () => ({value:5}), getLatestBlockhash: async () => ({ blockhash: 'hash' }), sendRawTransaction: async () => { sends++; assert.equal(saved[0].signature, signature, 'Recovery persisted before broadcast'); return signature; } },
    localStorage: { setItem: (key, value) => saved.push(JSON.parse(value)) },
    verifyExploreBoostPayment: async () => { assert.equal(checkout.quote, quote); assert.equal(checkout.pendingSignature, signature); verified = true; },
  };
  vm.runInNewContext(handler, context);
  context.connection.getBalance = async () => 14;
  await context.handleExploreBoostPay();
  assert.equal(sends,0);
  assert.equal(saved.length,0,'Insufficient balance must not create a pending payment');
  assert.match(checkout.message,/Not enough SOL/);
  context.connection.getBalance = async () => 100;
  await context.handleExploreBoostPay();
  assert.equal(verified, true);
  assert.equal(saved[0].quote.id, quote.id);
  assert.equal(checkout.busy, false);
  await context.handleExploreBoostPay();
  assert.equal(sends, 1, 'Retry verifies the recorded signature without sending a second payment');
  checkout.pendingSignature = null;
  checkout.quote = quote;
  context.connection.sendRawTransaction = async () => { sends++; throw new Error('RPC response timed out after acceptance'); };
  await context.handleExploreBoostPay();
  assert.equal(checkout.pendingSignature, signature, 'Ambiguous broadcast retains the locally signed identity');
  assert.match(checkout.message, /Retry payment verification/);
  await context.handleExploreBoostPay();
  assert.equal(sends, 2, 'Ambiguous-send retry only verifies and does not broadcast again');
  checkout.pendingSignature = null;
  checkout.quote = quote;
  context.localStorage.setItem = () => { throw new Error('storage unavailable'); };
  await context.handleExploreBoostPay();
  assert.equal(sends, 2, 'Payment cannot broadcast without durable recovery identity');
  assert.equal(checkout.pendingSignature, null);
  assert.match(checkout.message, /No payment was sent/);
});

test('background FUNDED route refresh does not clear a quote after confirmation starts', async () => {
  const refresh = source.slice(source.indexOf('async function refreshFundedBuyRoute(signal){'), source.indexOf('async function handleFundedBuy(){'));
  const preview = { trade: 'reviewed' };
  const context = {
    APP_CLUSTER: 'devnet', APP_MAINNET_READ_ONLY: false, PROTOCOL_FUNDED_MINT: 'mint', PROTOCOL_FUNDED_SWAP_POOL: 'pool',
    fundedBuyBusy: false, fundedBuyPreview: preview, fundedBuyRoute: { status: 'ready', snapshot: 'previous' },
    withRpcRetry: async callback => callback(0), getTradePreviewConnection: async () => ({}),
    fetchVerifiedPoolSnapshot: async () => { context.fundedBuyBusy = true; return { pool: 'pool', quoteReservesSol: 1 }; },
    renderFundedBuyControl: () => assert.fail('No UI update during active confirmation'),
    renderFundedTokenLanding: () => assert.fail('No UI update during active confirmation'),
  };
  vm.runInNewContext(refresh, context);
  await context.refreshFundedBuyRoute();
  assert.equal(context.fundedBuyPreview, preview);
  assert.equal(context.fundedBuyRoute.snapshot, 'previous');
});
