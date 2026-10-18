import { test } from 'node:test';
import assert from 'node:assert/strict';
import { walletHistoryRows, walletHistorySol, walletHistoryTokenAmount, walletBonusCoverage } from '../src/features/portfolio/wallet-history-model.js';

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


const dailyPayment = { finalized:true, balanceDeltaVerified:true, amount:'500', amountReceived:'450',
  signature:'C'.repeat(64), payment:'D'.repeat(32), paidAt:'2026-10-17T12:00:00Z' };
const dailyBonus = { cluster:'devnet', snapshots:[{ day:'2026-10-17', status:'snapshotted',
  sources:[{ payments:{ [wallet]:dailyPayment, [mint]:{ ...dailyPayment, signature:'E'.repeat(64) } } },
    { payments:{ [wallet]:dailyPayment } }] }] };

test('wallet Daily bonus history uses its own net receipts and deduplicates payment proofs', () => {
  const rows = walletHistoryRows({ wallet, dailyBonus });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].type, 'bonus');
  assert.equal(rows[0].title, 'Daily bonus received');
  assert.equal(rows[0].amount, '0.00000045 SOL');
  assert.match(rows[0].detail, /2026-10-17 UTC/);
  assert.match(rows[0].href, /tx\/C{64}\?cluster=devnet$/);
  assert.equal(rows[0].time, Date.parse('2026-10-17T12:00:00Z'));
  assert.deepEqual(walletHistoryRows({ wallet, dailyBonus:{ ...dailyBonus, cluster:'mainnet-beta' } }), []);
});
test('unfunded or unfinalized Daily bonus allocations do not enter wallet payment history', () => {
  const pending = structuredClone(dailyBonus);
  for (const source of pending.snapshots[0].sources) source.payments[wallet].finalized = false;
  assert.deepEqual(walletHistoryRows({ wallet, dailyBonus:pending }), []);
});
test('recovered bonus payments link their proof account and missing net evidence is not guessed', () => {
  const recovered = structuredClone(dailyBonus);
  recovered.snapshots[0].sources = [{ payments:{ [wallet]:{ ...dailyPayment, signature:null, amountReceived:undefined } } }];
  const rows = walletHistoryRows({ wallet, dailyBonus:recovered });
  assert.equal(rows[0].title, 'Daily bonus payment recorded');
  assert.equal(rows[0].amount, 'Received amount unavailable');
  assert.match(rows[0].href, /address\/D{32}/);
});
test('bonus coverage distinguishes private sign-in, outages, and complete recent feeds', () => {
  assert.equal(walletBonusCoverage({ dailyBonus:'ready', referralBonus:'sign-in-required' }).state, 'partial');
  assert.match(walletBonusCoverage({ dailyBonus:'ready', referralBonus:'sign-in-required' }).message, /Verify this wallet in Referrals/);
  assert.match(walletBonusCoverage({ dailyBonus:'unavailable', referralBonus:'ready' }).message, /Daily bonus history is unavailable/);
  assert.equal(walletBonusCoverage({ dailyBonus:'ready', referralBonus:'ready' }).state, 'ready');
  assert.equal(walletBonusCoverage({ dailyBonus:'unavailable', referralBonus:'unavailable' }).state, 'unavailable');
});
