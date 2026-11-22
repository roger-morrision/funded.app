import assert from 'node:assert/strict';
import {USDC_SOL_SELL_MARKET} from '../../server/token-conversion-sell.mjs';
import {SOLANA_GENESIS} from '../../solana-network.js';
import {capture,account} from './token-sell-capture-fixture.mjs';

export function quoteFixture(){
  const f={rows:new Map(capture.accounts.map(a=>[a.address,account(a.address)])),reads:[],now:Date.parse(capture.observedAt),slot:capture.slot,
    policy:{quoteMint:USDC_SOL_SELL_MARKET.mint,pool:USDC_SOL_SELL_MARKET.pool,maxOrderQuoteRaw:'10000000',maxDailyQuoteRaw:'100000000',maximumSlippageBps:100,maximumLiquidityClipBps:25}};
  f.connection={getGenesisHash:async()=>SOLANA_GENESIS['mainnet-beta'],getAccountInfoAndContext:async(address,options)=>{
    assert.equal(String(address),f.policy.pool);assert.equal(options.commitment,'finalized');f.reads.push(['pool',String(address)]);
    return {context:{slot:f.slot},value:f.rows.get(String(address))};},
    getMultipleAccountsInfoAndContext:async(addresses,options)=>{assert.equal(options.commitment,'finalized');assert.equal(options.minContextSlot,f.slot);
      f.reads.push(['market',addresses.map(String)]);return {context:{slot:f.slot},value:addresses.map(a=>f.rows.get(String(a)))};},
    getBlockTime:async slot=>{assert.equal(slot,f.slot);return Math.floor(f.now/1000);}};
  f.args=()=>({connection:f.connection,amountIn:'1000000',policy:f.policy,now:f.now});return f;
}
