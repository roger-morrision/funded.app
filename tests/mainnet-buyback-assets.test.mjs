import test from 'node:test';
import assert from 'node:assert/strict';
import {buybackAssets,V3_DEVNET_FUNDED_MINT,V3_DEVNET_FUNDED_POOL} from '../server/buyback-assets.mjs';
import {buildV3BuybackInstruction} from '../server/v3-buyback-instruction.mjs';
import {quoteV3Buyback} from '../server/v3-buyback-quote.mjs';
import {loadFinalizedV3Buyback} from '../server/v3-buyback-proof.mjs';
import {SOLANA_GENESIS} from '../solana-network.js';

test('Mainnet buybacks never fall back to pilot assets or accept a request-selected program',()=>{
  const devnet=buybackAssets('devnet');
  assert(devnet.mint.equals(V3_DEVNET_FUNDED_MINT));assert(devnet.pool.equals(V3_DEVNET_FUNDED_POOL));
  assert.throws(()=>buybackAssets('testnet'),/Unsupported/);
  assert.throws(()=>buybackAssets('mainnet-beta'),/reviewed/);
  for(const agencyPolicy of [false,true])assert.throws(()=>buildV3BuybackInstruction({cluster:'mainnet-beta',
    programId:'9H1r2nTZs6gQaheYTMaBWpH12JX6dCFj2Rvxg7Lno2Sm',agencyPolicy}),/reviewed/);
});
test('unreviewed Mainnet buyback quote and finality proof cannot read RPC data',async()=>{
  let reads=0;const connection=new Proxy({},{get:()=>()=>{reads++;throw Error('unexpected RPC');}});
  const input={cluster:'mainnet-beta',programId:'9H1r2nTZs6gQaheYTMaBWpH12JX6dCFj2Rvxg7Lno2Sm',connection};
  await assert.rejects(()=>quoteV3Buyback(input),/reviewed/);
  assert.equal(await loadFinalizedV3Buyback(input),null);assert.equal(reads,0);
});
test('Devnet buyback quotes reject a Mainnet RPC before pool or mint reads',async()=>{
  let reads=0;const connection={getGenesisHash:async()=>SOLANA_GENESIS['mainnet-beta'],getAccountInfo:async()=>{reads++;}};
  await assert.rejects(()=>quoteV3Buyback({connection,budgetLamports:'10000'}),/network/);assert.equal(reads,0);
});
