import test from 'node:test';
import assert from 'node:assert/strict';
import { Keypair } from '@solana/web3.js';
import { NATIVE_MINT, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from '@solana/spl-token';
import { PUMP_AMM_PROGRAM_ID, poolPda } from '@pump-fun/pump-swap-sdk';
import { readPoolDisplayState } from '../pool-display-state.js';
import { automaticRewardsRouteVisible } from '../src/features/rewards/route-visibility.js';

function fixture() {
  const mintKey=Keypair.generate().publicKey,creator=Keypair.generate().publicKey;
  const poolKey=poolPda(0,creator,mintKey,NATIVE_MINT);
  const base=getAssociatedTokenAddressSync(mintKey,poolKey,true,TOKEN_2022_PROGRAM_ID);
  const quote=getAssociatedTokenAddressSync(NATIVE_MINT,poolKey,true,TOKEN_PROGRAM_ID);
  const mintData=Buffer.alloc(82);mintData.writeBigUInt64LE(1000000000n,36);mintData[44]=6;mintData[45]=1;
  const account=(mint,amount,program)=>{const data=Buffer.alloc(165);mint.toBuffer().copy(data);poolKey.toBuffer().copy(data,32);data.writeBigUInt64LE(amount,64);data[108]=1;return {owner:program,data};};
  const poolInfo={owner:PUMP_AMM_PROGRAM_ID,data:Buffer.alloc(1)};
  const mintInfo={owner:TOKEN_2022_PROGRAM_ID,data:mintData};
  const baseInfo=account(mintKey,1000000000n,TOKEN_2022_PROGRAM_ID),quoteInfo=account(NATIVE_MINT,2000000000n,TOKEN_PROGRAM_ID);
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
