import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import pg from 'pg';
import {Connection} from '@solana/web3.js';
import {persistTradePage,productTradeReport,indexProductTrades} from '../server/product-trade-index.mjs';
import {GENESIS_HASHES} from '../server/service-status.mjs';

test('trade checkpoint and exact events are atomic, replay-safe, and survive a database reconnect',{skip:!process.env.TEST_PRODUCT_DATABASE_URL},async()=>{
  const pool=new pg.Pool({connectionString:process.env.TEST_PRODUCT_DATABASE_URL});
  const client=await pool.connect();
  try{
    const schema=await readFile(new URL('../db/schema.sql',import.meta.url),'utf8');
    await client.query(schema);
    await client.query('TRUNCATE product_trade_events,product_trade_cursors,product_trade_gaps');
    const row={signature:'2'.repeat(88),logIndex:3,mint:'mint',route:'curve',slot:10,blockTime:100,side:'buy',solLamports:'9007199254740993',tokenAmountRaw:'1'};
    const page={records:[row],cursor:{before:'cursor'},status:'backfilling'};
    await persistTradePage(client,'devnet','mint','curve',page);
    await persistTradePage(client,'devnet','mint','curve',page);
    let report=await productTradeReport(client,'devnet');assert.equal(report.trades,1);assert.equal(report.observedVolumeLamports,'9007199254740993');
    const conflict={records:[{...row,logIndex:4},{...row,solLamports:'1'}],cursor:{before:'must-not-advance'},status:'backfilling'};
    await assert.rejects(()=>persistTradePage(client,'devnet','mint','curve',conflict),/conflict/);
    report=await productTradeReport(client,'devnet');assert.equal(report.trades,1);
    assert.equal((await client.query('SELECT cursor FROM product_trade_cursors')).rows[0].cursor.before,'cursor');
    const reader=new pg.Pool({connectionString:process.env.TEST_PRODUCT_DATABASE_URL});
    try{const persisted=await productTradeReport(reader,'devnet');assert.equal(persisted.observedVolumeLamports,'9007199254740993');assert.equal(persisted.historicalCompletenessVerified,false);}finally{await reader.end();}
    const gap={signature:'3'.repeat(88),slot:11,reason:'logs-incomplete'};
    await persistTradePage(client,'devnet','mint','curve',{records:[],gaps:[gap],cursor:{head:'head'},status:'provider-history-scanned'});
    report=await productTradeReport(client,'devnet');assert.equal(report.status,'partial-with-gaps');assert.equal(report.unresolvedProofs,1);assert.equal(report.trades,1);
    await persistTradePage(client,'devnet','mint','curve',{records:[],gaps:[gap]});
    assert.equal((await client.query('SELECT attempts FROM product_trade_gaps')).rows[0].attempts,2);
    await assert.rejects(()=>persistTradePage(client,'devnet','mint','curve',{records:[{...row,logIndex:4}],gaps:[{...gap,slot:12}],cursor:{head:'bad'},status:'provider-history-scanned'}),/gap slot conflicts/);
    assert.equal((await productTradeReport(client,'devnet')).trades,1);
    assert.equal((await client.query('SELECT cursor FROM product_trade_cursors')).rows[0].cursor.head,'head');
    await assert.rejects(()=>persistTradePage(client,'devnet','mint','curve',{records:[{...row,solLamports:'1'}],resolved:[gap.signature]}),/conflict/);
    assert.equal((await productTradeReport(client,'devnet')).unresolvedProofs,1);
    await persistTradePage(client,'devnet','mint','curve',{records:[{...row,signature:gap.signature,slot:gap.slot}],resolved:[gap.signature]});
    report=await productTradeReport(client,'devnet');assert.equal(report.unresolvedProofs,0);assert.equal(report.trades,2);
    assert.equal(report.observedVolumeLamports,'18014398509481986');assert.equal(report.historicalCompletenessVerified,false);
    assert.equal((await client.query('SELECT cursor FROM product_trade_cursors')).rows[0].cursor.head,'head');
    const fixture=JSON.parse(await readFile(new URL('./fixtures/postmigration-pumpswap-events.json',import.meta.url),'utf8'));
    const item=fixture.cases[0];
    await persistTradePage(client,'devnet',fixture.mint,'pool',{records:[],gaps:[{signature:item.signature,slot:item.slot,reason:'transaction-unavailable'}],cursor:{head:item.signature},status:'provider-history-scanned'});
    const connection=new Connection('http://localhost:8899');
    connection.getGenesisHash=async()=>GENESIS_HASHES.devnet;
    connection.getTransaction=async signature=>{assert.equal(signature,item.signature);return {slot:item.slot,blockTime:item.blockTime,meta:{err:null,logMessages:item.logs},transaction:{signatures:[signature]}};};
    connection.getSignaturesForAddress=async()=>[];
    connection.getAccountInfo=async()=>null;
    const retry=await indexProductTrades({connection,pool,launches:[{mint:fixture.mint,cluster:'devnet',onchainVerified:true}],maxPages:1,maxGapRetries:1});
    assert.equal(retry.gapsRetried,1);assert.equal(retry.gapsResolved,1);assert.equal(retry.blocked,0);
    assert.equal((await productTradeReport(client,'devnet')).unresolvedProofs,0);
    assert.equal((await client.query('SELECT cursor FROM product_trade_cursors WHERE mint=$1 AND route=$2',[fixture.mint,'pool'])).rows[0].cursor.head,item.signature);
  }finally{client.release();await pool.end();}
});
