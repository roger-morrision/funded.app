import { test } from 'node:test';
import assert from 'node:assert/strict';
import { walletHistoryRows, walletHistorySol, walletHistoryTokenAmount } from '../src/features/portfolio/wallet-history-model.js';

const wallet = '22222222222222222222222222222222';
const mint = '11111111111111111111111111111111';
const holderSignature = '3'.repeat(64);
const xSignature = '4'.repeat(64);
const bonusSignature = '5'.repeat(64);
const payment = '6'.repeat(32);

test('connected wallet history includes only recorded verified payouts and on-chain airdrop claims', () => {
  const experience = { cluster:'devnet', wallet:{ address:wallet, rows:[{ mint, symbol:'QA',
    payouts:[
      { kind:'holder', wallet, signature:holderSignature, amountLamports:'123127',
        feeSourceVerified:true, paidAt:'2026-10-14T02:00:00Z' },
      { kind:'x', wallet, signature:xSignature, amountLamports:'250000000',
        feeSourceVerified:true, paidAt:'2026-10-14T03:00:00Z' },
      { kind:'creator', wallet, signature:'B'.repeat(64), amountLamports:'60000000',
        feeSourceVerified:true, paidAt:'2026-10-14T02:30:00Z' },
      { kind:'holder', wallet, signature:'7'.repeat(64), amountLamports:'999',
        feeSourceVerified:false },
      { kind:'x', wallet:mint, signature:'8'.repeat(64), amountLamports:'999',
        feeSourceVerified:true },
    ] }] } };
  const airdrops = [{ mint, symbol:'QA', reservedTokens:'100', totalBaseUnits:'100000000',
    proof:{ status:'claimed', recipient:wallet, amount:'12500000', payment } },
  { mint, proof:{ status:'claimable', recipient:wallet, amount:'1', payment:'9'.repeat(32) } }];
  const bonusClaims = [
    { status:'paid', finalized:true, balanceDeltaVerified:true,
      recipientWallet:wallet, asset:'SOL', level:2, amount:'0.2',
      payoutSignature:bonusSignature, paidAt:'2026-10-14T01:00:00Z' },
    { status:'verification-pending', recipientWallet:wallet, asset:'SOL', amount:'2',
      payoutSignature:'A'.repeat(64) },
  ];
  const rows = walletHistoryRows({ wallet, experience, airdrops, bonusClaims });
  assert.deepEqual(rows.map(row => row.type), ['claim','claim','reward','bonus','airdrop']);
  assert(rows.some(row => row.title === 'Creator fee claimed'));
  assert.equal(rows.find(row => row.type === 'claim').amount, '0.25 SOL');
  assert.equal(rows.find(row => row.type === 'airdrop').amount, '12.5 QA');
  assert.equal(rows.find(row => row.type === 'bonus').amount, '0.2 SOL');
  assert(rows.every(row => row.href.includes('cluster=devnet')));
  assert.deepEqual(walletHistoryRows({ wallet:mint, experience, airdrops, bonusClaims }), []);
});

test('amount formatting keeps lamport precision and declines an unprovable token scale', () => {
  assert.equal(walletHistorySol('123127'), '0.000123127 SOL');
  assert.equal(walletHistoryTokenAmount('2500000','100','100000000'), '2.5');
  assert.equal(walletHistoryTokenAmount('1','3','10'), null);
});
