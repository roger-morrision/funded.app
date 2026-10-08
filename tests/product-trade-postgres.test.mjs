import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import pg from 'pg';
import {persistTradePage,productTradeReport} from '../server/product-trade-index.mjs';

test('trade checkpoint and exact events are atomic, replay-safe, and survive a database reconnect',{skip:!process.env.TEST_PRODUCT_DATABASE_URL},async()=>{
  const pool=new pg.Pool({connectionString:process.env.TEST_PRODUCT_DATABASE_URL});
  const client=await pool.connect();
  try{
    const schema=await readFile(new URL('../db/schema.sql',import.meta.url),'utf8');
    await client.query(schema);
    await client.query('TRUNCATE product_trade_events,product_trade_cursors');
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
  }finally{client.release();await pool.end();}
});
