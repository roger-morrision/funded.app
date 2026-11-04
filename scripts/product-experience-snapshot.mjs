import { spawnSync } from 'node:child_process';

export const experienceBuckets=['launches','collections','v3Settlements','v3CommunityFunding','v3CreatorRewardFunding',
  'v3CreatorWalletPayout','v3XClaims','v3BuybackOrders','v3AllocationResidualPlans'];

// This function is also sent over stdin to Docker. Keep it self-contained.
export function publicExperienceSnapshot(state,rewards,source){
  const pick=(row,keys)=>Object.fromEntries(keys.filter(key=>Object.hasOwn(row,key)).map(key=>[key,row[key]]));
  const clean=value=>Array.isArray(value)?value.map(clean):value&&typeof value==='object'
    ?Object.fromEntries(Object.entries(value).filter(([key])=>!/secret|private.?key|keypair|seed.?phrase|password|credential|access.?token|refresh.?token|csrf|cookie|tokenHash/i.test(key)).map(([key,item])=>[key,clean(item)])):value;
  const launches=Object.fromEntries(Object.entries(state.launches||{}).filter(([,row])=>row.cluster==='devnet'&&row.onchainVerified===true)
    .map(([key,row])=>[key,pick(row,['mint','name','symbol','imageUri','creator','creatorWallet','cluster','onchainVerified','createdAt','createdTimestamp','blockTime','pumpFeeRoute','feeDistribution','communityAirdrop','xUserId'])]));
  const app={version:4,launches,creatorProfiles:{},shareVisits:{}};
  for(const bucket of ['collections','v3Settlements','v3CommunityFunding','v3CreatorRewardFunding','v3CreatorWalletPayout','v3XClaims','v3BuybackOrders','v3AllocationResidualPlans'])
    app[bucket]=Object.fromEntries(Object.entries(state[bucket]||{}).filter(([,row])=>launches[row.mint||row.plan?.mint]&&(!row.cluster||row.cluster==='devnet')));
  const ledger={version:2,programs:{},schedules:{},dailyBonusSnapshots:{}};
  for(const [key,row] of Object.entries(rewards.programs||{}))if(launches[row.mint||key])ledger.programs[key]=row;
  for(const [key,row] of Object.entries(rewards.schedules||{}))if(launches[row.mint])ledger.schedules[key]=row;
  for(const [key,row] of Object.entries(rewards.dailyBonusSnapshots||{}))
    if(row.snapshot?.sources?.length&&row.snapshot.sources.every(source=>launches[source.mint]))ledger.dailyBonusSnapshots[key]=row;
  return clean({version:1,cluster:'devnet',capturedAt:new Date().toISOString(),source,
    coverage:'Recorded financial data only. Read-only PostgreSQL transaction and independently read reward ledger; not an atomic multi-ledger snapshot. No auth sessions, private creator preferences or worker heartbeat copied.',
    state:app,rewards:ledger});
}

export function readExperienceSnapshot(container){
  if(!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,100}$/.test(container||''))throw new Error('Choose an explicit local Docker container name.');
  const input=`import pg from 'pg';
import {readFile} from 'node:fs/promises';
import {pgPoolConfig} from '/app/server/db-config.mjs';
const env=process.env;
const clusters=[env.SOLANA_CLUSTER,env.VITE_SOLANA_CLUSTER].filter(Boolean);
if(!clusters.length||clusters.some(value=>value!=='devnet'))throw new Error('Source must be explicitly Devnet.');
const url=env.DATABASE_URL||(env.DATABASE_URL_FILE?String(await readFile(env.DATABASE_URL_FILE,'utf8')).trim():null);
if(!url)throw new Error('Source PostgreSQL configuration is unavailable.');
const pool=new pg.Pool({...pgPoolConfig(url),max:1}),client=await pool.connect();
let state={};
try{
await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
const rows=await client.query('SELECT bucket, entity_key, payload FROM state_entities WHERE bucket = ANY($1::text[])',[${JSON.stringify(experienceBuckets)}]);
for(const row of rows.rows)(state[row.bucket]||={})[row.entity_key]=row.payload;
await client.query('COMMIT');
}finally{client.release();await pool.end();}
const path=env.AUTOMATIC_REWARD_STORE_PATH||'/app/data/automatic-rewards.json';
const rewards=JSON.parse(await readFile(path,'utf8'));
const snapshot=(${publicExperienceSnapshot.toString()})(state,rewards,{container:${JSON.stringify(container)},build:env.FUNDED_BUILD_ID||null,readOnlyTransaction:true});
await new Promise(resolve=>process.stdout.write(JSON.stringify(snapshot),resolve));`;
  const result=spawnSync('docker',['exec','-i',container,'node','--input-type=module'],{input,encoding:'utf8',timeout:45000,maxBuffer:32*1024*1024,windowsHide:true});
  // Docker stderr and dependency errors can include connection details.
  if(result.error||result.status!==0)throw new Error('Read-only snapshot export failed. No source write or service restart was requested.');
  const snapshot=JSON.parse(result.stdout);
  if(snapshot.version!==1||snapshot.cluster!=='devnet'||!snapshot.source?.readOnlyTransaction)throw new Error('Invalid source snapshot provenance.');
  return snapshot;
}
