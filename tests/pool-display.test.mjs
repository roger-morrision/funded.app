import test from 'node:test';
import assert from 'node:assert/strict';
import { Keypair } from '@solana/web3.js';
import { NATIVE_MINT, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from '@solana/spl-token';
import { PUMP_AMM_PROGRAM_ID, poolPda } from '@pump-fun/pump-swap-sdk';
import { readPoolDisplayState } from '../pool-display-state.js';
import { automaticRewardsRouteVisible } from '../src/features/rewards/route-visibility.js';
import BN from 'bn.js';
import { canonicalPumpPoolPda, pumpPoolAuthorityPda, PUMP_PROGRAM_ID } from '@pump-fun/pump-sdk';
import { readCoinDisplaySnapshot } from '../coin-display-snapshot.js';
import { renderEarlyMarketPrice } from '../src/features/coin/early-market-price.js';
import {tokenBurnSummary} from '../src/features/coin/burn-summary-model.js';

function fixture(canonical=false,program=TOKEN_2022_PROGRAM_ID) {
  const mintKey=Keypair.generate().publicKey,creator=canonical?pumpPoolAuthorityPda(mintKey):Keypair.generate().publicKey;
  const poolKey=poolPda(0,creator,mintKey,NATIVE_MINT);
  const base=getAssociatedTokenAddressSync(mintKey,poolKey,true,program);
  const quote=getAssociatedTokenAddressSync(NATIVE_MINT,poolKey,true,TOKEN_PROGRAM_ID);
  const mintData=Buffer.alloc(82);mintData.writeBigUInt64LE(1000000000n,36);mintData[44]=6;mintData[45]=1;
  const account=(mint,amount,program)=>{const data=Buffer.alloc(165);mint.toBuffer().copy(data);poolKey.toBuffer().copy(data,32);data.writeBigUInt64LE(amount,64);data[108]=1;return {owner:program,data};};
  const poolInfo={owner:PUMP_AMM_PROGRAM_ID,data:Buffer.alloc(1)};
  const mintInfo={owner:program,data:mintData};
  const baseInfo=account(mintKey,1000000000n,program),quoteInfo=account(NATIVE_MINT,2000000000n,TOKEN_PROGRAM_ID);
  const accounts=new Map([[String(poolKey),poolInfo],[String(mintKey),mintInfo],[String(base),baseInfo],[String(quote),quoteInfo]]);
  const batches=[];
  const connection={getMultipleAccountsInfo:async keys=>{batches.push(keys.map(String));return keys.map(key=>accounts.get(String(key)));},getSlot:async()=>123};
  const pool={index:0,creator,baseMint:mintKey,quoteMint:NATIVE_MINT,poolBaseTokenAccount:base,poolQuoteTokenAccount:quote};
  return {connection,mintKey,poolKey,decodePool:()=>pool,pool,poolInfo,mintInfo,baseInfo,quoteInfo,batches};
}

test('display reads use two batches and retain verified decimals, balances and slot',async()=>{
  const f=fixture();const value=await readPoolDisplayState(f);
  assert.equal(f.batches.length,2);assert.equal(value.tokenDecimals,6);assert.equal(value.slot,123);
  assert.equal(value.state.poolBaseAmount.toString(),'1000000000');assert.equal(value.state.poolQuoteAmount.toString(),'2000000000');
});

function atomicFixture(program=TOKEN_2022_PROGRAM_ID) {
  const f=fixture(true,program),curveInfo={owner:PUMP_PROGRAM_ID,data:Buffer.alloc(1)};
  const expectedBase=String(f.pool.poolBaseTokenAccount);
  assert.equal(String(f.poolKey),String(canonicalPumpPoolPda(f.mintKey)));
  const curve={complete:true,tokenTotalSupply:new BN(2000000000),virtualTokenReserves:new BN(1000000000),virtualQuoteReserves:new BN(2000000000),
    realTokenReserves:new BN(1000000000),realQuoteReserves:new BN(1000000000),quoteMint:NATIVE_MINT};
  let calls=0;
  const connection={getMultipleAccountsInfoAndContext:async(keys,commitment)=>{
    calls++;assert.equal(commitment,'confirmed');assert.equal(keys.length,7);
    assert.equal(String(keys[3]),String(f.poolKey));assert.equal(String(keys[program.equals(TOKEN_PROGRAM_ID)?4:5]),expectedBase);
    return {context:{slot:456},value:[f.mintInfo,curveInfo,curveInfo,f.poolInfo,
      program.equals(TOKEN_PROGRAM_ID)?f.baseInfo:null,program.equals(TOKEN_2022_PROGRAM_ID)?f.baseInfo:null,f.quoteInfo]};
  }};
  return {...f,mint:f.mintKey,connection,curve,curveInfo,calls:()=>calls,
    decodeCurve:()=>curve,decodeGlobal:()=>({initialRealTokenReserves:new BN(2000000000)})};
}

test('atomic price snapshot verifies either token program in one confirmed RPC with its context slot',async()=>{
  for(const program of [TOKEN_PROGRAM_ID,TOKEN_2022_PROGRAM_ID]){
    const f=atomicFixture(program),snapshot=await readCoinDisplaySnapshot(f);
    assert.equal(f.calls(),1);assert.equal(snapshot.slot,456);assert.equal(snapshot.pool.slot,456);
    assert.equal(snapshot.pool.spotPriceSol,0.002);assert.equal(snapshot.mintInfo.value.data.parsed.info.supply,'1000000000');
    const burn=tokenBurnSummary({mint:String(f.mint),parsedMint:snapshot.mintInfo.value.data.parsed.info,
      curve:snapshot.curve,tokenProgram:String(program)});
    assert.equal(burn.status,'ready');
    assert.equal(burn.burnedBaseUnits,(BigInt(snapshot.curve.tokenTotalSupplyBaseUnits)-1000000000n).toString());
  }
});

test('active curves render without a pool and missing curves can use a verified canonical pool',async()=>{
  const active=atomicFixture();active.curve.complete=false;active.poolInfo.owner=TOKEN_PROGRAM_ID;
  const snapshot=await readCoinDisplaySnapshot(active);
  assert.equal(snapshot.curve.complete,false);assert.equal(snapshot.pool,null);assert.equal(snapshot.curve.progressPercent,50);
  const missing=atomicFixture();missing.decodeCurve=()=>{throw Error('missing curve');};
  assert.ok((await readCoinDisplaySnapshot(missing)).pool);
});

test('atomic display rejects invalid mints and withholds prices from unverified pools',async()=>{
  const mint=atomicFixture();mint.mintInfo.owner=PUMP_PROGRAM_ID;
  await assert.rejects(readCoinDisplaySnapshot(mint),/ownership/);
  const uninitialized=atomicFixture();uninitialized.mintInfo.data[45]=0;
  await assert.rejects(readCoinDisplaySnapshot(uninitialized),/initialized/);
  for(const invalidate of [f=>{f.poolInfo.owner=TOKEN_PROGRAM_ID;},
    f=>{f.pool.baseMint=Keypair.generate().publicKey;},
    f=>{f.pool.poolBaseTokenAccount=Keypair.generate().publicKey;},
    f=>{Keypair.generate().publicKey.toBuffer().copy(f.baseInfo.data,32);},
    f=>{f.quoteInfo.data.writeBigUInt64LE(0n,64);}]){
    const f=atomicFixture();invalidate(f);
    assert.equal((await readCoinDisplaySnapshot(f)).pool,null);
  }
});

test('verified price fields render without any holder or ledger data; unavailable prices stay unavailable',async()=>{
  const snapshot=await readCoinDisplaySnapshot(atomicFixture()),fields=new Map();
  const app={setCoinField:(key,value)=>fields.set(key,value),setCoinFact:(key,value)=>fields.set(key,value),
    formatCoinSnapshotUsd:value=>String(value),formatCoinUsd:value=>String(value)};
  renderEarlyMarketPrice(app,snapshot);
  assert.equal(fields.get('#coin-price'),'0.002');assert.equal(fields.get('#coin-stage'),'Migrated · PumpSwap');
  assert.equal(app.coinSolUsdValues.marketCap,2);
  fields.clear();renderEarlyMarketPrice(app,{...snapshot,pool:null});assert.equal(fields.size,0);
});

test('display prices reject wrong program, pool identity and vault authority',async()=>{
  const wrongProgram=fixture();wrongProgram.poolInfo.owner=TOKEN_PROGRAM_ID;
  await assert.rejects(readPoolDisplayState(wrongProgram),/ownership/);
  const wrongMint=fixture();wrongMint.pool.baseMint=Keypair.generate().publicKey;
  await assert.rejects(readPoolDisplayState(wrongMint),/identity/);
  const wrongAuthority=fixture();Keypair.generate().publicKey.toBuffer().copy(wrongAuthority.baseInfo.data,32);
  await assert.rejects(readPoolDisplayState(wrongAuthority),/vault/);
  const empty=fixture();empty.quoteInfo.data.writeBigUInt64LE(0n,64);
  await assert.rejects(readPoolDisplayState(empty),/vault/);
});

test('hidden rewards do not compete with token and wallet detail reads',()=>{
  for(const path of ['/token/example','/wallet/example']) assert.equal(automaticRewardsRouteVisible({pathname:path,hash:''}),false);
  for(const hash of ['#launch','#explore','#list','#profile','#buybacks']) assert.equal(automaticRewardsRouteVisible({pathname:'/',hash}),false);
  for(const hash of ['#overview','#airdrops','#payments/holders']) assert.equal(automaticRewardsRouteVisible({pathname:'/',hash}),true);
  assert.equal(automaticRewardsRouteVisible({pathname:'/funded',hash:''}),true);
});
