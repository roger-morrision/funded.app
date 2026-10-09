import { creatorWriteState, mutateCreatorState } from '../creator-state.mjs';
import { searchGrams } from '../creator-search.mjs';
import { followingWindow, followingUpdatesPage } from '../following-updates.mjs';
import { projectCreatorDirectory } from './ledger.mjs';

// Each operation uses the shared pool and readiness gate; transactions stay local.
export function createCreatorsRepository({ pool, ensureReady }) {
  return {
    async readFollowingUpdates(cluster,ids,after='') {
      const {selected}=followingWindow(ids,after);await ensureReady();
      // A single statement snapshot reads <=20 directory/profile pairs, never financial rows.
      const result=await pool.query(`SELECT d.payload AS creator,p.payload AS profile FROM creator_directory d
        LEFT JOIN state_entities p ON p.bucket='creatorProfiles' AND p.entity_key=d.creator_id
        WHERE d.cluster=$1 AND d.creator_id=ANY($2::text[]) ORDER BY d.creator_id`,[cluster,selected]);
      return followingUpdatesPage(result.rows.map(row=>row.creator),Object.fromEntries(result.rows.filter(row=>row.profile).map(row=>[row.creator.id,row.profile])),ids,after);
    },
    async updateCreatorProfile(id, mutator) {
      creatorWriteState({}, id); // Validate before taking any locks.
      await ensureReady();
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        // Shared with other profile writers, exclusive against the legacy ledger
        // writer/migration. A per-identity lock also covers first-time inserts.
        await client.query('SELECT pg_advisory_xact_lock_shared(81730421)');
        await client.query("SELECT pg_advisory_xact_lock(81730422, hashtext($1))", [id]);
        const profile = await client.query("SELECT payload FROM state_entities WHERE bucket='creatorProfiles' AND entity_key=$1", [id]);
        const launches = await client.query("SELECT mint,payload FROM launches WHERE payload->>'xUserId'=$1", [id]);
        const scoped = creatorWriteState({ creatorProfiles: profile.rowCount ? { [id]: profile.rows[0].payload } : {},
          launches: Object.fromEntries(launches.rows.map(row => [row.mint,row.payload])) }, id);
        const output = await mutateCreatorState(scoped, id, mutator);
        if (scoped.creatorProfiles[id]) await client.query("INSERT INTO state_entities(bucket,entity_key,payload) VALUES('creatorProfiles',$1,$2::jsonb) ON CONFLICT(bucket,entity_key) DO UPDATE SET payload=EXCLUDED.payload", [id,JSON.stringify(scoped.creatorProfiles[id])]);
        else await client.query("DELETE FROM state_entities WHERE bucket='creatorProfiles' AND entity_key=$1", [id]);
        await projectCreatorDirectory(client, scoped, new Set([id]));
        await client.query('COMMIT');
        return output;
      } catch (error) { await client.query('ROLLBACK'); throw error; }
      finally { client.release(); }
    },
    async readCreatorState(id, cluster, {financial=true}={}) {
      await ensureReady();
      const client=await pool.connect();
      const state={creatorProfiles:{},launches:{},obligations:{},claims:{},collections:{},payouts:{}};
      const keyed=rows=>Object.fromEntries(rows.map(row=>[row.entity_key,row.payload]));
      try {
        await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
        state.creatorProfiles=keyed((await client.query("SELECT entity_key,payload FROM state_entities WHERE bucket='creatorProfiles' AND entity_key=$1",[id])).rows);
        state.launches=keyed((await client.query("SELECT mint AS entity_key,payload FROM launches WHERE payload->>'xUserId'=$1 AND payload->>'cluster'=$2",[id,cluster])).rows);
        if(financial){
          state.obligations=keyed((await client.query("SELECT entity_key,payload FROM state_entities WHERE bucket='obligations' AND payload->>'xUserId'=$1",[id])).rows);
          state.claims=keyed((await client.query("SELECT entity_key,payload FROM state_entities WHERE bucket='claims' AND payload->>'xUserId'=$1",[id])).rows);
          state.collections=keyed((await client.query("SELECT entity_key,payload FROM state_entities WHERE bucket='collections' AND entity_key=ANY($1::text[])",[Object.values(state.obligations).map(row=>row.claimSignature).filter(Boolean)])).rows);
          state.payouts=keyed((await client.query("SELECT entity_key,payload FROM state_entities WHERE bucket='payouts' AND payload->>'obligationId'=ANY($1::text[])",[Object.keys(state.obligations)])).rows);
        }
        await client.query('COMMIT');return state;
      }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
    },
    async readCreatorDirectory({ cluster, after = '', query = '', follows = [] }) {
      await ensureReady();
      // Only this small public projection is read; neither the financial ledger nor sessions are loaded.
      const values = [cluster, after];
      let filter = '';
      if (query) { values.push(searchGrams(query));filter+=` AND search_grams @> $${values.length}::text[]`;values.push(query);filter+=` AND strpos(search_text, $${values.length}) > 0`; }
      if (follows.length) { values.push(follows); filter += ` AND creator_id = ANY($${values.length}::text[])`; }
      const result = await pool.query(`SELECT payload FROM creator_directory WHERE cluster = $1 AND creator_id > $2 COLLATE "C"${filter} ORDER BY creator_id LIMIT 51`, values);
      const creators = result.rows.slice(0,50).map(row => row.payload);
      return { creators, limit: 50, nextCursor: result.rows.length > 50 ? creators.at(-1).id : null };
    },
  };
}
