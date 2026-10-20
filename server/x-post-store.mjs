import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { pgPoolConfig } from './db-config.mjs';
import {X_POSTING_DEFAULTS} from '../config/x-posting.js';
import {xEventHash,checkedPayout,editorialBlock,substantiallySimilar,buildPayoutDigest} from './x-post-editorial.mjs';

const statuses = ['pending', 'sending', 'posted', 'uncertain', 'failed'];
function integer(value, min, max, label) {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(`${label} is invalid.`);
  return value;
}
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
  return value;
}
function checkedKinds(kinds){
  if(kinds===undefined)return null;
  if(!Array.isArray(kinds)||!kinds.length||kinds.length>16||kinds.some(kind=>!(/^[a-z][a-z0-9_]{0,63}$/).test(kind)))throw new Error('X worker kind selection is invalid.');
  return [...new Set(kinds)];
}
export function normalizeXPostEvent(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('X event is invalid.');
  const { id, kind, cluster, occurredAt, text } = input;
  if (typeof id !== 'string' || !/^[A-Za-z0-9:_./-]{1,240}$/.test(id)) throw new Error('X event ID is invalid.');
  if (typeof kind !== 'string' || !/^[a-z][a-z0-9_]{0,63}$/.test(kind)) throw new Error('X event kind is invalid.');
  if (!['devnet', 'testnet', 'mainnet-beta'].includes(cluster)) throw new Error('X event cluster is invalid.');
  if (typeof occurredAt !== 'string' || !Number.isFinite(Date.parse(occurredAt))) throw new Error('X event timestamp is invalid.');
  if (typeof text !== 'string' || !text.trim() || Buffer.byteLength(text,'utf8') > 280 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)) throw new Error('X event text is invalid.');
  let proofs;
  if (input.proofs !== undefined) {
    let encoded;
    try { encoded = JSON.stringify(input.proofs); } catch { throw new Error('X event proofs are invalid.'); }
    if (!encoded || Buffer.byteLength(encoded) > 16384 || !input.proofs || typeof input.proofs !== 'object') throw new Error('X event proofs are invalid.');
    proofs = stable(JSON.parse(encoded));
  }
  return { id, kind, cluster, occurredAt:new Date(occurredAt).toISOString(), text, ...(proofs === undefined ? {} : {proofs}),
    ...(input.payout===undefined?{}:{payout:checkedPayout(input.payout)}) };
}
function row(record) {
  if (!record) return null;
  return { event:record.payload, status:record.status, attempts:record.attempts, createdAt:record.created_at, updatedAt:record.updated_at,
    nextAttemptAt:record.next_attempt_at, leaseExpiresAt:record.lease_expires_at, result:record.result, reason:record.reason,
    hash:xEventHash(record.payload),review:record.review_decision?{decision:record.review_decision,actor:record.reviewed_by,
      hash:record.reviewed_hash,expiresAt:record.review_expires_at,reason:record.review_reason}:null };
}

