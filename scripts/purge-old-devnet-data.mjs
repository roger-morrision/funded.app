import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import pg from 'pg';
import {loadServerEnvironment} from '../server/environment.mjs';
import {pgPoolConfig} from '../server/db-config.mjs';
import {createAutomaticRewardStore} from '../server/automatic-reward-store.mjs';
import {containsReference,linkedReferences,scrubShared,purgeRewardState} from './devnet-record-purge.mjs';
loadServerEnvironment();
if(process.env.SOLANA_CLUSTER!=='devnet')throw Error('Permanent cleanup is restricted to Devnet.');
const mints=JSON.parse(process.env.FUNDED_DELETE_MINTS||'[]');
if(mints.length!==20||new Set(mints).size!==20||mints.some(value=>!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value)))throw Error('The exact 20-mint archive inventory is required.');
const apply=process.argv.includes('--apply'),expected=process.argv.find(arg=>arg.startsWith('--expect='))?.slice(9);
const hash=value=>createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');
const pool=new pg.Pool(pgPoolConfig(process.env.DATABASE_URL)),client=await pool.connect();
const ledgerPath=process.env.AUTOMATIC_REWARD_STORE_PATH;
if(!ledgerPath||!resolve(ledgerPath).startsWith('/app/data/automatic-rewards/'))throw Error('Unexpected reward ledger path.');
const tables=['state_entities','launches','collections','settlements','referral_claims','devnet_metadata','market_activity',
  'receipt_proofs','receipt_backfill','creator_directory','account_watchlists','app_state','auth_records',
  'product_trade_events','product_trade_cursors','product_trade_gaps','product_trade_nontrades',
  'x_post_digest_sources','x_post_review_audit','x_post_outbox','x_post_accounts'];
