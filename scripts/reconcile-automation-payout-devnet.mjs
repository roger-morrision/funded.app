// Receipt-only recovery: no signer, signing key, or sendTransaction is used.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {PublicKey} from '@solana/web3.js';
import {loadFinalizedV3RewardFunding} from '../server/v3-reward-funding-proof.mjs';
import {buildV3PolicyDisbursement} from '../server/v3-policy-builders.mjs';
import {v3DisbursementId} from '../server/v3-disbursement-id.mjs';

const ledger=JSON.parse(await readFile('tmp/automation-release/service-ledger-evidence.json','utf8'));
const deployment=JSON.parse(await readFile('tmp/automation-release/deployed-program.json','utf8'));
const source=Object.keys(ledger.ledgers.v3Settlements)[0],launch=ledger.launch,settled=ledger.ledgers.v3Settlements[source];
const kind=process.argv[2]||'creator-wallet',bucket={'creator-wallet':'v3CreatorWalletPayout','creator-reward':'v3CreatorRewardFunding',
  community:'v3CommunityFunding',operations:'v3OperationsPayout'}[kind];assert(bucket);
const row=ledger.ledgers[bucket]?.[source];assert(row?.signature&&row.status==='verification-pending');
const category=row.category,beneficiary={'creator-wallet':0,'creator-reward':1,community:7,operations:3}[kind];
const input={programId:deployment.program,mint:launch.mint,authority:launch.pumpFeeRoute.initialAuthority,
  initialAuthority:launch.pumpFeeRoute.initialAuthority,creator:launch.creatorWallet,withdrawalId:v3DisbursementId(kind,settled.settlementSignature),
  category,beneficiary,amount:row.amount,recipient:row.recipient,split:launch.pumpFeeRoute.protocolSplit,protectedPolicy:true,
  holderAmount:kind==='creator-reward'?settled.allocationPlan.creatorDirected.holderLamports:'0'};
const rpc=(await readFile('.secrets/automation-selected-rpc-url','utf8')).trim();
async function batch(calls){
  const response=await fetch(rpc,{method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify(calls.map(([method,params],id)=>({jsonrpc:'2.0',id,method,params}))),signal:AbortSignal.timeout(30000)});
  assert(response.ok,`RPC ${response.status}`);const rows=await response.json();
  return calls.map((_,id)=>{const r=rows.find(r=>r.id===id);assert(r&&!r.error,JSON.stringify(r?.error));return r.result;});
}
const [genesis,tx]=await batch([['getGenesisHash',[]],['getTransaction',[row.signature,{encoding:'json',commitment:'finalized',maxSupportedTransactionVersion:0}]]]);
assert.equal(genesis,'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG');assert(tx&&tx.meta.err===null);
const built=buildV3PolicyDisbursement({...input,auto:true});
const keys=[...new Set([...built.instruction.keys.map(row=>row.pubkey.toBase58()),deployment.program,'4hw9GBAx5BicgiGCiw9hKVu1Xs4xWDrdqXSAFzgn4bwa'])];
const [snapshot]=await batch([['getMultipleAccounts',[keys,{encoding:'base64',commitment:'finalized',minContextSlot:tx.slot}]]]);
assert(snapshot.context.slot>=tx.slot);const accounts=new Map(keys.map((key,i)=>[key,snapshot.value[i]?{
  ...snapshot.value[i],owner:new PublicKey(snapshot.value[i].owner),data:Buffer.from(snapshot.value[i].data[0],'base64')}:null]));
assert.equal(createHash('sha256').update(accounts.get('4hw9GBAx5BicgiGCiw9hKVu1Xs4xWDrdqXSAFzgn4bwa').data).digest('hex'),deployment.programDataSha256);
const connection={getAccountInfo:async address=>{const key=address.toBase58();assert(accounts.has(key),'Unpinned account requested');return accounts.get(key);}};
const proof=await loadFinalizedV3RewardFunding({...input,connection,signature:row.signature,transaction:tx});
assert(proof?.balanceDeltaVerified&&proof.authorization==='immutable-mint-automation');
const result={kind,bucket,source,proof,verification:{genesis,commitment:'finalized',snapshotSlot:snapshot.context.slot,transactionSlot:tx.slot,
  programDataSha256:deployment.programDataSha256,readOnly:true},at:new Date().toISOString()};
await writeFile(`tmp/automation-release/reconciled-${kind}.json`,JSON.stringify(result,null,2));console.log(JSON.stringify(result));
