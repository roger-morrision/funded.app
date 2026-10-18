import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Connection, PublicKey } from '@solana/web3.js';
import { getPumpAmmProgram, PUMP_AMM_PROGRAM_ID } from '@pump-fun/pump-swap-sdk';
import { dailyBonusTradeRows, readDailyBonusTrades, readDailyBonusEvidence } from '../server/daily-bonus-evidence.mjs';
import { DEVNET_GENESIS_HASH } from '../server/automatic-reward-chain.mjs';
import { buildFeeDistributionPolicy } from '../distribution-policy.js';
const fixture = JSON.parse(readFileSync(new URL('./fixtures/postmigration-pumpswap-events.json', import.meta.url)));
const mint = new PublicKey(fixture.mint), pool = new PublicKey(fixture.pool);
const coder = getPumpAmmProgram(new Connection('http://localhost:8899')).coder.events;
const item = fixture.cases[0];
const ref = { signature:item.signature, slot:item.slot, blockTime:item.blockTime, confirmationStatus:'finalized', err:null };
const tx = () => ({ slot:item.slot, blockTime:item.blockTime, meta:{ err:null, logMessages:item.logs },
  transaction:{ signatures:[item.signature] } });
test('trader rank uses finalized program-emitted wallet and volume, rejecting spoofed or failed logs', () => {
  const rows = dailyBonusTradeRows(tx(), ref, mint, pool, coder.decode.bind(coder));
  assert.equal(rows.length, 1); assert.equal(rows[0].amountLamports, '9499999');
  assert.equal(new PublicKey(rows[0].wallet).toBase58(), rows[0].wallet);
  const spoof = tx(); spoof.meta.logMessages = item.logs.map(log => log.replaceAll(PUMP_AMM_PROGRAM_ID.toBase58(), mint.toBase58()));
  assert.deepEqual(dailyBonusTradeRows(spoof, ref, mint, pool, coder.decode.bind(coder)), []);
  assert.throws(() => dailyBonusTradeRows({ ...tx(), slot:1 }, ref, mint, pool, coder.decode.bind(coder)), /proof/);
  const failed = tx(); failed.meta.err = { InstructionError:[0, 'failed'] };
  assert.throws(() => dailyBonusTradeRows(failed, ref, mint, pool, coder.decode.bind(coder)), /proof/);
});
test('trading snapshot scans finalized history and refuses missing transactions or capped partial coverage', async () => {
  const connection = { getAccountInfo:async () => ({ owner:PUMP_AMM_PROGRAM_ID }),
    getSignaturesForAddress:async (_, __, commitment) => { assert.equal(commitment, 'finalized'); return [ref]; },
    getTransaction:async () => tx() };
  const params = { connection, launch:{ mint:fixture.mint }, window:{ start:item.blockTime - 1, end:item.blockTime + 1 } };
  const result = await readDailyBonusTrades(params); assert.equal(result.coverage.complete, true);
  connection.getTransaction = async () => null;
  await assert.rejects(readDailyBonusTrades(params), /proof/);
  connection.getTransaction = async () => tx();
  await assert.rejects(readDailyBonusTrades({ ...params, pageSize:1, maxPages:1 }), /scan limit/);
});
test('snapshot waits for finalized chain time and rejects a different genesis', async () => {
  const now = Date.parse('2026-10-18T00:00:00Z') / 1000;
  const params = { day:'2026-10-17', now, state:{}, programId:fixture.mint,
    connection:{ getGenesisHash:async () => DEVNET_GENESIS_HASH, getSlot:async () => 123,
      getBlockTime:async () => now - 1 } };
  await assert.rejects(readDailyBonusEvidence(params), /cutoff is finalized/);
  params.connection.getGenesisHash = async () => 'mainnet';
  await assert.rejects(readDailyBonusEvidence(params), /not Devnet/);
});

test('creator and referrer ranks use finalized collected fees and the frozen direct inviter', async () => {
  const now = Date.parse('2026-10-18T00:00:00Z') / 1000, start = now - 86400;
  const creator = fixture.pool, referrer = fixture.mint, programId = fixture.pool;
  const launch = { mint:fixture.mint, creatorWallet:creator, createdTimestamp:start - 1,
    cluster:'devnet', onchainVerified:true, feeDistribution:buildFeeDistributionPolicy({ creatorWalletPercent:80 }),
    pumpFeeRoute:{ scope:'per-mint-v3', programId, verified:true, initialAuthority:creator } };
  const settled = { status:'finalized', settlementSignature:'settled', referralUpline:[referrer] };
  const state = { launches:{ [fixture.mint]:launch }, collections:{ receipt:{ signature:'receipt',
    mint:fixture.mint, cluster:'devnet', scope:'per-mint-v3', programId, status:'collected',
    onchainVerified:true, attribution:'mint-verified', collectedLamports:'1000000' } },
    v3Settlements:{ receipt:settled }, referrals:{ attributions:{ [creator]:{ inviterWallet:creator } } } };
  const params = { day:'2026-10-17', now, programId, state,
    connection:{ getGenesisHash:async () => DEVNET_GENESIS_HASH, getSlot:async () => 123,
      getBlockTime:async () => now, getTransaction:async () => ({ blockTime:start + 1 }) },
    verifyCollection:async () => ({ expectedLamports:1000000n, claimId:Buffer.alloc(32) }),
    loadSettlement:async () => ({ mint:fixture.mint, expectedLamports:'1000000',
      categoryLamports:['800000', '80000', '20000', '6000', '4000', '40000', '50000'] }),
    readTrades:async () => ({ rows:[], coverage:{ mint:fixture.mint, complete:true } }) };
  const evidence = await readDailyBonusEvidence(params);
  assert.equal(evidence.collections[0].creator, creator);
  assert.equal(evidence.collections[0].referrer, referrer);
  assert.equal(evidence.collections[0].amountLamports, '1000000');
  assert.equal(evidence.collections[0].communityLamports, '40000');
  delete settled.referralUpline;
  await assert.rejects(readDailyBonusEvidence(params), /attribution has not been frozen/);
});
