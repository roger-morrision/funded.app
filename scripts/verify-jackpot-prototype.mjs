import assert from 'node:assert/strict';
import { jackpotWindow, jackpotContribution, eligibleJackpotEntries,
  selectJackpotWinner, verifiedJackpotPayout, jackpotPreview,
  CREATOR_SHARE_BPS, TRADER_FEE_BPS } from '../server/jackpot-model.mjs';

const creator = '11111111111111111111111111111111';
const trader = '22222222222222222222222222222222';
const mint = '33333333333333333333333333333333';
const vault = '44444444444444444444444444444444';
const signature = '5'.repeat(88);
const now = 1_728_000_020;
const window = jackpotWindow(now);
assert.equal(window.end - window.start, 86_400);
assert.equal(window.secondsRemaining, window.end - now);
assert.equal(jackpotContribution('1000000000', CREATOR_SHARE_BPS), '10000000');
assert.equal(jackpotContribution('1000000000', TRADER_FEE_BPS), '50000000');
assert.equal(jackpotContribution('99', CREATOR_SHARE_BPS), '0');
assert.throws(() => jackpotContribution('1.5', CREATOR_SHARE_BPS));

const launches = eligibleJackpotEntries('creator', [
  { cluster:'devnet', finalized:true, onchainVerified:true, creatorWallet:creator, mint, blockTime:window.start },
  { cluster:'devnet', finalized:true, onchainVerified:true, creatorWallet:creator, mint, blockTime:window.start },
  { cluster:'devnet', finalized:false, onchainVerified:true, creatorWallet:trader, mint:vault, blockTime:window.start },
  { cluster:'devnet', finalized:true, onchainVerified:true, creatorWallet:trader, mint:vault, blockTime:window.end },
], window);
assert.deepEqual(launches, [{ wallet:creator, source:mint }]);
const trades = eligibleJackpotEntries('trader', [
  { cluster:'devnet', finalized:true, onchainVerified:true, feeTransferVerified:true,
    traderWallet:trader, signature, feeLamports:'10000', blockTime:window.start + 1 },
  { cluster:'devnet', finalized:true, onchainVerified:true, feeTransferVerified:true,
    traderWallet:trader, signature, feeLamports:'10000', blockTime:window.start + 1 },
  { cluster:'devnet', finalized:true, onchainVerified:true, feeTransferVerified:false,
    traderWallet:trader, signature:'6'.repeat(88), feeLamports:'10000', blockTime:window.start + 1 },
], window);
assert.equal(trades.length, 1);
assert.throws(() => eligibleJackpotEntries('creator', [
  { cluster:'devnet', finalized:true, onchainVerified:true, creatorWallet:creator, mint, blockTime:window.start },
  { cluster:'devnet', finalized:true, onchainVerified:true, creatorWallet:trader, mint, blockTime:window.start },
], window), /Conflicting/);

const entries = [{ wallet:creator, source:mint }, { wallet:trader, source:signature }];
const entropy = 'ab'.repeat(32);
const draw = selectJackpotWinner(entries, entropy, `trader:${window.start}`);
assert.deepEqual(draw, selectJackpotWinner(entries, entropy, `trader:${window.start}`));
assert.ok([creator, trader].includes(draw.winner));
assert.throws(() => selectJackpotWinner(entries, 'bad', `trader:${window.start}`));
const round = { id:`trader:${window.start}`, cluster:'devnet', status:'drawn', winner:trader,
  vault, prizeLamports:'50000000' };
const proof = { signature, cluster:'devnet', commitment:'finalized', transactionSucceeded:true,
  balanceDeltaVerified:true, from:vault, to:trader, amountLamports:'50000000', blockTime:window.end + 20 };
assert.equal(verifiedJackpotPayout({ round, proof }).signature, signature);
assert.throws(() => verifiedJackpotPayout({ round, proof:{ ...proof, commitment:'confirmed' } }));
assert.throws(() => verifiedJackpotPayout({ round, proof:{ ...proof, amountLamports:'49999999' } }));
const preview = jackpotPreview(now);
assert.equal(preview.creator.fundedLamports, '0');
assert.equal(preview.creator.fundingVerified, false);
assert.equal(preview.trader.payoutEnabled, false);
assert.deepEqual(preview.creator.history, []);
console.log('Jackpot prototype model: 19 assertions passed.');
