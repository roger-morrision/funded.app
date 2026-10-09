import { RECEIPT_WINDOW } from '../receipt-candidates.mjs';
import { encodeReceiptCursor } from '../receipt-history.mjs';
import { backfillPosition } from '../receipt-backfill.mjs';
import { receiptWorkerOutcome } from '../receipt-worker-status.mjs';
import { receiptRetentionOptions, receiptRetentionResult } from '../receipt-retention.mjs';

// Each operation uses the shared pool and readiness gate; transactions stay local.
export function createReceiptsRepository({ pool, ensureReady }) {
  return {
    async readReceiptBackfillPage(cluster,position) {
      await ensureReady();
      const {bucket,after}=backfillPosition(position),status=bucket==='collections'?'collected':'paid';
      const result=await pool.query(`SELECT entity_key,payload FROM state_entities WHERE bucket=$1 AND payload->>'cluster'=$2
        AND payload->>'status'=$3 AND jsonb_typeof(payload->'signature')='string' AND payload->>'signature'<>''
        AND entity_key COLLATE "C">$4 COLLATE "C" ORDER BY entity_key COLLATE "C" LIMIT $5`,[bucket,cluster,status,after,RECEIPT_WINDOW+1]);
      const selected=result.rows.slice(0,RECEIPT_WINDOW);
      return {state:{[bucket]:Object.fromEntries(selected.map(row=>[row.entity_key,row.payload]))},after:selected.at(-1)?.entity_key||after,hasMore:result.rows.length>RECEIPT_WINDOW,count:selected.length};
    },
    async acquireReceiptBackfill(cluster,owner,leaseMs) {
      await ensureReady();
      const result=await pool.query(`INSERT INTO receipt_backfill(cluster,owner,lease_until,progress) VALUES($1,$2,NOW()+$3*INTERVAL '1 millisecond','{}')
        ON CONFLICT(cluster) DO UPDATE SET owner=EXCLUDED.owner,lease_until=EXCLUDED.lease_until
        WHERE receipt_backfill.lease_until IS NULL OR receipt_backfill.lease_until<=NOW() RETURNING progress`,[cluster,owner,leaseMs]);
      return result.rows[0]?.progress??null;
    },
    async checkpointReceiptBackfill(cluster,owner,progress,leaseMs) {
      await ensureReady();
      const result=await pool.query(`UPDATE receipt_backfill SET progress=$3::jsonb,lease_until=NOW()+$4*INTERVAL '1 millisecond'
        WHERE cluster=$1 AND owner=$2 AND lease_until>NOW()`,[cluster,owner,JSON.stringify(progress),leaseMs]);return result.rowCount===1;
    },
    async releaseReceiptBackfill(cluster,owner) {await ensureReady();await pool.query('UPDATE receipt_backfill SET owner=NULL,lease_until=NULL WHERE cluster=$1 AND owner=$2',[cluster,owner]);},
    async readReceiptBackfillStatus(cluster) {
      await ensureReady();const row=(await pool.query('SELECT owner,lease_until,progress,last_run FROM receipt_backfill WHERE cluster=$1',[cluster])).rows[0];
      return row?{owner:row.owner,expiresAt:row.lease_until?new Date(row.lease_until).getTime():0,progress:row.progress,lastRun:row.last_run}:null;
    },
    async recordReceiptBackfillOutcome(cluster,owner,outcome) {
      const clean=receiptWorkerOutcome(outcome);await ensureReady();
      return (await pool.query('UPDATE receipt_backfill SET last_run=$3::jsonb WHERE cluster=$1 AND owner=$2 AND lease_until>NOW()',[cluster,owner,JSON.stringify(clean)])).rowCount===1;
    },
    async readReceiptProofs(keys) {
      await ensureReady();
      if (keys.length>24) throw new Error('Receipt proof read exceeds page limit.');
      const result=await pool.query('SELECT payload FROM receipt_proofs WHERE fingerprint=ANY($1::text[])',[keys]);
      return result.rows.map(row=>row.payload);
    },
    async pruneReceiptProofs(input) {
      const options=receiptRetentionOptions(input);await ensureReady();
      const client=await pool.connect();
      try {
        await client.query('BEGIN');
        const rows=await client.query(`SELECT fingerprint FROM receipt_proofs WHERE verified_at<$1
          ORDER BY verified_at,fingerprint LIMIT $2 ${options.apply?'FOR UPDATE SKIP LOCKED':''}`,[options.before,options.limit+1]);
        const keys=rows.rows.slice(0,options.limit).map(row=>row.fingerprint);
        let removed=0;
        if(options.apply&&keys.length)removed=(await client.query('DELETE FROM receipt_proofs WHERE fingerprint=ANY($1::text[]) AND verified_at<$2',[keys,options.before])).rowCount;
        await client.query('COMMIT');return receiptRetentionResult(options,keys.length,rows.rowCount>options.limit,removed);
      }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
    },
    async writeReceiptProofs(entries) {
      await ensureReady();
      if (entries.length>24) throw new Error('Receipt proof write exceeds page limit.');
      if (!entries.length) return;
      await pool.query(`INSERT INTO receipt_proofs(fingerprint,payload)
        SELECT value->>'key',value FROM jsonb_array_elements($1::jsonb)
        ON CONFLICT(fingerprint) DO UPDATE SET payload=EXCLUDED.payload,verified_at=NOW()`,[JSON.stringify(entries)]);
    },
    async readCreatorReceiptPage(id, cluster, after = '') {
      await ensureReady();
      const client=await pool.connect();
      const state={creatorProfiles:{},launches:{},obligations:{},claims:{},collections:{},payouts:{}};
      const keyed=rows=>Object.fromEntries(rows.map(row=>[row.entity_key,row.payload]));
      try {
        await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
        const rows=(await client.query(`SELECT p.entity_key,p.payload FROM state_entities p
          JOIN state_entities o ON o.bucket='obligations' AND o.entity_key=p.payload->>'obligationId'
          WHERE p.bucket='payouts' AND p.payload->>'cluster'=$2 AND p.payload->>'status'='paid'
            AND jsonb_typeof(p.payload->'signature')='string' AND p.payload->>'signature'<>''
            AND o.payload->>'xUserId'=$1 AND p.entity_key COLLATE "C">$3 COLLATE "C"
          ORDER BY p.entity_key COLLATE "C" LIMIT $4`,[id,cluster,after,RECEIPT_WINDOW+1])).rows;
        const selected=rows.slice(0,RECEIPT_WINDOW);state.payouts=keyed(selected);
        const payouts=selected.map(row=>row.payload);
        state.creatorProfiles=keyed((await client.query("SELECT entity_key,payload FROM state_entities WHERE bucket='creatorProfiles' AND entity_key=$1",[id])).rows);
        state.obligations=keyed((await client.query("SELECT entity_key,payload FROM state_entities WHERE bucket='obligations' AND entity_key=ANY($1::text[]) AND payload->>'xUserId'=$2",[payouts.map(row=>row.obligationId),id])).rows);
        state.claims=keyed((await client.query("SELECT entity_key,payload FROM state_entities WHERE bucket='claims' AND entity_key=ANY($1::text[]) AND payload->>'xUserId'=$2",[payouts.map(row=>row.claimId).filter(Boolean),id])).rows);
        const obligations=Object.values(state.obligations);
        state.collections=keyed((await client.query("SELECT entity_key,payload FROM state_entities WHERE bucket='collections' AND entity_key=ANY($1::text[])",[obligations.map(row=>row.claimSignature).filter(Boolean)])).rows);
        state.launches=keyed((await client.query("SELECT mint AS entity_key,payload FROM launches WHERE mint=ANY($1::text[]) AND payload->>'xUserId'=$2 AND payload->>'cluster'=$3",[obligations.map(row=>row.mint).filter(Boolean),id,cluster])).rows);
        await client.query('COMMIT');
        return {state,nextCursor:rows.length>RECEIPT_WINDOW?encodeReceiptCursor(selected.at(-1).entity_key):null,checkedPayouts:selected.length};
      }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
    },
    async readReceiptCandidates(cluster) {
      await ensureReady();
      const client = await pool.connect();
      try {
        await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
        const result = { collections: [], payouts: [], coverage: {}, scope: 'global-recent' };
        for (const [bucket, status, label] of [['collections', 'collected', 'Collections'], ['payouts', 'paid', 'Payouts']]) {
          const filter = "bucket=$1 AND payload->>'cluster'=$2 AND payload->>'status'=$3 AND jsonb_typeof(payload->'signature')='string' AND payload->>'signature'<>''";
          const args = [bucket, cluster, status];
          const count = await client.query('SELECT record_count AS count FROM receipt_counts WHERE bucket=$1 AND cluster=$2',[bucket,cluster]);
          const rows = await client.query(`SELECT payload FROM state_entities WHERE ${filter}
            ORDER BY COALESCE(NULLIF(payload->>'recordedAt',''),payload->>'paidAt','') COLLATE "C" DESC, entity_key COLLATE "C" LIMIT $4`, [...args, RECEIPT_WINDOW]);
          result[bucket] = rows.rows.map(row => row.payload);
          const recorded=Number(count.rows[0]?.count||0);
          if(!Number.isSafeInteger(recorded))throw new Error('Receipt count exceeds supported precision.');
          result.coverage[`recorded${label}`] = recorded;
          result.coverage[`checked${label}`] = result[bucket].length;
        }
        await client.query('COMMIT');
        return result;
      } catch (error) { await client.query('ROLLBACK'); throw error; }
      finally { client.release(); }
    },
    async readCoinFeeActivity(mint, cluster) {
      await ensureReady();
      const result = await pool.query(`SELECT c.payload AS collection, s.payload AS settlement
        FROM collections c LEFT JOIN settlements s ON s.claim_signature = c.signature
        WHERE c.mint = $1 AND c.status = 'collected' AND c.payload->>'attribution' = 'mint-verified'
          AND (c.collected_lamports IS NULL OR c.collected_lamports > 0)
          AND (c.payload->>'cluster' IS NULL OR c.payload->>'cluster' = $2)
        ORDER BY c.recorded_at DESC`, [mint, cluster]);
      return {
        collections: result.rows.map(({ collection: item }) => ({ signature: item.signature, recordedAt: item.recordedAt || null, collectedLamports: item.collectedLamports ?? null })),
        claims: result.rows.flatMap(({ collection: item, settlement }) => settlement ? [{ claimSignature: item.signature, status: settlement.status || 'recorded', grossCreatorFees: settlement.grossCreatorFees ?? null, asset: settlement.asset || 'SOL', claimedAt: settlement.claimedAt || null }] : []),
      };
    },
    async readRouterFeeActivity(router, cluster) {
      await ensureReady();
      const result = await pool.query(`SELECT payload FROM collections
        WHERE payload->>'router' = $1 AND status = 'collected' AND collected_lamports > 0
          AND (payload->>'attribution' IS NULL OR payload->>'attribution' <> 'mint-verified')
          AND (payload->>'cluster' IS NULL OR payload->>'cluster' = $2)
        ORDER BY recorded_at DESC LIMIT 100`, [router, cluster]);
      return result.rows.map(({ payload: item }) => ({ signature: item.signature, recordedAt: item.recordedAt || null, collectedLamports: item.collectedLamports }));
    },
  };
}
