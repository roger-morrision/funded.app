import assert from 'node:assert/strict';
import pg from 'pg';
import bs58 from 'bs58';
import {createXPostStore} from '../server/x-post-store.mjs';
import {xEventHash} from '../server/x-post-editorial.mjs';
import {runXPostWorker} from '../server/x-post-worker.mjs';
import {createXPublisher} from '../server/x-post-client.mjs';
assert.equal(process.env.X_POST_DB_TEST,'1');
const databaseUrl=process.env.X_POST_TEST_DATABASE_URL,target=new URL(databaseUrl);
assert.equal(target.hostname,'127.0.0.1');assert.equal(target.port,'15433');assert.equal(target.pathname,'/funded_x_test');
const pool=new pg.Pool({connectionString:databaseUrl}),stores=[],checks=[];
const actor='11111111111111111111111111111111',accountId=`editorial-${Date.now()}`;
const make=async account=>{const store=createXPostStore({databaseUrl,accountId:account,minIntervalMs:1,maxHourlyPosts:60,maxDailyPosts:100});stores.push(store);await store.init();return store;};
const event=(id,text='Reviewed maintenance update: historical receipt search is now available.')=>({id,kind:'agency_promotion',cluster:'devnet',occurredAt:new Date().toISOString(),text});
const published={id:'123',url:'https://x.com/i/web/status/123'};
try{
  const a=await make(accountId),b=await make(accountId);
  assert.equal((await a.safetyStatus()).paused,true);
  const pending=await a.enqueue(event('promotion:first'));
  assert.equal(await a.claim(),null);
  const review={id:pending.event.id,expectedHash:xEventHash(pending.event),decision:'approved',actor,reason:'Reviewed factual source and distinct content.'};
  await assert.rejects(a.review({...review,expectedHash:'a'.repeat(64)}),/changed/);
  await a.review(review);assert.equal(await b.claim(),null,'Approval must not bypass suspension');
  await pool.query('UPDATE x_post_accounts SET publishing_paused=false WHERE account_id=$1',[accountId]);
  await pool.query("UPDATE x_post_outbox SET review_expires_at=clock_timestamp()-interval '1 second' WHERE account_id=$1",[accountId]);
  assert.equal(await b.claim(),null,'Expired reviews must not dispatch');
  await a.review(review);
  const claims=await Promise.all([a.claim(),b.claim()]);assert.equal(claims.filter(Boolean).length,1);
  await a.markPosted(pending.event.id,claims.find(Boolean).token,published);
  checks.push('Durable suspension, exact-hash reviews, expiry and concurrent claim fencing');

  const allow=()=>pool.query('UPDATE x_post_accounts SET next_allowed_at=clock_timestamp() WHERE account_id=$1',[accountId]);
  const changed=await a.enqueue(event('changed','Trading activity lookup is complete; export receipts from the profile history.'));
  await a.review({...review,id:changed.event.id,expectedHash:changed.hash});
  // Simulate a faulty older writer changing an approved payload.
  await pool.query("UPDATE x_post_outbox SET payload=jsonb_set(payload,'{text}',to_jsonb('Unexpected replacement'::text)) WHERE account_id=$1 AND event_id='changed'",[accountId]);
  await allow();assert.equal(await a.claim(),null);assert.equal((await a.get('changed')).reason,'review-content-changed');
  const similar=await a.enqueue(event('promotion:similar',pending.event.text.replace('available.','available! https://funded.vip/token/changed')));
  await a.review({...review,id:similar.event.id,expectedHash:similar.hash});await allow();assert.equal(await a.claim(),null);
  assert.equal((await a.get(similar.event.id)).reason,'similar-content-held');
  assert.equal((await a.get(similar.event.id)).review,null);
  const tagged=await a.enqueue(event('tagged','Congratulations @someone on your reward'));
  await assert.rejects(a.review({...review,id:tagged.event.id,expectedHash:tagged.hash}),/cannot be approved/);
  const rejected=await a.enqueue(event('reject','Service interruption: token search maintenance is scheduled for tomorrow.'));
  await a.review({...review,id:rejected.event.id,expectedHash:rejected.hash,decision:'rejected'});assert.equal(await a.claim(),null);
  await a.pause();await a.review({...review,id:rejected.event.id,expectedHash:rejected.hash});assert.equal(await b.claim(),null);
  const audit=(await pool.query('SELECT * FROM x_post_review_audit WHERE account_id=$1',[accountId])).rows;
  assert.equal(audit.length,6);assert(audit.every(row=>row.actor===actor));
  checks.push('Similarity and unsolicited mention holds, rejection, revocation and append-only review audit');

  const digestAccount=`${accountId}-digest`,d=await make(digestAccount),e=await make(digestAccount);
  const day=(await pool.query("SELECT to_char(date_trunc('day',clock_timestamp(),'UTC')-interval '1 day','YYYY-MM-DD') AS day")).rows[0].day;
  const payout=(id,amount)=>({...event(id,'Internal verified payout receipt'),kind:'auto_payout',payout:{kind:'holder',recipient:actor,amountLamports:amount},
    proofs:[{signature:bs58.encode(Buffer.alloc(64,1)),slot:123,cluster:'devnet',commitment:'finalized',verified:true}]});
  const receipt=await d.enqueue(payout('payout:a','1'));await d.enqueue(payout('payout:b','1000000000'));
  await d.enqueue({...event('legacy'),kind:'auto_payout'});
  await pool.query("UPDATE x_post_outbox SET created_at=$2::date AT TIME ZONE 'UTC' WHERE account_id=$1",[digestAccount,day]);
  await d.enqueue(payout('payout:today','9'));
  await assert.rejects(d.review({...review,id:receipt.event.id,expectedHash:receipt.hash}),/cannot be approved/);
  const digests=await Promise.all([d.prepareDailyDigest(),e.prepareDailyDigest()]);assert.equal(digests.filter(Boolean).length,1);
  const digest=digests.find(Boolean);assert.equal(digest.event.proofs.count,2);assert.equal(digest.event.proofs.grossLamports,'1000000001');
  assert.equal((await pool.query('SELECT * FROM x_post_digest_sources WHERE account_id=$1',[digestAccount])).rows.length,2);
  assert.equal((await d.list({reviewable:true})).length,1);
  await d.review({...review,id:digest.event.id,expectedHash:digest.hash});assert.equal(await d.claim(),null);
  await pool.query('UPDATE x_post_accounts SET publishing_paused=false WHERE account_id=$1',[digestAccount]);
  const claimed=await d.claim({kinds:['payout_digest']});assert.equal(claimed.event.id,digest.event.id);
  await d.markPosted(claimed.event.id,claimed.token,published);
  assert.equal(await e.prepareDailyDigest(),null);assert.equal((await d.get('payout:a')).status,'pending');
  assert.equal(await d.claim({kinds:['auto_payout']}),null);
  checks.push('One summary per closed recording day across replicas, exact totals, source audit and no individual dispatch');
  const lateAccount=`${accountId}-late`,late=await make(lateAccount);let postRequests=0;
  const publisher=createXPublisher({accessToken:'synthetic-fixture',expectedHandle:'fundedfixture',fetchImpl:async url=>{
    if(url.endsWith('/users/me'))return Response.json({data:{id:'123',username:'fundedfixture'}});
    postRequests++;return Response.json({data:{id:'123'}});
  }});await publisher.verifyAccount();
  const lateEvent=await late.enqueue(event('late-check','The wallet history export now includes finalized receipt links and recording times.'));
  for(const [change,reason]of [
    [()=>late.pause(),'account-paused'],
    [()=>pool.query("UPDATE x_post_outbox SET review_expires_at=clock_timestamp()-interval '1 second' WHERE account_id=$1",[lateAccount]),'approval-expired'],
    [()=>pool.query("UPDATE x_post_outbox SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE account_id=$1",[lateAccount]),'dispatch-claim-expired'],
  ]){
    await late.review({...review,id:lateEvent.event.id,expectedHash:lateEvent.hash});
    await pool.query('UPDATE x_post_accounts SET publishing_paused=false,next_allowed_at=clock_timestamp() WHERE account_id=$1',[lateAccount]);
    const result=await runXPostWorker({store:late,enabled:true,dryRun:false,publish:async(event,options)=>{await change();return publisher.publish(event,options);}});
    assert.equal(result.retried,1);assert.equal((await late.get(lateEvent.event.id)).reason,reason);assert.equal((await late.get(lateEvent.event.id)).status,'pending');
  }
  assert.equal(postRequests,0);checks.push('Pause, approval expiry and expired claim after async preflight prevent the provider POST and preserve pending work');
  const pageAccount=`${accountId}-pages`,pages=await make(pageAccount);
  // Shared microseconds reproduce a cursor boundary that JS millisecond Dates
  // cannot represent. IDs break ties without losing or repeating rows.
  const values=Array.from({length:205},(_,i)=>event('page:'+String(i).padStart(3,'0')));
  await pages.enqueueBatch(values.slice(0,200),{cursor:{page:1},version:0});
  await pages.enqueueBatch(values.slice(200),{cursor:{page:2},version:1});
  await pool.query("UPDATE x_post_outbox SET created_at='2026-10-19T12:00:00.123456Z' WHERE account_id=$1",[pageAccount]);
  const seen=[];let after=null;
  do{const page=await pages.reviewPage({after,limit:50});seen.push(...page.events.map(row=>row.event.id));after=page.nextCursor;}while(after);
  assert.deepEqual(seen,values.map(event=>event.id));assert.equal(new Set(seen).size,205);
  await pages.enqueue({...event('legacy-hidden'),kind:'daily_rewards'});
  const preview=await pages.list({status:'pending',kinds:['daily_rewards'],limit:1});assert.equal(preview[0].event.id,'legacy-hidden');
  assert(!(await pages.reviewPage({limit:200})).events.some(row=>row.event.kind==='daily_rewards'));
  checks.push('Review pagination preserves every microsecond boundary across more than 200 rows; previews filter kinds before limiting');
  console.log(JSON.stringify({passed:checks.length,checks,mode:'isolated PostgreSQL, synthetic receipts, no live X or Solana requests'},null,2));
}finally{await Promise.allSettled(stores.map(store=>store.close()));await pool.end();}
