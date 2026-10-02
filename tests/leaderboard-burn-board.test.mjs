import test from 'node:test';
import assert from 'node:assert/strict';
import { projectBurnBoard, walletBurnBoard } from '../server/leaderboard-burn-board.mjs';

test('burn board includes only verified project receipts and deduplicates launch burns', () => {
  const state = {
    launches: {
      mintA: { mint: 'mintA', cluster: 'devnet', onchainVerified: true, name: 'Alpha', symbol: 'ALP', creatorWallet: 'walletA', onchainVerifiedAt: '2026-09-29T10:00:00Z',
        creatorLaunchBurn: { status: 'verified', amountTokens: 25_000, receipt: { signature: 'atomicA', instruction: 'BurnChecked', atomicWithPumpLaunch: true, verified: true } } },
      mintB: { mint: 'mintB', cluster: 'devnet', onchainVerified: true, name: 'Beta', symbol: 'BET' },
      mintC: { mint: 'mintC', cluster: 'devnet', onchainVerified: false, name: 'Unverified', symbol: 'BAD' },
    },
    burnReceipts: {
      atomicA: { signature: 'atomicA', cluster: 'devnet', projectMint: 'mintA', wallet: 'walletA', amountTokens: 25_000, instruction: 'BurnChecked', status: 'verified', onchainVerified: true },
      extraA: { signature: 'extraA', cluster: 'devnet', projectMint: 'mintA', wallet: 'walletB', amountTokens: 5_000, instruction: 'BurnChecked', status: 'verified', onchainVerified: true, verifiedAt: '2026-09-30T10:00:00Z' },
      burnB: { signature: 'burnB', cluster: 'devnet', projectMint: 'mintB', wallet: 'walletC', amountTokens: 10_000, instruction: 'BurnChecked', status: 'verified', onchainVerified: true },
      noProject: { signature: 'noProject', cluster: 'devnet', projectMint: null, wallet: 'walletD', amountTokens: 100_000, instruction: 'BurnChecked', status: 'verified', onchainVerified: true },
      falseClaim: { signature: 'falseClaim', cluster: 'devnet', projectMint: 'mintA', wallet: 'walletE', amountTokens: 100_000, instruction: 'BurnChecked', status: 'verified', onchainVerified: false },
      wrongChain: { signature: 'wrongChain', cluster: 'mainnet-beta', projectMint: 'mintA', wallet: 'walletF', amountTokens: 100_000, instruction: 'BurnChecked', status: 'verified', onchainVerified: true },
      unverifiedProject: { signature: 'unverifiedProject', cluster: 'devnet', projectMint: 'mintC', wallet: 'walletG', amountTokens: 100_000, instruction: 'BurnChecked', status: 'verified', onchainVerified: true },
    },
  };

  const rows = projectBurnBoard(state, 'devnet');
  assert.deepEqual(rows.map(row => [row.mint, row.burnedTokens, row.receiptCount, row.burnerCount]), [
    ['mintA', 30_000, 2, 2],
    ['mintB', 10_000, 1, 1],
  ]);
  assert.equal(rows[0].latestSignature, 'extraA');
  assert.equal(rows[0].lastBurnAt, '2026-09-30T10:00:00.000Z');
  assert.deepEqual(projectBurnBoard(state, 'mainnet-beta'), []);
});

test('burners rank verified wallets and deduplicate atomic launch receipts', () => {
  const alice = '11111111111111111111111111111111';
  const bob = '22222222222222222222222222222222';
  const state = {
    launches: { one: { mint:'mintA', cluster:'devnet', onchainVerified:true, creatorWallet:alice,
      onchainVerifiedAt:'2026-09-28T10:00:00Z', creatorLaunchBurn:{ status:'verified',
        receipt:{ signature:'atomic', amountTokens:25_000, verified:true, instruction:'BurnChecked', atomicWithPumpLaunch:true } } } },
    burnReceipts: {
      atomic: { signature:'atomic', cluster:'devnet', wallet:alice, amountTokens:25_000, status:'verified', onchainVerified:true, instruction:'BurnChecked' },
      later: { signature:'later', cluster:'devnet', wallet:alice, amountTokens:5_000, verifiedAt:'2026-09-30T10:00:00Z', status:'verified', onchainVerified:true, instruction:'BurnChecked' },
      bob: { signature:'bob', cluster:'devnet', wallet:bob, amountTokens:10_000, verifiedAt:'2026-09-29T10:00:00Z', status:'verified', onchainVerified:true, instruction:'BurnChecked' },
      unverified: { signature:'unverified', cluster:'devnet', wallet:bob, amountTokens:100_000, status:'verified', onchainVerified:false, instruction:'BurnChecked' },
      otherChain: { signature:'otherChain', cluster:'mainnet-beta', wallet:bob, amountTokens:100_000, status:'verified', onchainVerified:true, instruction:'BurnChecked' },
    },
  };
  const rows = walletBurnBoard(state, 'devnet');
  assert.deepEqual(rows.map(row => [row.wallet,row.burnedTokens,row.receiptCount]), [[alice,30_000,2],[bob,10_000,1]]);
  assert.equal(rows[0].firstBurnAt,'2026-09-28T10:00:00.000Z');
  assert.equal(rows[0].latestSignature,'later');
});
