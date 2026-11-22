import assert from 'node:assert/strict';
import {Transaction} from '@solana/web3.js';
import {SOLANA_GENESIS} from '../solana-network.js';
import {reviewedMainnetManifest} from '../mainnet-program.js';
import {readRewardExpiryContext} from './reward-expiry-context.mjs';
import {expiryDigest,expiryObjectHash,expiryPlanHash,expirySnapshot,requireExpiryAttempt,finalizedExpiryAttempt} from './reward-expiry-attempt.mjs';

// Persist signed bytes in the existing locked schedule journal BEFORE submission.
// An unknown attempt is never replaced, even if its cycle is now inactive.
export async function executeRewardExpiry({store,plan,connection,programId,currentAuthority,cluster,expectedProgramDataSha256,
  send,requireReady,release=reviewedMainnetManifest()}){
  plan=structuredClone(plan);
  expectedProgramDataSha256=String(expectedProgramDataSha256||'').toLowerCase();
  assert(/^[a-f0-9]{64}$/.test(expectedProgramDataSha256),'Pinned expiry ProgramData hash required.');
  assert(store?.read&&store?.transaction&&typeof plan?.id==='string'&&plan.id,'Durable expiry schedule store and ID required.');
  const options={connection,plan,programId,currentAuthority,cluster,expectedProgramDataSha256,release};
  const row=state=>{const saved=state.schedules?.[plan.id];assert(saved&&expiryPlanHash(saved)===expiryPlanHash(plan),'Saved expiry schedule changed.');return saved;};
  const prior=row(await store.read()).expiryAttempt;
  const finish=async attempt=>{
    requireExpiryAttempt(attempt,options);
    if(attempt.state==='verified'){
      assert(attempt.proof?.expiryTransactionVerified===true&&attempt.proof.signature===attempt.signature
        &&attempt.proof.messageHash===attempt.messageHash&&attempt.proof.address===plan.cycle
        &&attempt.proof.vault===attempt.before.vault&&attempt.proof.originalAuthority===attempt.before.originalAuthority
        &&attempt.proof.unpaidAmount===attempt.before.unpaidAmount&&attempt.proof.liabilityDeltaVerified===true
        &&attempt.proof.programId===String(programId)&&attempt.proof.genesisHash===SOLANA_GENESIS[cluster]
        &&attempt.proof.programDataSha256===expectedProgramDataSha256
        &&[attempt.proof.transactionSlot,attempt.proof.programDataContextSlot,attempt.proof.accountContextSlot].every(Number.isSafeInteger)
        &&attempt.proof.transactionSlot>=attempt.before.slot&&attempt.proof.programDataContextSlot>=attempt.proof.transactionSlot
        &&attempt.proof.accountContextSlot>=attempt.proof.programDataContextSlot,'Saved expiry completion lacks exact proof.');
      return structuredClone(attempt.proof);
    }
    const proof=await finalizedExpiryAttempt({...options,attempt});
    if(!proof)return {expired:false,status:'expiry-reconciliation-pending',signature:attempt.signature};
    return store.transaction(state=>{
      const active=row(state).expiryAttempt;assert(active&&active.messageHash===attempt.messageHash&&active.signature===attempt.signature
        &&active.snapshotHash===attempt.snapshotHash,'Expiry attempt changed during reconciliation.');
      active.state='verified';active.proof=structuredClone(proof);return proof;
    });
  };
  if(prior)return finish(prior);
  await requireReady(plan);
  const before=await readRewardExpiryContext(options);
  if(!before.record.reserved)return {expired:false,status:'inactive-cycle-without-attributed-expiry',address:before.cycle};
  let prepared;
  try{
    await send(new Transaction().add(before.instruction),{beforeBroadcast:async payload=>{
      const tx=Transaction.from(Buffer.from(payload.transactionBase64,'base64')),snapshot=expirySnapshot(before);
      const [quote,balance]=await Promise.all([connection.getFeeForMessage(tx.compileMessage(),'finalized'),connection.getBalance(currentAuthority,'finalized')]);
      assert(Number.isSafeInteger(quote?.value)&&quote.value>=0&&Number.isSafeInteger(balance)
        &&BigInt(balance)>=3000000000n+BigInt(quote.value),'Protected operator reserve is insufficient for expiry fee.');
      const attempt={version:1,state:'prepared',cluster,genesisHash:SOLANA_GENESIS[cluster],programId:String(programId),
        programDataSha256:expectedProgramDataSha256,planHash:expiryPlanHash(plan),before:snapshot,snapshotHash:expiryObjectHash(snapshot),
        signature:payload.signature,transactionBase64:payload.transactionBase64,blockhash:payload.blockhash,lastValidBlockHeight:payload.lastValidBlockHeight,
        messageHash:expiryDigest(tx.serializeMessage())};
      requireExpiryAttempt(attempt,options);
      await store.transaction(state=>{
        const saved=row(state);assert(!saved.expiryAttempt,'Another durable expiry attempt already owns this cycle.');
        saved.expiryAttempt=structuredClone(attempt);
      });
      prepared=attempt;
    }});
  }catch(error){
    // Even signing/preflight/transport exceptions may follow a successful durable
    // write or broadcast. Consult the stored exact attempt; never sign a new one.
    prepared=row(await store.read()).expiryAttempt;
    if(!prepared)throw error;
  }
  assert(prepared,'Expiry transport did not durably prepare its signed message.');
  return finish(prepared);
}
