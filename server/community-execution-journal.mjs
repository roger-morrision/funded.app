import {randomUUID} from 'node:crypto';
import bs58 from 'bs58';
import {PublicKey,VersionedTransaction} from '@solana/web3.js';
import {allocationAuditHash} from './allocation-audit-hash.mjs';
import {DEVNET_GENESIS_HASH} from './automatic-reward-chain.mjs';
import {signTransaction} from './transaction-signing.mjs';

const BUCKET='communityExecutions',RESERVE=3000000000n;
const snapshot=value=>structuredClone(value);
const pending=row=>({status:'verification-pending',signature:row.signature,key:row.key});
// Margin beyond lastValidBlockHeight before a missing receipt counts as final.
export const UNLANDED_MARGIN_BLOCKS=150;
async function unlandable(connection,row){
  if(!Number.isSafeInteger(row.lastValidBlockHeight)||row.lastValidBlockHeight<1)return false;
  const height=await connection.getBlockHeight('finalized');
  if(!Number.isSafeInteger(height)||height<=row.lastValidBlockHeight+UNLANDED_MARGIN_BLOCKS)return false;
  return !await connection.getTransaction(row.signature,{commitment:'finalized',maxSupportedTransactionVersion:0});
}

// Internal worker primitive; never expose prepare/prove callbacks to HTTP input.
// The signed bytes and signature are committed before broadcast. An ambiguous
// outcome can only rebroadcast those same bytes; a replacement is prepared only
// after the saved blockhash is provably expired with no finalized receipt.
export async function executeCommunityJournal({store,connection,key,intent,authority,prepare,prove,
  now=()=>Date.now(),leaseMs=60000,reserveLamports=String(RESERVE)}){
  if(!/^community:[1-9A-HJ-NP-Za-km-z]{32,44}:(open|[1-9A-HJ-NP-Za-km-z]{32,44})$/.test(key)
    ||intent?.cluster!=='devnet'||!/^[a-f0-9]{64}$/.test(String(intent.approvedHash))
    ||typeof prepare!=='function'||typeof prove!=='function'||BigInt(reserveLamports)<RESERVE)
    throw new Error('A bounded, approved Devnet community execution is required.');
  if(await connection.getGenesisHash()!==DEVNET_GENESIS_HASH)throw new Error('Community execution requires Devnet.');
  const intentHash=allocationAuditHash(intent),token=randomUUID(),at=now();
  const acquired=await store.update(state=>{
    state[BUCKET]||={};const existing=state[BUCKET][key];
    if(existing&&(existing.intentHash!==intentHash||allocationAuditHash(existing.intent)!==intentHash))
      throw new Error('The immutable community execution intent changed.');
    if(existing?.signature||existing?.leaseUntil>at)return{owned:false,row:snapshot(existing)};
    const row={...existing,key,intent:snapshot(intent),intentHash,status:'preparing',token,leaseUntil:at+leaseMs,
      createdAt:existing?.createdAt||new Date(at).toISOString()};
    state[BUCKET][key]=row;return{owned:true,row:snapshot(row)};
  });
  let row=acquired.row;
  if(row.evidence!==undefined&&allocationAuditHash(row.evidence)!==row.evidenceHash)
    throw new Error('Saved community execution evidence changed.');
  const reconcile=async current=>{
    // Even a previous success is independently reproved on every caller pass.
    const proof=await prove(snapshot(current));
    if(!proof)return null;
    if(proof.signature!==current.signature||proof.finalized!==true||proof.balanceDeltaVerified!==true)
      throw new Error('Community execution lacks finalized balance-change proof.');
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
    if(!(await connection.isBlockhashValid(row.blockhash,'finalized')).value){
      if(outcome||!await unlandable(connection,row))return pending(row);
      // Past lastValidBlockHeight (plus margin) with no finalized receipt the
      // signed bytes can never execute, so this attempt is retired and the next
      // pass may prepare a fresh transaction.
      const retired=await store.update(state=>{
        const active=state[BUCKET]?.[key];
        if(active?.signature!==row.signature||active.intentHash!==intentHash)return false;
        const {signature,signedTransaction,blockhash,lastValidBlockHeight,evidence,evidenceHash,...rest}=active;
        state[BUCKET][key]={...rest,status:'expired-unlanded',leaseUntil:0,
          expiredAttempts:[...(active.expiredAttempts||[]),{signature,blockhash,lastValidBlockHeight,expiredAt:new Date(now()).toISOString()}].slice(-10)};
        return true;
      });
      return retired?{status:'expired-unlanded',signature:row.signature,key}:pending(row);
    }
  }else{
    if(!acquired.owned)return{status:'preparation-active',key};
    const built=await prepare(snapshot(row));
    if(!(built?.transaction instanceof VersionedTransaction)||!Number.isSafeInteger(built.lastValidBlockHeight)
      ||built.lastValidBlockHeight<1||!/^(0|[1-9]\d*)$/.test(String(built.estimatedRentLamports)))
      throw new Error('An exact bounded community transaction and rent estimate are required.');
    const tx=built.transaction,signer=new PublicKey(authority.publicKey);
    if(tx.message.header.numRequiredSignatures!==1||!tx.message.staticAccountKeys[0].equals(signer)
      ||tx.serialize().length>1232)throw new Error('The community authority must be the only fee payer and signer.');
    const[fee,balance,valid]=await Promise.all([connection.getFeeForMessage(tx.message,'confirmed'),
      connection.getBalance(signer,'finalized'),connection.isBlockhashValid(tx.message.recentBlockhash,'finalized')]);
    if(!valid.value||!Number.isSafeInteger(fee.value)||fee.value<0||!Number.isSafeInteger(balance)
      ||BigInt(balance)-BigInt(fee.value)-BigInt(built.estimatedRentLamports)<BigInt(reserveLamports))
      throw new Error('Community execution would breach the protected payer reserve or its quote expired.');
    await signTransaction(tx,[authority]);
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
    if(sent!==row.signature)throw new Error('RPC returned a different community signature.');
  }catch{
    // Even explicit RPC errors are reconciled, never assumed to mean no debit.
  }
  return await reconcile(row)||pending(row);
}
