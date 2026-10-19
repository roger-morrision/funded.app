import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Connection,PublicKey } from '@solana/web3.js';
import { getPumpAmmProgram } from '@pump-fun/pump-swap-sdk';
import { walletTradeRows,readWalletTradeHistory } from '../server/wallet-trades.mjs';
import { createTokenMarketRoutes } from '../server/routes/token-market.mjs';
import { GENESIS_HASHES } from '../server/service-status.mjs';

const fixture=JSON.parse(readFileSync(new URL('./fixtures/wallet-pump-trades.json',import.meta.url)));
const decoder=getPumpAmmProgram(new Connection('http://127.0.0.1:8899')).coder.events;
const nowSeconds=fixture.cases[0].transaction.blockTime+100;
const poolFixture=JSON.parse(readFileSync(new URL('./fixtures/postmigration-pumpswap-events.json',import.meta.url)));
const fakeConnection=()=>({getGenesisHash:async()=>GENESIS_HASHES.devnet,
  getSignaturesForAddress:async()=>fixture.cases.map(row=>row.reference),
  getTransaction:async signature=>fixture.cases.find(row=>row.reference.signature===signature)?.transaction});

test('public finalized wallet fixtures recover both buys missing from the global twenty-trade preview',async()=>{
  const data=await readWalletTradeHistory({connection:fakeConnection(),wallet:fixture.wallet,nowSeconds});
  assert.equal(data.coverage,'complete');assert.equal(data.trades.length,2);
  assert.deepEqual(data.trades.map(row=>row.signature),fixture.cases.map(row=>row.reference.signature));
  assert.deepEqual(data.trades.map(row=>row.solLamports),['247365234','247524751']);
  assert(data.trades.every(row=>row.mint===fixture.mint&&row.trader===fixture.wallet&&row.side==='buy'&&row.finalized));
});

test('wallet receipt decoder rejects wrong signatures, slots, failures and missing token identity',()=>{
  const original=fixture.cases[0];
  for (const mutate of [tx=>tx.transaction.signatures[0]='wrong',tx=>tx.slot++,
    tx=>tx.meta.err={InstructionError:[0,'failure']},tx=>{tx.meta.preTokenBalances=[];tx.meta.postTokenBalances=[];}]) {
    const transaction=structuredClone(original.transaction);mutate(transaction);
    assert.throws(()=>walletTradeRows({transaction,reference:original.reference,wallet:fixture.wallet,decodePoolEvent:decoder.decode.bind(decoder)}));
  }
});

test('wallet history decodes canonical SOL pool buys and sells, excluding failed or spoofed events',()=>{
  const wallet='Gv3uSJu2Ki7eqC6V4H1Fc31MMXLih6TJR19a5sydPfr7';
  const rows=poolFixture.cases.map(item=>{
    const reference={signature:item.signature,slot:100,confirmationStatus:'finalized'};
    const transaction={slot:100,blockTime:item.blockTime,transaction:{signatures:[item.signature],message:{accountKeys:[wallet]}},
      meta:{err:null,logMessages:item.logs,preTokenBalances:[{owner:wallet,mint:poolFixture.mint,uiTokenAmount:{decimals:6}}]}};
    const decode=()=>walletTradeRows({transaction,reference,wallet,decodePoolEvent:decoder.decode.bind(decoder)});
    const decoded=decode();
    transaction.meta.logMessages=item.logs.map(line=>line.replace(/Program .* success$/, 'Program '+poolFixture.mint+' success'));
    assert.throws(decode,/./,'Unbalanced or spoofed program frames cannot prove a trade.');
    return decoded;
  }).flat();
  assert.deepEqual(rows.map(row=>row.side),['buy','sell']);
  assert.deepEqual(rows.map(row=>row.solLamports),['9499999','9265432']);
  assert(rows.every(row=>row.route==='pool'&&row.mint===poolFixture.mint));
});

test('missing receipts and a capped recent signature page report partial coverage',async()=>{
  const connection=fakeConnection();connection.getTransaction=async()=>null;
  const missing=await readWalletTradeHistory({connection,wallet:fixture.wallet,nowSeconds});
  assert.equal(missing.coverage,'partial');assert.equal(missing.gaps.length,2);assert.equal(missing.trades.length,0);
  const capped=await readWalletTradeHistory({connection:fakeConnection(),wallet:fixture.wallet,nowSeconds,maxSignatures:2});
  assert.equal(capped.coverage,'partial');assert.equal(capped.trades.length,2);
});

test('wallet scanner refuses wrong network and unfinalized references',async()=>{
  const network=fakeConnection();network.getGenesisHash=async()=>GENESIS_HASHES['mainnet-beta'];
  await assert.rejects(readWalletTradeHistory({connection:network,wallet:fixture.wallet,nowSeconds}),/Devnet/);
  const unfinalized=fakeConnection();unfinalized.getSignaturesForAddress=async()=>[{...fixture.cases[0].reference,confirmationStatus:'confirmed'}];
  await assert.rejects(readWalletTradeHistory({connection:unfinalized,wallet:fixture.wallet,nowSeconds}),/finalized/);
});

test('wallet trade route deduplicates concurrent scans and caches public results without signing',async()=>{
  let calls=0,charges=0,finish;const out=[];
  const handle=createTokenMarketRoutes({route:()=>null,store:{chargeRpcRate:async()=>{charges++;return true;}},
    clientKey:()=> 'qa',solanaRpcUrl:'http://127.0.0.1:8899',solanaCluster:'devnet',
    respond:(res,status,data)=>out.push({res,status,data}),
    readWalletTrades:async({wallet})=>{assert.equal(wallet,fixture.wallet);calls++;return new Promise(resolve=>{finish=resolve;});}});
  const url=new URL(`http://localhost/api/wallets/${fixture.wallet}/trades`);
  const one=handle({method:'GET'},1,url),two=handle({method:'GET'},2,url);
  while(!finish) await Promise.resolve();
  finish({wallet:fixture.wallet,cluster:'devnet',trades:[]});await Promise.all([one,two]);
  await handle({method:'GET'},3,url);
  assert.equal(calls,1);assert.equal(charges,1);assert(out.every(row=>row.status===200));
  await handle({method:'GET'},4,new URL('http://localhost/api/wallets/invalid/trades'));
  assert.equal(out.at(-1).status,400);assert.equal(calls,1);
});

test('wallet trade route fails closed on provider errors and rate limits',async()=>{
  for (const allowed of [true,false]) {
    let result;
    const handle=createTokenMarketRoutes({route:()=>null,store:{chargeRpcRate:async()=>allowed},
      clientKey:()=> 'qa',solanaRpcUrl:'http://127.0.0.1:8899',solanaCluster:'devnet',
      respond:(_res,status,data)=>{result={status,data};},readWalletTrades:async()=>{throw new Error('Provider unavailable');}});
    await handle({method:'GET'},{},new URL(`http://localhost/api/wallets/${fixture.wallet}/trades`));
    assert.equal(result.status,allowed?502:429);assert.equal(result.data.trades,undefined);
  }
});
