import test from 'node:test';
import assert from 'node:assert/strict';
import BN from 'bn.js';
import {tokenBurnSummary} from '../src/features/coin/burn-summary-model.js';
import {formatBondingCurveSnapshot} from '../pump-trading.js';
const mint='11111111111111111111111111111111',tokenProgram='TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const summary=(current='750000000000000',initial='1000000000000000',extra={})=>tokenBurnSummary({mint,tokenProgram,curve:{mint,tokenTotalSupplyBaseUnits:initial},parsedMint:{isInitialized:true,decimals:6,supply:current,mintAuthority:null},...extra});
test('burn totals count the whole immutable mint supply reduction with the original-supply denominator',()=>{
  const value=summary();assert.equal(value.burnedTokens,'250,000,000');assert.equal(value.burnedPercent,'25%');assert.equal(value.initialTokens,'1,000,000,000');assert.equal(value.currentTokens,'750,000,000');
  assert.equal(summary('1000000000000000').burnedPercent,'0%');assert.equal(summary('1000000000000000').burnedTokens,'0');assert.equal(summary('0').burnedPercent,'100%');
});
test('raw integers, fractional tokens and very small nonzero percentages never round to false zero',()=>{
  const tiny=summary('999999999999999');assert.equal(tiny.burnedTokens,'0.000001');assert.equal(tiny.burnedPercent,'<0.000001%');
  const huge=summary('9007199254740993000','9007199254740993123');assert.equal(huge.burnedBaseUnits,'123');assert.equal(huge.burnedTokens,'0.000123');
  assert.equal(summary('876543211000000').burnedPercent,'12.345678%');
});
test('unknown baselines, wrong mint and token owner, inflation, and inconsistent data stay unavailable',()=>{
  for(const value of[summary('1',null),summary('1','0'),summary('1','100',{curve:{mint:'other',tokenTotalSupplyBaseUnits:'100'}}),summary('1','100',{tokenProgram:'unverified'}),summary('101','100'),summary('1','18446744073709551616'),summary('01'),summary('1e6')])assert.equal(value.status,'unavailable');
  for(const patch of[{mintAuthority:mint},{mintAuthority:undefined},{isInitialized:false},{decimals:9},{decimals:'6'},{supply:750000000000000}])assert.equal(summary(undefined,undefined,{parsedMint:{isInitialized:true,decimals:6,supply:'750000000000000',mintAuthority:null,...patch}}).status,'unavailable');
});
test('curve snapshots retain the exact per-mint supply integer and do not invent a default',()=>{
  const curve={virtualTokenReserves:new BN(1000000),virtualQuoteReserves:new BN(1000000000),realTokenReserves:new BN(250000),realQuoteReserves:new BN(500000000),tokenTotalSupply:new BN('9007199254740993123')};
  assert.equal(formatBondingCurveSnapshot({mint,bondingCurve:curve}).tokenTotalSupplyBaseUnits,'9007199254740993123');
  delete curve.tokenTotalSupply;assert.equal(formatBondingCurveSnapshot({mint,bondingCurve:curve}).tokenTotalSupplyBaseUnits,null);
});
