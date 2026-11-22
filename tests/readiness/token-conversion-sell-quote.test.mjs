import test from 'node:test';
import assert from 'node:assert/strict';
import {PublicKey} from '@solana/web3.js';
import {GLOBAL_CONFIG_PDA,PUMP_AMM_FEE_CONFIG_PDA,PUMP_AMM_SDK} from '@pump-fun/pump-swap-sdk';
import {TOKEN_PROGRAM_ID,NATIVE_MINT} from '@solana/spl-token';
import {independentTokenSellQuote,requireTokenSellPolicy} from '../../server/token-conversion-sell-quote.mjs';
import {USDC_SOL_SELL_MARKET} from '../../server/token-conversion-sell.mjs';
import {SOLANA_GENESIS} from '../../solana-network.js';
import {capture,account} from './token-sell-capture-fixture.mjs';

import {quoteFixture} from './token-sell-quote-fixture.mjs';

test('independent sell pricing recomputes captured SDK output and policy floor from finalized raw accounts',async()=>{
  const f=quoteFixture(),quote=await independentTokenSellQuote(f.args());
  assert.equal(quote.expectedLamports,'14211301');assert.equal(quote.minimumLamports,'14069187');
  assert.equal(quote.slot,capture.slot);assert.equal(f.reads.length,2);
  assert.equal(f.reads[1][1].length,7);assert.ok(quote.protocolRecipients.length>0&&quote.buybackRecipients.length>0);
});

test('unreviewed market, noncanonical limits and widened slippage or liquidity cannot enter pricing',async()=>{
  for(const change of [{pool:String(PublicKey.default)},{quoteMint:String(NATIVE_MINT)},{maxOrderQuoteRaw:'0'},
    {maxOrderQuoteRaw:'01'},{maxDailyQuoteRaw:'1'},{maximumSlippageBps:101},{maximumSlippageBps:-1},{maximumLiquidityClipBps:26}]){
    const f=quoteFixture();f.policy={...f.policy,...change};assert.throws(()=>requireTokenSellPolicy(f.policy));
    await assert.rejects(independentTokenSellQuote(f.args()));assert.equal(f.reads.length,0);
  }
});

test('wrong genesis, over-order input and absent market prevent any usable price',async()=>{
  const f=quoteFixture();f.connection.getGenesisHash=async()=> 'wrong-network';await assert.rejects(independentTokenSellQuote(f.args()));assert.equal(f.reads.length,0);
  const g=quoteFixture();await assert.rejects(independentTokenSellQuote({...g.args(),amountIn:'10000001'}),/order bound/);assert.equal(g.reads.length,0);
  const h=quoteFixture();h.rows.delete(h.policy.pool);await assert.rejects(independentTokenSellQuote(h.args()),/unavailable/);
});

test('pool/global/fee configuration owners and pool custody must authenticate',async()=>{
  for(const address of [USDC_SOL_SELL_MARKET.pool,String(GLOBAL_CONFIG_PDA),String(PUMP_AMM_FEE_CONFIG_PDA)]){
    const f=quoteFixture();f.rows.get(address).owner=PublicKey.default;await assert.rejects(independentTokenSellQuote(f.args()));
  }
  for(const offset of [43,75,139,211,243,244]){const f=quoteFixture();f.rows.get(f.policy.pool).data[offset]^=1;await assert.rejects(independentTokenSellQuote(f.args()));}
});

test('reserve token owners, mint decimals, vault authority and frozen accounts cannot be substituted',async()=>{
  const original=quoteFixture(),pool=PUMP_AMM_SDK.decodePool(original.rows.get(original.policy.pool));
  for(const address of [USDC_SOL_SELL_MARKET.mint,String(NATIVE_MINT),String(pool.poolBaseTokenAccount),String(pool.poolQuoteTokenAccount)]){
    const f=quoteFixture();f.rows.get(address).owner=PublicKey.default;await assert.rejects(independentTokenSellQuote(f.args()));
  }
  for(const [address,offset,value]of [[USDC_SOL_SELL_MARKET.mint,44,7],[String(pool.poolBaseTokenAccount),32,7],[String(pool.poolBaseTokenAccount),108,2]]){
    const f=quoteFixture();f.rows.get(address).data[offset]=value;await assert.rejects(independentTokenSellQuote(f.args()));
  }
});

test('empty reserves and inputs exceeding the actual liquidity clip cannot be priced',async()=>{
  for(const side of ['poolBaseTokenAccount','poolQuoteTokenAccount']){
    const f=quoteFixture(),pool=PUMP_AMM_SDK.decodePool(f.rows.get(f.policy.pool));f.rows.get(String(pool[side])).data.writeBigUInt64LE(0n,64);
    await assert.rejects(independentTokenSellQuote(f.args()));
  }
  const f=quoteFixture(),pool=PUMP_AMM_SDK.decodePool(f.rows.get(f.policy.pool));f.rows.get(String(pool.poolBaseTokenAccount)).data.writeBigUInt64LE(1000000n,64);
  await assert.rejects(independentTokenSellQuote(f.args()),/liquidity clip/);
});

test('backwards or stale finalized snapshots and unavailable reads stay unavailable',async()=>{
  const f=quoteFixture(),read=f.connection.getMultipleAccountsInfoAndContext;f.connection.getMultipleAccountsInfoAndContext=async(...args)=>({...await read(...args),context:{slot:capture.slot-1}});
  await assert.rejects(independentTokenSellQuote(f.args()),/backwards/);
  const g=quoteFixture();g.connection.getBlockTime=async()=>Math.floor(g.now/1000)-91;await assert.rejects(independentTokenSellQuote(g.args()),/stale/);
  const h=quoteFixture();h.connection.getAccountInfoAndContext=async()=>{throw Error('RPC unavailable');};await assert.rejects(independentTokenSellQuote(h.args()),/unavailable/);
  for(const slot of [undefined,0,-1,'1000',Infinity]){
    const g=quoteFixture(),read=g.connection.getAccountInfoAndContext;
    g.connection.getAccountInfoAndContext=async(...args)=>({...await read(...args),context:{slot}});
    await assert.rejects(independentTokenSellQuote(g.args()),/context/);
  }
});