export function createXPostStore({ databaseUrl, accountId, minIntervalMs = X_POSTING_DEFAULTS.minIntervalMs, leaseMs = 60_000, maxAttempts = 3, maxHourlyPosts = X_POSTING_DEFAULTS.maxHourlyPosts, maxDailyPosts = X_POSTING_DEFAULTS.maxDailyPosts }) {
  if (typeof accountId !== 'string' || !/^[A-Za-z0-9:_-]{1,128}$/.test(accountId)) throw new Error('X posting account ID is invalid.');
  // X handles are case-insensitive; replicas must share one budget/queue.
  accountId = accountId.toLowerCase();
  integer(minIntervalMs, 1, 86_400_000, 'X posting interval');
  integer(leaseMs, 1000, 300_000, 'X posting lease');
  integer(maxAttempts, 1, 20, 'X posting attempts');
  integer(maxHourlyPosts, 1, 60, 'X hourly posting limit');
  integer(maxDailyPosts, 1, 1440, 'X daily posting limit');
  const pool = new pg.Pool(pgPoolConfig(databaseUrl));
  pool.on('error', () => {}); // A disconnected idle client must not crash an API replica.
  async function transaction(operation) {
    const client = await pool.connect();
    try { await client.query('BEGIN'); const result = await operation(client); await client.query('COMMIT'); return result; }
    catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
    finally { client.release(); }
  }
  async function accountLock(client) {
    return (await client.query('SELECT * FROM x_post_accounts WHERE account_id=$1 FOR UPDATE', [accountId])).rows[0];
  }
  async function insertEvent(client, event) {
    // Use insertion time after the account lock, not transaction-start now(): a
    // batch waiting across midnight must enter the new recording day.
    const saved = await client.query(`INSERT INTO x_post_outbox(account_id,event_id,payload,created_at) VALUES($1,$2,$3,clock_timestamp())
      ON CONFLICT(account_id,event_id) DO UPDATE SET event_id=EXCLUDED.event_id WHERE x_post_outbox.payload=EXCLUDED.payload RETURNING *`, [accountId,event.id,event]);
    if (!saved.rowCount) throw new Error('X event ID already has different immutable content.');
    return row(saved.rows[0]);
  }
  async function finish(id, token, { status, reason = null, result = null, delay = 0, bounded = true }) {
    if (!['posted','uncertain','pending','failed'].includes(status)) throw new Error('X outbox transition is invalid.');
    if (reason !== null && !/^[a-z0-9-]{1,80}$/.test(reason)) throw new Error('X outbox reason is invalid.');
    return transaction(async client => {
      await accountLock(client);
      const updated = await client.query(`UPDATE x_post_outbox SET status=CASE WHEN $4='pending' AND $9 AND attempts >= $8 THEN 'failed' ELSE $4 END,
        reason=CASE WHEN $4='pending' AND $9 AND attempts >= $8 THEN 'retry-limit' ELSE $5 END, result=$6,
        next_attempt_at=clock_timestamp()+($7::bigint * interval '1 millisecond'), lease_expires_at=NULL, claim_token=NULL, updated_at=clock_timestamp()
        WHERE account_id=$1 AND event_id=$2 AND claim_token=$3 AND status='sending' RETURNING *`, [accountId,id,token,status,reason,result,delay,maxAttempts,bounded]);
      if (!updated.rowCount) throw new Error('X dispatch claim is no longer current.');
      await client.query(`UPDATE x_post_accounts SET active_token=NULL, lease_expires_at=NULL,
        next_allowed_at=GREATEST(next_allowed_at,clock_timestamp()+($3::bigint * interval '1 millisecond')) WHERE account_id=$1 AND active_token=$2`, [accountId,token,delay]);
      return row(updated.rows[0]);
    });
  }
  return {
    leaseMs,
    async init() {
      await transaction(async client => {
        // Serialize first-run DDL across API/worker replicas.
        await client.query("SELECT pg_advisory_xact_lock(hashtext('funded-x-post-schema-v1'))");
        await client.query(`CREATE TABLE IF NOT EXISTS x_post_accounts (
          account_id text PRIMARY KEY, min_interval_ms bigint NOT NULL CHECK(min_interval_ms>0), next_allowed_at timestamptz NOT NULL DEFAULT '-infinity',
          active_token uuid, lease_expires_at timestamptz);
          CREATE TABLE IF NOT EXISTS x_post_outbox (
            account_id text NOT NULL REFERENCES x_post_accounts(account_id), event_id text NOT NULL, payload jsonb NOT NULL,
            status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sending','posted','uncertain','failed')),
            attempts integer NOT NULL DEFAULT 0, claim_token uuid, lease_expires_at timestamptz, next_attempt_at timestamptz NOT NULL DEFAULT now(),
            result jsonb, reason text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(account_id,event_id));
          CREATE INDEX IF NOT EXISTS x_post_outbox_dispatch ON x_post_outbox(account_id,status,next_attempt_at,created_at);`);
        await client.query(`ALTER TABLE x_post_accounts
          ADD COLUMN IF NOT EXISTS max_hourly_posts integer NOT NULL DEFAULT 6 CHECK(max_hourly_posts>0),
          ADD COLUMN IF NOT EXISTS max_daily_posts integer NOT NULL DEFAULT 24 CHECK(max_daily_posts>0),
          ADD COLUMN IF NOT EXISTS hour_start timestamptz NOT NULL DEFAULT date_trunc('hour',now(),'UTC'),
          ADD COLUMN IF NOT EXISTS day_start timestamptz NOT NULL DEFAULT date_trunc('day',now(),'UTC'),
          ADD COLUMN IF NOT EXISTS hour_count integer NOT NULL DEFAULT 0 CHECK(hour_count>=0),
          ADD COLUMN IF NOT EXISTS day_count integer NOT NULL DEFAULT 0 CHECK(day_count>=0),
          ADD COLUMN IF NOT EXISTS collector_cursor jsonb,
          ADD COLUMN IF NOT EXISTS cursor_version integer NOT NULL DEFAULT 0 CHECK(cursor_version>=0)`);
        await client.query(`INSERT INTO x_post_accounts(account_id,min_interval_ms,max_hourly_posts,max_daily_posts) VALUES($1,$2,$3,$4)
          ON CONFLICT(account_id) DO UPDATE SET min_interval_ms=GREATEST(x_post_accounts.min_interval_ms,EXCLUDED.min_interval_ms),
          max_hourly_posts=LEAST(x_post_accounts.max_hourly_posts,EXCLUDED.max_hourly_posts),
          max_daily_posts=LEAST(x_post_accounts.max_daily_posts,EXCLUDED.max_daily_posts)`, [accountId,minIntervalMs,maxHourlyPosts,maxDailyPosts]);
        // Every existing account migrates paused. Only a separate reinstatement
        // review may lift this durable pause; startup and admin approval cannot.
        await client.query(`ALTER TABLE x_post_accounts ADD COLUMN IF NOT EXISTS publishing_paused boolean NOT NULL DEFAULT true,
          ADD COLUMN IF NOT EXISTS pause_reason text NOT NULL DEFAULT 'account-review-required';
          ALTER TABLE x_post_outbox ADD COLUMN IF NOT EXISTS review_decision text,
          ADD COLUMN IF NOT EXISTS reviewed_hash text, ADD COLUMN IF NOT EXISTS reviewed_by text,
          ADD COLUMN IF NOT EXISTS review_expires_at timestamptz, ADD COLUMN IF NOT EXISTS review_reason text;
          CREATE TABLE IF NOT EXISTS x_post_review_audit(id bigserial PRIMARY KEY,account_id text NOT NULL,event_id text NOT NULL,
            event_hash text NOT NULL,decision text NOT NULL,actor text NOT NULL,reason text NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp());
          CREATE TABLE IF NOT EXISTS x_post_digest_sources(account_id text NOT NULL,digest_id text NOT NULL,event_id text NOT NULL,
            PRIMARY KEY(account_id,event_id),FOREIGN KEY(account_id,event_id) REFERENCES x_post_outbox(account_id,event_id),
            FOREIGN KEY(account_id,digest_id) REFERENCES x_post_outbox(account_id,event_id));`);
        // A stricter interval applies to the most recent attempted delivery,
        // including work sent by an older replica before this deployment.
        await client.query(`UPDATE x_post_accounts SET next_allowed_at=GREATEST(next_allowed_at,
          (SELECT MAX(updated_at) FROM x_post_outbox WHERE account_id=$1 AND attempts>0)
          +(min_interval_ms*interval '1 millisecond')) WHERE account_id=$1`,[accountId]);
      });
    },
    close: () => pool.end(),
    async safetyStatus(){
      const account=(await pool.query('SELECT publishing_paused,pause_reason FROM x_post_accounts WHERE account_id=$1',[accountId])).rows[0];
      if(!account)throw new Error('Initialize the X account before review.');
      return{accountId,paused:account.publishing_paused,reason:account.pause_reason,manualReview:true,individualPayouts:false};
    },
    async pause(reason='account-suspended'){
      if(!/^[a-z0-9-]{1,80}$/.test(reason))throw new Error('Invalid X account pause reason.');
      await transaction(async client=>{await accountLock(client);await client.query('UPDATE x_post_accounts SET publishing_paused=true,pause_reason=$2 WHERE account_id=$1',[accountId,reason]);});
      return this.safetyStatus();
    },
    async review({id,expectedHash,decision,actor,reason}){
      if(!['approved','rejected'].includes(decision)||!/^[a-f0-9]{64}$/.test(expectedHash||'')
        ||typeof actor!=='string'||!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(actor)
        ||typeof reason!=='string'||reason.trim().length<10||reason.length>500)throw new Error('A reviewer, exact content hash, decision and audit reason are required.');
      return transaction(async client=>{
        await accountLock(client);
        const saved=(await client.query('SELECT * FROM x_post_outbox WHERE account_id=$1 AND event_id=$2 FOR UPDATE',[accountId,id])).rows[0];
        if(!saved||saved.status!=='pending'||xEventHash(saved.payload)!==expectedHash)throw new Error('The pending post changed; refresh before reviewing.');
        if(decision==='approved'&&editorialBlock(saved.payload))throw new Error('Individual payout posts and unsolicited mentions cannot be approved.');
        const updated=await client.query(`UPDATE x_post_outbox SET review_decision=$3,reviewed_hash=$4,reviewed_by=$5,review_reason=$6,
          review_expires_at=clock_timestamp()+interval '24 hours' WHERE account_id=$1 AND event_id=$2 RETURNING *`,[accountId,id,decision,expectedHash,actor,reason.trim()]);
        await client.query('INSERT INTO x_post_review_audit(account_id,event_id,event_hash,decision,actor,reason) VALUES($1,$2,$3,$4,$5,$6)',[accountId,id,expectedHash,decision,actor,reason.trim()]);
        return row(updated.rows[0]);
      });
    },
    async prepareDailyDigest({origin}={}){
      return transaction(async client=>{
        await accountLock(client);
        const next=(await client.query(`SELECT to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD') AS day FROM x_post_outbox s
          WHERE account_id=$1 AND payload->>'kind'='auto_payout' AND payload ? 'payout'
          AND created_at<date_trunc('day',clock_timestamp(),'UTC')
          AND NOT EXISTS(SELECT 1 FROM x_post_outbox d WHERE d.account_id=s.account_id AND d.event_id='devnet:payout_digest:'||to_char(s.created_at AT TIME ZONE 'UTC','YYYY-MM-DD'))
          ORDER BY created_at LIMIT 1`,[accountId])).rows[0];
        if(!next)return null;
        const records=(await client.query(`SELECT * FROM x_post_outbox WHERE account_id=$1 AND payload->>'kind'='auto_payout' AND payload ? 'payout'
          AND created_at >= $2::date AT TIME ZONE 'UTC' AND created_at < ($2::date+1) AT TIME ZONE 'UTC' ORDER BY event_id LIMIT 10001`,[accountId,next.day])).rows;
        const event=normalizeXPostEvent(buildPayoutDigest(records.map(row),{day:next.day,origin}));
        const digest=await insertEvent(client,event);
        await client.query('INSERT INTO x_post_digest_sources(account_id,digest_id,event_id) SELECT $1,$2,unnest($3::text[])',[accountId,event.id,records.map(record=>record.event_id)]);
        return digest;
      });
    },
    async enqueue(input) {
      const event = normalizeXPostEvent(input);
      return transaction(async client => { await accountLock(client); return insertEvent(client,event); });
    },
    async has(id) {
      if (typeof id !== 'string' || !/^[A-Za-z0-9:_./-]{1,240}$/.test(id)) throw new Error('X event ID is invalid.');
      return Boolean((await pool.query('SELECT 1 FROM x_post_outbox WHERE account_id=$1 AND event_id=$2',[accountId,id])).rowCount);
    },
    async isPosted(id) {
      if (typeof id !== 'string' || !/^[A-Za-z0-9:_./-]{1,240}$/.test(id)) throw new Error('X event ID is invalid.');
      return Boolean((await pool.query("SELECT 1 FROM x_post_outbox WHERE account_id=$1 AND event_id=$2 AND status='posted'",[accountId,id])).rowCount);
    },
    async get(id){
      if(typeof id!=='string'||!/^[A-Za-z0-9:_./-]{1,240}$/.test(id))throw new Error('X event ID is invalid.');
      return row((await pool.query('SELECT * FROM x_post_outbox WHERE account_id=$1 AND event_id=$2',[accountId,id])).rows[0]);
    },
    async readCursor() {
      const account = (await pool.query('SELECT collector_cursor,cursor_version FROM x_post_accounts WHERE account_id=$1',[accountId])).rows[0];
      if (!account) throw new Error('Initialize the X account before reading its cursor.');
      return {version:account.cursor_version,cursor:account.collector_cursor};
    },
    async enqueueBatch(inputs, {cursor,version} = {}) {
      if (!Array.isArray(inputs) || inputs.length>200) throw new Error('X event batch exceeds its limit.');
      integer(version,0,2147483646,'X collector cursor version');
      const events = inputs.map(normalizeXPostEvent);
      let encoded;
      try { encoded=JSON.stringify(cursor); } catch { throw new Error('X collector cursor is invalid.'); }
      if (!cursor || typeof cursor!=='object' || Array.isArray(cursor) || !encoded || Buffer.byteLength(encoded)>262144) throw new Error('X collector cursor is invalid.');
      return transaction(async client => {
        const account = await accountLock(client);
        if (account?.cursor_version!==version) throw new Error('X collector cursor changed; collect again before enqueuing.');
        const rows=[];
        for (const event of events) rows.push(await insertEvent(client,event));
        await client.query('UPDATE x_post_accounts SET collector_cursor=$2,cursor_version=cursor_version+1 WHERE account_id=$1',[accountId,JSON.parse(encoded)]);
        return {events:rows,cursor:JSON.parse(encoded),version:version+1};
      });
    },
    async list({ status, limit = 50,reviewable=false } = {}) {
      if (status !== undefined && !statuses.includes(status)) throw new Error('X outbox status is invalid.');
      integer(limit, 1, 200, 'X outbox list limit');
      return (await pool.query("SELECT * FROM x_post_outbox WHERE account_id=$1 AND ($2::text IS NULL OR status=$2) AND (NOT $4 OR payload->>'kind'<>'auto_payout') ORDER BY created_at,event_id LIMIT $3", [accountId,status ?? null,limit,reviewable])).rows.map(row);
    },
    async claim({kinds}={}) {
      const selectedKinds=checkedKinds(kinds);
      return transaction(async client => {
        await accountLock(client);
        // Process death after sending is ambiguous, even if the lease expired.
        await client.query("UPDATE x_post_outbox SET status='uncertain',reason='sending-lease-expired',claim_token=NULL,lease_expires_at=NULL,updated_at=clock_timestamp() WHERE account_id=$1 AND status='sending' AND lease_expires_at<=clock_timestamp()", [accountId]);
        await client.query('UPDATE x_post_accounts SET active_token=NULL,lease_expires_at=NULL WHERE account_id=$1 AND lease_expires_at<=clock_timestamp()', [accountId]);
        await client.query(`UPDATE x_post_accounts SET
          hour_count=CASE WHEN hour_start<date_trunc('hour',clock_timestamp(),'UTC') THEN 0 ELSE hour_count END,
          day_count=CASE WHEN day_start<date_trunc('day',clock_timestamp(),'UTC') THEN 0 ELSE day_count END,
          hour_start=date_trunc('hour',clock_timestamp(),'UTC'),day_start=date_trunc('day',clock_timestamp(),'UTC') WHERE account_id=$1`,[accountId]);
        const allowed = await client.query(`SELECT 1 FROM x_post_accounts WHERE account_id=$1 AND NOT publishing_paused AND active_token IS NULL AND next_allowed_at<=clock_timestamp()
          AND hour_count<max_hourly_posts AND day_count<max_daily_posts`, [accountId]);
        if (!allowed.rowCount) return null;
        const candidates = (await client.query(`SELECT candidate.* FROM x_post_outbox candidate WHERE candidate.account_id=$1 AND candidate.status='pending'
          AND candidate.review_decision='approved' AND candidate.review_expires_at>clock_timestamp()
          AND candidate.payload->>'kind'<>'auto_payout'
          AND candidate.next_attempt_at<=clock_timestamp() AND ($2::text[] IS NULL OR candidate.payload->>'kind'=ANY($2))
          AND NOT EXISTS(SELECT 1 FROM x_post_outbox previous WHERE previous.account_id=candidate.account_id
            AND previous.event_id<>candidate.event_id AND previous.status IN ('posted','sending','uncertain')
            AND previous.payload->>'text'=candidate.payload->>'text')
          ORDER BY candidate.created_at,candidate.event_id FOR UPDATE OF candidate SKIP LOCKED LIMIT 200`, [accountId,selectedKinds])).rows;
        const previous=(await client.query(`SELECT payload FROM x_post_outbox WHERE account_id=$1
          AND status IN ('posted','sending','uncertain') AND updated_at>=clock_timestamp()-interval '7 days'`,[accountId])).rows;
        let candidate;
        for(const record of candidates){
          const block=editorialBlock(record.payload)||(record.reviewed_hash!==xEventHash(record.payload)?'review-content-changed':null)
            ||(previous.some(old=>substantiallySimilar(old.payload.text,record.payload.text))?'similar-content-held':null);
          if(block){await client.query(`UPDATE x_post_outbox SET reason=$3,review_decision=NULL WHERE account_id=$1 AND event_id=$2`,[accountId,record.event_id,block]);continue;}
          candidate=record;break;
        }
        if (!candidate) return null;
        const token = randomUUID();
        const claimed = (await client.query(`UPDATE x_post_outbox SET status='sending',attempts=attempts+1,claim_token=$3,
          lease_expires_at=clock_timestamp()+($4::bigint*interval '1 millisecond'),updated_at=clock_timestamp() WHERE account_id=$1 AND event_id=$2 RETURNING *`, [accountId,candidate.event_id,token,leaseMs])).rows[0];
        await client.query(`UPDATE x_post_accounts SET active_token=$2,lease_expires_at=$3,hour_count=hour_count+1,day_count=day_count+1,
          next_allowed_at=clock_timestamp()+(min_interval_ms*interval '1 millisecond') WHERE account_id=$1`, [accountId,token,claimed.lease_expires_at]);
        return { event:claimed.payload, token, leaseExpiresAt:claimed.lease_expires_at };
      });
    },
    markPosted(id, token, result) {
      if (!result || !/^\d{1,30}$/.test(result.id)) throw new Error('X publication ID is invalid.');
      const expected = `https://x.com/i/web/status/${result.id}`;
      if (result.url !== expected) throw new Error('X publication URL is invalid.');
      return finish(id, token, {status:'posted', result:{id:result.id,url:expected}});
    },
    markUncertain: (id,token,reason='delivery-unknown') => finish(id,token,{status:'uncertain',reason}),
    retryLater(id,token,retryAfterMs) { integer(retryAfterMs,1,86_400_000,'X retry delay'); return finish(id,token,{status:'pending',reason:'rate-limited',delay:retryAfterMs}); },
    deferAccount(id,token,status){
      const reason={401:'x-auth-rejected',402:'x-credits-unavailable',403:'x-permission-denied'}[status];
      if(!Number.isInteger(status)||!reason)throw new Error('X account deferral requires a known provider rejection.');
      return finish(id,token,{status:'pending',reason,delay:X_POSTING_DEFAULTS.authCooldownMs,bounded:false});
    },
    fail: (id,token,reason='delivery-rejected') => finish(id,token,{status:'failed',reason}),
  };
}