const sharedTables=new Set(['account_watchlists','app_state','receipt_backfill','x_post_accounts']);
const sharedBuckets=new Set(['adminSettings','creatorProfiles','referralCodes','referralWallets','referralAttributions','referralChallenges']);
let ledgerBefore,ledgerWritten=false,dbCommitted=false;
try{
  await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock(81730421)');
  if((await client.query('SELECT current_database() AS name')).rows[0].name!=='funded_app_retest_20260929')throw Error('Unexpected database target.');
  const columns=(await client.query("SELECT table_name,column_name,data_type FROM information_schema.columns WHERE table_schema='public' ORDER BY table_name,ordinal_position")).rows;
  const inventory={};
  for(const table of tables){const names=columns.filter(row=>row.table_name===table&&row.data_type!=='bytea').map(row=>row.column_name);
    if(!names.length)continue;
    if(apply)await client.query(`LOCK TABLE "${table}" IN SHARE ROW EXCLUSIVE MODE`);
    inventory[table]=(await client.query(`SELECT ctid::text AS row_id,${names.map(name=>'"'+name+'"').join(',')} FROM "${table}"`)).rows;
  }
  const launches=inventory.launches.filter(row=>mints.includes(row.mint));
  if(launches.some(row=>row.payload?.cluster!=='devnet'||!row.payload?.archivedAt))throw Error('A selected launch is not the archived Devnet record.');
  ledgerBefore=await readFile(ledgerPath,'utf8');const cleaned=JSON.parse(ledgerBefore);
  const referenceRows=Object.entries(inventory).filter(([table])=>!sharedTables.has(table))
    .flatMap(([table,rows])=>rows.filter(row=>table!=='state_entities'||!sharedBuckets.has(row.bucket)));
  for(const bucket of ['schedules','rewardPools','communityDrops','dailyBonusSnapshots'])
    for(const row of Object.values(cleaned[bucket]||{}))referenceRows.push({payload:row});
  const refs=linkedReferences(referenceRows,mints);
  const plan=[];const counts={};
  for(const [table,rows]of Object.entries(inventory))for(const row of rows){
    const cluster=row.cluster||row.payload?.cluster;
    if(cluster&&cluster!=='devnet')continue;
    if(!containsReference(row,refs))continue;
    const shared=sharedTables.has(table)||table==='state_entities'&&sharedBuckets.has(row.bucket);
    if(shared){
      const changes={};for(const col of columns.filter(col=>col.table_name===table&&col.data_type==='jsonb')){
        const before=row[col.column_name];if(!containsReference(before,refs))continue;
        changes[col.column_name]=scrubShared(before,refs)??{};
      }
      if(Object.keys(changes).length)plan.push({table,rowId:row.row_id,operation:'update',changes});
    }else plan.push({table,rowId:row.row_id,operation:'delete'});
  }
  for(const row of plan){const key=row.table+':'+row.operation;counts[key]=(counts[key]||0)+1;}
  const rewardCounts=purgeRewardState(cleaned,refs);
  const planHash=hash({mints,plan,ledgerBefore:hash(ledgerBefore),ledgerAfter:hash(cleaned)});
  const result={mode:apply?'apply':'dry-run',launches:launches.length,referenceCount:refs.size,database:counts,rewards:rewardCounts,planHash};
  if(!apply){await client.query('ROLLBACK');console.log(JSON.stringify(result));}
  else{
    if(!expected||expected!==planHash)throw Error('Deletion plan changed; rerun the dry-run with writers stopped.');
    for(const table of ['x_post_digest_sources','x_post_review_audit','x_post_outbox',...tables.filter(t=>!t.startsWith('x_post_')),'x_post_accounts'])
      for(const item of plan.filter(row=>row.table===table)){
        if(item.operation==='delete')await client.query(`DELETE FROM "${table}" WHERE ctid=$1::tid`,[item.rowId]);
        else{const names=Object.keys(item.changes);await client.query(`UPDATE "${table}" SET ${names.map((name,index)=>'"'+name+'"=$'+(index+2)+'::jsonb').join(',')} WHERE ctid=$1::tid`,
          [item.rowId,...names.map(name=>JSON.stringify(item.changes[name]))]);}
      }
    const remaining=(await client.query('SELECT count(*)::int AS count FROM launches WHERE mint=ANY($1::text[])',[mints])).rows[0].count;
    if(remaining!==0)throw Error('Selected launch records remain.');
    await createAutomaticRewardStore(ledgerPath).transaction(state=>{
      if(hash(state)!==hash(JSON.parse(ledgerBefore)))throw Error('Reward ledger changed during deletion.');
      for(const key of Object.keys(state))delete state[key];Object.assign(state,cleaned);
    });ledgerWritten=true;
    await client.query('COMMIT');dbCommitted=true;
    // Verify every inspected table for old mint or receipt references.
    const residual={};for(const table of Object.keys(inventory)){
      const names=columns.filter(row=>row.table_name===table&&row.data_type!=='bytea').map(row=>row.column_name);
      const rows=(await client.query(`SELECT ${names.map(name=>'"'+name+'"').join(',')} FROM "${table}"`)).rows;
      const count=rows.filter(row=>(!row.cluster||row.cluster==='devnet')&&(!row.payload?.cluster||row.payload.cluster==='devnet')&&containsReference(row,refs)).length;
      if(count)residual[table]=count;
    }
    if(Object.keys(residual).length)throw Error('Linked database records remain: '+JSON.stringify(residual));
    if(containsReference(JSON.parse(await readFile(ledgerPath,'utf8')),refs))throw Error('Linked reward records remain.');
    console.log(JSON.stringify({...result,verified:{remainingLaunches:0,remainingLinkedDatabaseRows:0,remainingLinkedRewardRecords:0},archivePreserved:true,at:new Date().toISOString()}));
  }
}catch(error){
  if(!dbCommitted){await client.query('ROLLBACK');if(ledgerWritten){
    const count=(await client.query('SELECT count(*)::int AS count FROM launches WHERE mint=ANY($1::text[])',[mints])).rows[0].count;
    if(count===20)await createAutomaticRewardStore(ledgerPath).transaction(state=>{for(const key of Object.keys(state))delete state[key];Object.assign(state,JSON.parse(ledgerBefore));});
  }}throw error;
}finally{client.release();await pool.end();}
