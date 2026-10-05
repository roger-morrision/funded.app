import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Connection, PublicKey, clusterApiUrl } from '@solana/web3.js';
import { PUMP_AMM_PROGRAM_ID, getPumpAmmProgram } from '@pump-fun/pump-swap-sdk';
import { decodePumpSwapTrades, readPumpMarketActivity } from '../server/coin-market.mjs';

// Exact PumpSwap event data from two finalized Devnet transactions on the
// fresh QA mint. The signer and account balances are intentionally omitted.
const fixture = JSON.parse(readFileSync(new URL('./fixtures/postmigration-pumpswap-events.json', import.meta.url), 'utf8'));
const pool = new PublicKey(fixture.pool);
const mint = new PublicKey(fixture.mint);
const connection = new Connection(clusterApiUrl('devnet'));
const eventCoder = getPumpAmmProgram(connection).coder.events;
const decodeEvent = eventCoder.decode.bind(eventCoder);

test('finalized PumpSwap events decode exact trade side and trader quote volume', () => {
  const [buy, sell] = fixture.cases.map(item => decodePumpSwapTrades(item.logs, pool, decodeEvent));
  assert.equal(buy.length, 1);
  assert.equal(sell.length, 1);
  assert.equal(buy[0].isBuy, true);
  assert.equal(sell[0].isBuy, false);
  assert.equal(buy[0].solLamports, 9_499_999n);
  assert.equal(sell[0].solLamports, 9_265_432n);
  assert.equal(buy[0].tokenAmountRaw, 471_552_674_318n);
  assert.equal(sell[0].tokenAmountRaw, 471_552_674_318n);
  assert.equal(buy[0].trader, 'Gv3uSJu2Ki7eqC6V4H1Fc31MMXLih6TJR19a5sydPfr7');
  assert.equal(decodePumpSwapTrades(fixture.cases[0].logs, mint, decodeEvent).length, 0, 'Wrong pool must not count.');
  const spoofed = fixture.cases[0].logs.map(log => log.replaceAll(PUMP_AMM_PROGRAM_ID.toBase58(), mint.toBase58()));
  assert.equal(decodePumpSwapTrades(spoofed, pool, decodeEvent).length, 0, 'Another program cannot emit a counted PumpSwap event.');
});

function fakeConnection({ duplicate = false, includeCurve = false } = {}) {
  const fake = new Connection(clusterApiUrl('devnet'));
  fake.getAccountInfo = async address => address.equals(pool) ? { owner:PUMP_AMM_PROGRAM_ID } : null;
  fake.getSignaturesForAddress = async address => address.equals(pool)
    ? [...fixture.cases].reverse().concat(duplicate ? fixture.cases[0] : []).map(item => ({ signature:item.signature, blockTime:item.blockTime, err:null }))
    : includeCurve ? [{ signature:fixture.curveCase.signature, blockTime:fixture.curveCase.blockTime, err:null }] : [];
  fake.getTransaction = async signature => {
    const item = [...fixture.cases, fixture.curveCase].find(entry => entry.signature === signature);
    return item ? { blockTime:item.blockTime, meta:{ logMessages:item.logs } } : null;
  };
  return fake;
}

test('market activity merges the two pool receipts once with exact 24h volume', async () => {
  const data = await readPumpMarketActivity({ connection:fakeConnection({ duplicate:true }), mint,
    nowSeconds:Math.max(...fixture.cases.map(item => item.blockTime)) + 30 });
  assert.equal(data.tradeCount24h, 2);
  assert.equal(data.buyCount24h, 1);
  assert.equal(data.sellCount24h, 1);
  assert.equal(data.poolTradeCount24h, 2);
  assert.equal(data.volume24hSol, 0.018765431);
  assert.equal(data.buyVolume24hSol, 0.009499999);
  assert.equal(data.sellVolume24hSol, 0.009265432);
  assert.equal(data.activityWindows['24h'].traderCount, 1);
  assert.equal(data.coverage, 'complete');
  assert.deepEqual(data.recentTrades.map(trade => trade.signature), [fixture.cases[1].signature, fixture.cases[0].signature]);
  assert.deepEqual(data.recentTrades.map(trade => trade.route), ['pool', 'pool']);
});

test('older trades remain in observed volume after the 24h window closes', async () => {
  const data = await readPumpMarketActivity({ connection:fakeConnection(), mint,
    nowSeconds:Math.max(...fixture.cases.map(item => item.blockTime)) + 2 * 24 * 60 * 60 });
  assert.equal(data.tradeCount24h, 0);
  assert.equal(data.volume24hSol, 0);
  assert.equal(data.observedTradeCount, 2);
  assert.equal(data.observedVolumeSol, 0.018765431);
  assert.equal(data.observedCoverage, 'complete');
});

test('bonding curve history stays in the merged feed after migration', async () => {
  const data = await readPumpMarketActivity({ connection:fakeConnection({ includeCurve:true }), mint,
    nowSeconds:Math.max(...fixture.cases.map(item => item.blockTime)) + 30 });
  assert.equal(data.tradeCount24h, 3);
  assert.equal(data.buyCount24h, 1);
  assert.equal(data.sellCount24h, 2);
  assert.equal(data.poolTradeCount24h, 2);
  assert.equal(data.volume24hSol, 0.503913943);
  assert.equal(data.coverage, 'complete');
  assert.deepEqual(data.recentTrades.map(trade => trade.signature),
    [fixture.cases[1].signature, fixture.cases[0].signature, fixture.curveCase.signature]);
  assert.deepEqual(data.recentTrades.map(trade => trade.route), ['pool', 'pool', 'curve']);
});

test('a capped pool signature page retains partial coverage', async () => {
  const data = await readPumpMarketActivity({ connection:fakeConnection(), mint, maxSignatures:2,
    nowSeconds:Math.max(...fixture.cases.map(item => item.blockTime)) + 30 });
  assert.equal(data.tradeCount24h, 2);
  assert.equal(data.coverage, 'partial');
});
