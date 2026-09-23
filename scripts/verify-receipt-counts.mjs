import assert from 'node:assert/strict';
import {createPostgresStore} from '../server/postgres-store.mjs';
import {selectReceiptCandidates} from '../server/receipt-candidates.mjs';

// Called only after verify-postgres-store's disposable-database guard.
export async function verifyReceiptCounts(pool,store,databaseUrl) {
  const check=async()=>{
    const actual=(await pool.query('SELECT bucket,cluster,record_count::text FROM receipt_counts WHERE record_count>0 ORDER BY bucket,cluster')).rows;
    const expected=(await pool.query(`SELECT bucket,receipt_count_cluster(bucket,payload) AS cluster,count(*)::text AS record_count
      FROM state_entities WHERE receipt_count_cluster(bucket,payload) IS NOT NULL GROUP BY bucket,cluster ORDER BY bucket,cluster`)).rows;
    assert.deepEqual(actual,expected,'Transactional counts equal independently scanned eligible rows.');
    for(const cluster of ['devnet','mainnet-beta','testnet'])assert.deepEqual(await store.readReceiptCandidates(cluster),selectReceiptCandidates(await store.read(),cluster));
  };
  const put=async(key,payload)=>pool.query(`INSERT INTO state_entities(bucket,entity_key,payload) VALUES('payouts',$1,$2::jsonb)
    ON CONFLICT(bucket,entity_key) DO UPDATE SET payload=EXCLUDED.payload`,[key,JSON.stringify(payload)]);
  await check();
  for(const payload of [
    {cluster:'devnet',status:'submitted',signature:'count-fixture'},
    {cluster:'devnet',status:'paid',signature:'count-fixture'},
    {cluster:'devnet',status:'paid',signature:'count-fixture'},
    {cluster:'mainnet-beta',status:'paid',signature:'count-fixture'},
    {cluster:'mainnet-beta',status:'paid',signature:123},
    {cluster:'devnet',status:'paid',signature:''},
    {cluster:'devnet',status:'paid',signature:'count-fixture'},
  ]){await put('count-fixture',payload);await check();}
  await Promise.all(Array.from({length:16},(_,n)=>put(`count-concurrent-${n}`,{cluster:'devnet',status:'paid',signature:`count-${n}`})));
  await check();
  const client=await pool.connect();
  try{
    await client.query('BEGIN');await client.query("DELETE FROM state_entities WHERE bucket='payouts' AND entity_key='count-fixture'");
    await client.query('ROLLBACK');
  }finally{client.release();}
  await check();
  await pool.query("DELETE FROM state_entities WHERE bucket='payouts' AND (entity_key='count-fixture' OR entity_key LIKE 'count-concurrent-%')");await check();
  // Rehearse upgrading populated v8 storage, then verify restart does not rebuild counters.
  await pool.query("DELETE FROM read_model_versions WHERE name='receipt-counts'");
  await pool.query('DELETE FROM receipt_counts');
  const upgraded=createPostgresStore(databaseUrl);
  try{await upgraded.read();await check();}finally{await upgraded.close();}
  const restarted=createPostgresStore(databaseUrl);
  try{await restarted.read();await check();}finally{await restarted.close();}
  const truncate=await pool.connect();
  try{
    await truncate.query('BEGIN');await truncate.query('TRUNCATE state_entities');
    assert.equal((await truncate.query('SELECT count(*)::int AS n FROM receipt_counts')).rows[0].n,0);
    await truncate.query('ROLLBACK');
  }finally{truncate.release();}
  await check();
}
