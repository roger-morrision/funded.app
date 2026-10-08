import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { createProductMetricsStore, journeyEvent } from '../server/product-metrics.mjs';

test('PostgreSQL persists concurrent deduplicated journey counts, separates clusters, and prunes expired rows', {skip:!process.env.TEST_PRODUCT_DATABASE_URL},async()=>{
  const pool=new pg.Pool({connectionString:process.env.TEST_PRODUCT_DATABASE_URL});
  const metrics=createProductMetricsStore('',pool);
  try{
    // Use only the new table DDL against a disposable QA database.
    const schema=await readFile(new URL('../db/schema.sql',import.meta.url),'utf8');
    const ddl=schema.match(/CREATE TABLE IF NOT EXISTS product_journey_events[\s\S]*?CREATE INDEX IF NOT EXISTS product_journey_retention_idx[^;]+;/)?.[0];
    assert(ddl);await pool.query(ddl);
    await pool.query('TRUNCATE product_journey_events');
    await pool.query("INSERT INTO product_journey_events VALUES ('devnet','2020-01-01',$1,'navigation')",['a'.repeat(64)]);
    const input={consent:true,event:'launch_review',session:randomUUID()};
    const row=journeyEvent(input,'devnet');
    const outcomes=await Promise.all(Array.from({length:12},()=>metrics.record(row)));
    assert.equal(outcomes.filter(Boolean).length,1);
    await metrics.record(journeyEvent({...input,event:'launch_completed'},'devnet'));
    await metrics.record(journeyEvent(input,'mainnet-beta'));
    const report=await metrics.report('devnet');
    assert.equal(report.dailySessions.length,1);assert.equal(report.dailySessions[0].sessions,1);
    assert.deepEqual(report.dailyEvents.map(item=>[item.event,item.sessions]),[['launch_completed',1],['launch_review',1]]);
    const stored=await pool.query('SELECT * FROM product_journey_events');
    assert.equal(stored.rowCount,3);assert.equal(JSON.stringify(stored.rows).includes(input.session),false);
    assert.equal(report.uniquePeople,null);
  }finally{await metrics.close();}
});
