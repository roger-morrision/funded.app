import test from 'node:test';
import assert from 'node:assert/strict';
import {Keypair,PublicKey,SystemProgram} from '@solana/web3.js';
import {MintLayout,TOKEN_PROGRAM_ID,TOKEN_2022_PROGRAM_ID,NATIVE_MINT} from '@solana/spl-token';
import {PUMP_PROGRAM_ID,bondingCurvePda} from '@pump-fun/pump-sdk';
import {canonicalPumpPoolPda} from '@pump-fun/pump-swap-sdk';
import {fetchRichMarketSnapshot,matchesRichPricingMarket} from '../rich-market.js';
import {createLaunchTierPricing} from '../server/launch-tier-pricing.mjs';
import {SOLANA_GENESIS} from '../solana-network.js';
import {currentFundedBuyQuote,FUNDED_BUY_QUOTE_TTL} from '../src/features/funded/buy-quotes.js';

const mint=Keypair.generate().publicKey,pool=canonicalPumpPoolPda(mint,NATIVE_MINT).toBase58();
function fixture(base=TOKEN_PROGRAM_ID){
  const mintData=Buffer.alloc(82);MintLayout.encode({mintAuthorityOption:0,mintAuthority:PublicKey.default,
    supply:1000000000000000n,decimals:6,isInitialized:true,freezeAuthorityOption:0,freezeAuthority:PublicKey.default},mintData);
  const curve={complete:false,virtualQuoteReserves:30000000000n,virtualTokenReserves:1000000000000000n,
    realTokenReserves:700000000000000n,realQuoteReserves:0n,tokenTotalSupply:1000000000000000n,quoteMint:PublicKey.default};
  const accounts=[{owner:PUMP_PROGRAM_ID,data:Buffer.alloc(128)},{owner:base,data:mintData}];
  const connection={getGenesisHash:async()=>SOLANA_GENESIS.devnet,getMultipleAccountsInfoAndContext:async(keys,commitment)=>{
    assert.equal(commitment,'finalized');assert(keys[0].equals(bondingCurvePda(mint)));assert(keys[1].equals(mint));
    return {context:{slot:123},value:accounts};}};
  const args={connection,mint,poolAddress:pool,decodeCurve:()=>curve};
  return {args,curve,accounts};
}
test('RICH uses a live bonding curve for either SPL token program without requiring a pool',async()=>{
  for(const base of [TOKEN_PROGRAM_ID,TOKEN_2022_PROGRAM_ID]){
    const {args}=fixture(base);
    const snapshot=await fetchRichMarketSnapshot({...args,poolAddress:'',readPool:()=>{throw Error('must not use pool');}});
    assert.equal(snapshot.market,'pump-curve');assert.equal(snapshot.pool,null);assert.equal(snapshot.slot,123);
    assert.equal(snapshot.spotPriceSol,0.00000003);
    assert(matchesRichPricingMarket({...snapshot,fundedMint:mint.toBase58()},{mint:mint.toBase58(),pool}));
  }
});
test('completed curves switch to the canonical pool and never use obsolete curve prices',async()=>{
  const {args,curve}=fixture();curve.complete=true;
  let reads=0;
  const snapshot=await fetchRichMarketSnapshot({...args,readPool:async({poolAddress})=>{
    reads++;assert.equal(poolAddress,pool);return{pool:poolAddress,mint:mint.toBase58(),spotPriceSol:0.01};}});
  assert.equal(snapshot.market,'pump-swap');assert.equal(snapshot.spotPriceSol,0.01);assert.equal(reads,1);
  await assert.rejects(()=>fetchRichMarketSnapshot({...args,readPool:async()=>{throw Error('migration pending');}}),/migration pending/);
  await assert.rejects(()=>fetchRichMarketSnapshot({...args,poolAddress:Keypair.generate().publicKey.toBase58()}),/does not match/);
});
test('missing curves support the approved existing pool; invalid owners and RPC errors cannot select it',async()=>{
  const {args,accounts}=fixture();accounts[0]=null;
  const result=await fetchRichMarketSnapshot({...args,readPool:async()=>({pool,spotPriceSol:1})});
  assert.equal(result.market,'pump-swap');
  accounts[0]={owner:SystemProgram.programId,data:Buffer.alloc(128)};
  await assert.rejects(()=>fetchRichMarketSnapshot(args),/owner is invalid/);
  args.connection.getMultipleAccountsInfoAndContext=async()=>{throw Error('RPC unavailable');};
  await assert.rejects(()=>fetchRichMarketSnapshot(args),/RPC unavailable/);
});
test('promotion and listing pricing accepts curve prices without a pool and binds the mint/curve identity',async()=>{
  const {args}=fixture();
  const pricing=createLaunchTierPricing({solanaCluster:'devnet',fundedTokenMint:mint.toBase58(),fundedSwapPool:'',
    connectionFactory:()=>args.connection,readMarket:input=>fetchRichMarketSnapshot({...input,decodeCurve:args.decodeCurve}),
    readSolUsdQuote:async()=>({priceUsd:100,fetchedAt:new Date().toISOString()})});
  const quote=await pricing.currentLaunchTierPricing();
  assert.equal(quote.source,'verified-pump-bonding-curve');assert.equal(quote.pool,null);
  assert(quote.amounts.pro>0);assert(quote.amounts.premier>quote.amounts.pro);
  assert(matchesRichPricingMarket(quote,{mint:mint.toBase58(),pool:''}));
  assert(!matchesRichPricingMarket({...quote,bondingCurve:Keypair.generate().publicKey.toBase58()},{mint:mint.toBase58(),pool}));
  assert(!matchesRichPricingMarket({...quote,fundedMint:Keypair.generate().publicKey.toBase58()},{mint:mint.toBase58(),pool}));
});

test('wallet RICH quotes and promotion prices cannot cross RPC networks',async()=>{
  const {args}=fixture();let reads=0;
  args.connection.getMultipleAccountsInfoAndContext=async()=>{reads++;throw Error('unexpected read');};
  await assert.rejects(()=>fetchRichMarketSnapshot({...args,cluster:'mainnet-beta'}),/network/);assert.equal(reads,0);
  const data={fundedMint:mint.toBase58(),pool,market:'pump-swap',cluster:'devnet',genesisHash:SOLANA_GENESIS.devnet};
  const identity={mint:mint.toBase58(),pool,cluster:'devnet'};
  assert(matchesRichPricingMarket(data,identity));
  assert(!matchesRichPricingMarket({...data,genesisHash:SOLANA_GENESIS['mainnet-beta']},identity));
  assert(!matchesRichPricingMarket({...data,cluster:'mainnet-beta'},identity));
  assert(!matchesRichPricingMarket({...data,market:'unknown-market'},identity));
});

test('prepared RICH quotes expire, reject future timestamps and bind the wallet session',()=>{
  const provider={},quote={amount:1,wallet:'wallet',provider,preparedAt:100000};
  const app={wallet:provider,connectedWalletAddress:'wallet',fundedBuyPreview:quote};
  assert.equal(currentFundedBuyQuote(app,1,100001),quote);
  assert.equal(currentFundedBuyQuote(app,1,99999),null);
  assert.equal(currentFundedBuyQuote(app,1,100000+FUNDED_BUY_QUOTE_TTL),null);
  assert.equal(currentFundedBuyQuote({...app,wallet:{}},1,100001),null);
  assert.equal(currentFundedBuyQuote(app,2,100001),null);
});
