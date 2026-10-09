import { validClaimId, mutateClaimState } from '../claim-state.mjs';
import { mutateReferralClaimState } from '../referral-claim-state.mjs';
import { project } from './ledger.mjs';

async function readClaimStateFor(client,id) {
  const state={claims:{},obligations:{},collections:{},launches:{},payouts:{}};
  const claim=(await client.query("SELECT payload FROM state_entities WHERE bucket='claims' AND entity_key=$1",[id])).rows[0]?.payload;
  if(claim)state.claims[id]=claim;
  const obligationId=claim?.obligationId||id;
  const obligation=(await client.query("SELECT payload FROM state_entities WHERE bucket='obligations' AND entity_key=$1",[obligationId])).rows[0]?.payload;
  if(obligation){
    state.obligations[obligationId]=obligation;
    const collection=(await client.query("SELECT payload FROM state_entities WHERE bucket='collections' AND entity_key=$1",[obligation.claimSignature])).rows[0]?.payload;
    if(collection)state.collections[obligation.claimSignature]=collection;
    const launch=(await client.query('SELECT payload FROM launches WHERE mint=$1',[obligation.mint])).rows[0]?.payload;
    if(launch)state.launches[obligation.mint]=launch;
  }
  const payouts=await client.query("SELECT entity_key,payload FROM state_entities WHERE bucket='payouts' AND payload->>'claimId'=$1",[id]);
  state.payouts=Object.fromEntries(payouts.rows.map(row=>[row.entity_key,row.payload]));return state;
}

async function readReferralClaimStateFor(client,id) {
  const claims=await client.query("SELECT entity_key,payload FROM state_entities WHERE bucket='referralClaims' AND entity_key=$1",[id]);
  const payouts=await client.query("SELECT entity_key,payload FROM state_entities WHERE bucket='payouts' AND (payload->>'claimId'=$1 OR entity_key=$2)",[id,`referral:${id}`]);
  return {referralClaims:Object.fromEntries(claims.rows.map(row=>[row.entity_key,row.payload])),payouts:Object.fromEntries(payouts.rows.map(row=>[row.entity_key,row.payload]))};
}

// Each operation uses the shared pool and readiness gate; transactions stay local.
export function createClaimsRepository({ pool, ensureReady }) {
  return {
    async readClaimState(id) {
      validClaimId(id);await ensureReady();const client=await pool.connect();
      try{await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');const state=await readClaimStateFor(client,id);await client.query('COMMIT');return state;}
      catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
    },
    async readReferralClaimState(id) {
      validClaimId(id);await ensureReady();const client=await pool.connect();
      try{await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');const state=await readReferralClaimStateFor(client,id);await client.query('COMMIT');return state;}
      catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
    },
    async updateReferralClaimState(id,mutator) {
      validClaimId(id);await ensureReady();const client=await pool.connect();
      try {
        await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock_shared(81730421)');
        await client.query('SELECT pg_advisory_xact_lock(81730424,hashtext($1))',[id]);
        const state=await readReferralClaimStateFor(client,id),output=await mutateReferralClaimState(state,id,mutator);
        for(const [bucket,key] of [['referralClaims',id],['payouts',`referral:${id}`]])if(state[bucket][key]){
          await client.query('INSERT INTO state_entities(bucket,entity_key,payload) VALUES($1,$2,$3::jsonb) ON CONFLICT(bucket,entity_key) DO UPDATE SET payload=EXCLUDED.payload',[bucket,key,JSON.stringify(state[bucket][key])]);
          await project(client,bucket,key,state[bucket][key]);
        }
        await client.query('COMMIT');return output;
      }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
    },
    async updateClaimState(id,mutator) {
      validClaimId(id);await ensureReady();const client=await pool.connect();
      try {
        await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock_shared(81730421)');
        await client.query('SELECT pg_advisory_xact_lock(81730423,hashtext($1))',[id]);
        const state=await readClaimStateFor(client,id),output=await mutateClaimState(state,id,mutator);
        for(const [bucket,key] of [['claims',id],['payouts',`x:${id}`]])if(state[bucket][key])await client.query('INSERT INTO state_entities(bucket,entity_key,payload) VALUES($1,$2,$3::jsonb) ON CONFLICT(bucket,entity_key) DO UPDATE SET payload=EXCLUDED.payload',[bucket,key,JSON.stringify(state[bucket][key])]);
        await client.query('COMMIT');return output;
      }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
    },
    async readReferralClaimsForWallet(wallet) {
      await ensureReady();
      const result = await pool.query("SELECT payload FROM referral_claims WHERE payload->>'recipientWallet' = $1 ORDER BY updated_at DESC", [wallet]);
      return result.rows.map(row => row.payload);
    },
  };
}
