import test from 'node:test';
import assert from 'node:assert/strict';
import { describeTradeQuote, estimateBuyTokenAmountFromSnapshot, tradeTokenSymbol } from '../trade-quote-display.js';
import { buildTradeReview } from '../trade-review-model.js';
import { reviewRows } from '../src/features/shared/transaction-review.js';
import { roleSteps } from '../src/features/experience/get-started.js';
import { metricTone } from '../src/features/experience/metric-accents.js';

test('quote symbols resolve matching token records while metadata loads', () => {
  const mint = 'EjcH3cizxAevcYHRjq29z1DQdn6oATap4uN9fRzTD2sa';
  assert.equal(tradeTokenSymbol(mint, [{mint:'other',symbol:'WRONG'}, {mint,symbol:'EjcH…'}, {address:mint,symbol:'RCAT'}]), 'RCAT');
  assert.equal(tradeTokenSymbol(mint, [{mint,symbol:mint}, {mint,symbol:'EjcH…D2sa'}]), 'tokens');
  assert.equal(tradeTokenSymbol(mint, [{mint,symbol:' RCAT\u0000 '}]), 'RCAT');
});

test('metric accents distinguish zero, unavailable values and gain or loss', () => {
  for (const value of ['—', '$—', 'None yet', 'Checking…', '10 unavailable']) assert.equal(metricTone(value), 'muted');
  assert.equal(metricTone('0 SOL'), 'info');
  assert.equal(metricTone('−2.3%'), 'danger');
  assert.equal(metricTone('-$12.34'), 'danger');
  assert.equal(metricTone('+2.3%'), 'success');
  assert.equal(metricTone('2.3%', 0, 'negative'), 'danger');
  assert.equal(metricTone('≥$98.81', 1), 'success');
  assert.equal(metricTone('3%', 2), 'accent');
});

test('lazy quote display keeps integer slippage floors and net sell fees', () => {
  const trade={side:'sell',tokenDecimals:6,outputAmount:1000000007n,feeLamports:10000000};
  const quote=describeTradeQuote(trade,1);
  assert.equal(quote.minimum,0.990000006);
  assert.equal(quote.minimumNetSol,0.980000006);
  assert.equal(quote.expectedNetSol,0.990000007);
});
test('explicit pool bounds take precedence over computed slippage', () => {
  const quote=describeTradeQuote({side:'buy',tokenDecimals:6,outputAmount:2000000n,minimumOutputAmount:1900001n,maximumInputAmount:1100000000n,feeLamports:10000,route:'graduated-pool'},5);
  assert.equal(quote.minimum,1.900001);assert.equal(quote.maximumSpendSol,1.1);
  assert.equal(quote.route,'graduated-pool');
});
test('lightweight reserve estimates reject unavailable market data', () => {
  assert.throws(()=>estimateBuyTokenAmountFromSnapshot({amountSol:1}),/unavailable/);
  assert.throws(()=>estimateBuyTokenAmountFromSnapshot({amountSol:0}),/positive/);
  const estimate=estimateBuyTokenAmountFromSnapshot({amountSol:1,curveSnapshot:{virtualTokenReserves:1000,virtualQuoteReservesSol:9,observedAt:123}});
  assert.equal(estimate.expectedTokens,100);assert.equal(estimate.observedAt,123);
});
test('review retains full recipient and distinguishes missing network and fees', () => {
  const address='FjLFTiqgp1LH5aRJ39U9CREGxLSFBD8rb7x1QW7DVJZQ';
  const rows=Object.fromEntries(reviewRows({recipient:address}));
  assert.equal(rows.Recipient,address);assert.equal(rows.Network,'Network unavailable');
  assert.match(rows.Fees,/Unavailable/);assert.equal(rows['Expected result'],'Pending verification');
  assert.match(reviewRows({network:'devnet'})[0][1],/test assets/);
});
test('shared summary uses the prepared trade amount including app fee', () => {
  const review=buildTradeReview({trade:{side:'buy',outputAmount:1000000n,quoteAmount:1000000000n,tokenDecimals:6,feeLamports:10000000},side:'buy',amount:1,slippagePercent:1,tokenSymbol:'TEST'});
  const rows=Object.fromEntries(reviewRows({network:'devnet',amount:review.payAmount,result:review.receiveAmount}));
  assert.equal(rows.Amount,'1.01 SOL');assert.equal(rows['Expected result'],'1 TEST');
});
test('all onboarding roles have three actionable steps with current routes', () => {
  const routes=new Set(['#launch','#payments/creator','#explore','#my-launches','#payments/holders','#referrals']);
  assert.deepEqual(Object.keys(roleSteps),['creator','holder','referrer']);
  for(const steps of Object.values(roleSteps)){assert.equal(steps.length,3);for(const [title,text,route]of steps){assert.ok(title&&text);assert.ok(routes.has(route));}}
});

test('lazy trade module still prepares the phone review before wallet approval', async () => {
  const {submitTrade}=await import('../src/features/trade/lazy-trading.js');
  const {Keypair,SystemProgram}=await import('@solana/web3.js');
  const {default:BN}=await import('bn.js');
  const user=Keypair.generate().publicKey, mint=Keypair.generate().publicKey;
  let summary;
  const trade={side:'buy',mint,user,inputAmount:1,slippagePercent:1,outputAmount:new BN(1000000),quoteAmount:new BN(1000000000),tokenDecimals:6,feeLamports:10000000,
    instructions:[SystemProgram.transfer({fromPubkey:user,toPubkey:mint,lamports:1000000000})]};
  await assert.rejects(submitTrade({side:'buy',mint,user,amount:1,preparedTrade:trade,
    connection:{getLatestBlockhash:async()=>({blockhash:Keypair.generate().publicKey.toBase58(),lastValidBlockHeight:10})},
    provider:{remoteMobile:true,signTransaction:async tx=>{summary=tx.fundedTradeSummary;throw Error('Mock approval cancelled');}}}),/Mock approval cancelled/);
  assert.equal(summary.minimumTokenAmount,'0.990000');assert.equal(summary.maximumTotalSol,'1.020000000');
});
