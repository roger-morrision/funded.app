import {randomUUID} from 'node:crypto';
import bs58 from 'bs58';
import {PublicKey,VersionedTransaction} from '@solana/web3.js';
import {allocationAuditHash} from './allocation-audit-hash.mjs';
import {DEVNET_GENESIS_HASH} from './automatic-reward-chain.mjs';

const BUCKET='v3AgencyExecutions',RESERVE=3000000000n;
const snapshot=value=>structuredClone(value);
const pending=row=>({status:'verification-pending',signature:row.signature,key:row.key});

// Internal worker primitive; never expose prepare/prove callbacks to HTTP input.
// The signed bytes and signature are committed before broadcast. An ambiguous
// outcome can only rebroadcast those same bytes, never create a replacement.
export async function executeAgencyJournal({store,connection,key,intent,authority,prepare,prove,
  now=()=>Date.now(),leaseMs=60000,reserveLamports=String(RESERVE)}){
  if(!/^agency:[1-9A-HJ-NP-Za-km-z]{32,44}:[012]:\d{1,10}$/.test(key)
    ||intent?.cluster!=='devnet'||!/^[a-f0-9]{64}$/.test(String(intent.approvedHash))
    ||typeof prepare!=='function'||typeof prove!=='function'||BigInt(reserveLamports)<RESERVE)
    throw new Error('A bounded, approved Devnet agency execution is required.');
  if(await connection.getGenesisHash()!==DEVNET_GENESIS_HASH)throw new Error('Agency execution requires Devnet.');
  const intentHash=allocationAuditHash(intent),token=randomUUID(),at=now();
  const acquired=await store.update(state=>{
    state[BUCKET]||={};const existing=state[BUCKET][key];
    if(existing&&(existing.intentHash!==intentHash||allocationAuditHash(existing.intent)!==intentHash))
      throw new Error('The immutable agency execution intent changed.');
    if(existing?.signature||existing?.leaseUntil>at)return{owned:false,row:snapshot(existing)};
    const row={...existing,key,intent:snapshot(intent),intentHash,status:'preparing',token,leaseUntil:at+leaseMs,
      createdAt:existing?.createdAt||new Date(at).toISOString()};
    state[BUCKET][key]=row;return{owned:true,row:snapshot(row)};
  });
  let row=acquired.row;
  if(row.evidence!==undefined&&allocationAuditHash(row.evidence)!==row.evidenceHash)
    throw new Error('Saved agency execution evidence changed.');
  const reconcile=async current=>{
    // Even a previous success is independently reproved on every caller pass.
    const proof=await prove(snapshot(current));
    if(!proof)return null;
    if(proof.signature!==current.signature||proof.finalized!==true||proof.balanceDeltaVerified!==true)
      throw new Error('Agency execution lacks finalized balance-change proof.');
    return store.update(state=>{
      const active=state[BUCKET]?.[key];
      if(active?.signature!==current.signature||active.intentHash!==intentHash)return null;
      const {signedTransaction,...rest}=active;
      const verifiedAt=new Date(now()).toISOString();
      state[BUCKET][key]={...rest,status:'finalized',proof:snapshot(proof),
        finalizedAt:active.finalizedAt||verifiedAt,lastVerifiedAt:verifiedAt};
      return{status:'finalized',signature:current.signature,key,proof:snapshot(proof)};
    });
  };
  if(row.signature){
    const verified=await reconcile(row);if(verified)return verified;
    const outcome=(await connection.getSignatureStatuses([row.signature],{searchTransactionHistory:true})).value?.[0];
    if(outcome?.confirmationStatus==='finalized'&&outcome.err){
      await store.update(state=>{const active=state[BUCKET]?.[key];if(active?.signature===row.signature){
        active.status='failed-finalized';active.failedAt=new Date(now()).toISOString();}});
      return{status:'failed-finalized',signature:row.signature,key};
    }
    if(outcome?.confirmationStatus==='finalized'||!row.signedTransaction)return pending(row);
    if(!(await connection.isBlockhashValid(row.blockhash,'finalized')).value)return pending(row);
  }else{
    if(!acquired.owned)return{status:'preparation-active',key};
    const built=await prepare(snapshot(row));
    if(!(built?.transaction instanceof VersionedTransaction)||!Number.isSafeInteger(built.lastValidBlockHeight)
      ||built.lastValidBlockHeight<1||!/^(0|[1-9]\d*)$/.test(String(built.estimatedRentLamports)))
      throw new Error('An exact bounded agency transaction and rent estimate are required.');
    const tx=built.transaction,signer=new PublicKey(authority.publicKey);
    if(tx.message.header.numRequiredSignatures!==1||!tx.message.staticAccountKeys[0].equals(signer)
      ||tx.serialize().length>1232)throw new Error('The agency authority must be the only fee payer and signer.');
    const[fee,balance,valid]=await Promise.all([connection.getFeeForMessage(tx.message,'confirmed'),
      connection.getBalance(signer,'finalized'),connection.isBlockhashValid(tx.message.recentBlockhash,'finalized')]);
    if(!valid.value||!Number.isSafeInteger(fee.value)||fee.value<0||!Number.isSafeInteger(balance)
      ||BigInt(balance)-BigInt(fee.value)-BigInt(built.estimatedRentLamports)<BigInt(reserveLamports))
      throw new Error('Agency execution would breach the protected payer reserve or its quote expired.');
    tx.sign([authority]);
    const signedTransaction=Buffer.from(tx.serialize()).toString('base64'),signature=bs58.encode(tx.signatures[0]);
    const saved=await store.update(state=>{
      const active=state[BUCKET]?.[key];
      if(active?.signature||active?.token!==token||active?.intentHash!==intentHash||active.leaseUntil<now())return null;
      return state[BUCKET][key]={...active,status:'verification-pending',signature,signedTransaction,
        ...(built.evidence===undefined?{}:{evidence:snapshot(built.evidence),evidenceHash:allocationAuditHash(built.evidence)}),
        blockhash:tx.message.recentBlockhash,lastValidBlockHeight:built.lastValidBlockHeight,
        preparedAt:new Date(now()).toISOString()};
    });
    if(!saved)return{status:'preparation-superseded',key};row=snapshot(saved);
  }
  // Saved signed bytes are immutable. Neither a timeout nor a process restart
  // authorizes a fresh signature, quote, X post, or debit for this action key.
  try{
    const sent=await connection.sendRawTransaction(Buffer.from(row.signedTransaction,'base64'),
      {skipPreflight:false,preflightCommitment:'confirmed',maxRetries:0});
    if(sent!==row.signature)throw new Error('RPC returned a different agency signature.');
  }catch{
    // Even explicit RPC errors are reconciled, never assumed to mean no debit.
  }
  return await reconcile(row)||pending(row);
}
