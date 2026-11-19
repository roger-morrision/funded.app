// Explicitly opt into the disposable audit DB; never use DATABASE_URL or .env.
import pg from 'pg';
import { writeFile } from 'node:fs/promises';
import { migrate } from '../server/postgres/ledger.mjs';
import { createBoostRepository } from '../server/postgres/boosts.mjs';
import { createDiscoveryRepository } from '../server/postgres/discovery.mjs';
const url=new URL(process.env.AUDIT_TEST_DATABASE_URL || 'http://invalid');
if(url.hostname!=='127.0.0.1'||url.pathname!=='/funded_audit') throw Error('Use the explicitly named local disposable audit database.');
const pool=new pg.Pool({connectionString:url.href,max:6});
const reports=[];
try {
  await migrate(pool);
  const boosts=createBoostRepository({pool,ensureReady:async()=>{}}),discovery=createDiscoveryRepository({pool,ensureReady:async()=>{}});
  const percentile=(samples,p)=>samples.toSorted((a,b)=>a-b)[Math.ceil(samples.length*p)-1];
  for(const size of [10_000,100_000,1_000_000]) {
    await pool.query("INSERT INTO state_entities(bucket,entity_key,payload) SELECT 'audit-scale-fixture',i::text,jsonb_build_object('value',i) FROM generate_series(1,$1::integer) i ON CONFLICT DO NOTHING",[size]);
    await pool.query('ANALYZE state_entities');
    const write=[],read=[];
    for(let i=0;i<100;i++) {
      let at=performance.now();
      await boosts.updateBoostState({mint:'ScaleMint',quoteId:'ScaleQuote'},state=>{state.boostQuotes.ScaleQuote={id:'ScaleQuote',mint:'ScaleMint',revision:i};});
      write.push(performance.now()-at); at=performance.now();
      await discovery.readDiscoveryRegistry('mainnet-beta',{limit:40});read.push(performance.now()-at);
    }
    const result={unrelatedEntities:size,samples:100,writeP95Ms:percentile(write,.95),writeP99Ms:percentile(write,.99),discoveryP95Ms:percentile(read,.95),discoveryP99Ms:percentile(read,.99)};
    reports.push(result);console.log(JSON.stringify(result));
  }
  await writeFile('tmp/audit-db-scale.json',JSON.stringify({scope:'local-only disposable PostgreSQL, unrelated ledger growth; not production throughput',reports},null,2));
} finally {await pool.end();}
