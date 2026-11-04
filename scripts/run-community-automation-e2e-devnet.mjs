import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import bs58 from 'bs58';
import BN from 'bn.js';
import {Connection,Keypair,PublicKey,SystemProgram,TransactionInstruction,TransactionMessage,VersionedTransaction} from '@solana/web3.js';
import {OnlinePumpAmmSdk,PUMP_AMM_SDK} from '@pump-fun/pump-swap-sdk';
import {createAssociatedTokenAccountIdempotentInstruction,getAssociatedTokenAddressSync} from '@solana/spl-token';
import {devnetAcceptanceFetch} from './devnet-acceptance-fetch.mjs';
import {readProgramDataEvidence} from '../server/automatic-reward-chain.mjs';
import {qaCommunityCutoffMemo} from '../server/community-snapshot.mjs';
import {verifyCommunityProof} from '../community-merkle.js';

const base='http://127.0.0.1:8788',output='tmp/automation-release/community-e2e.json';
const run=JSON.parse(await readFile('tmp/automation-release/services-e2e.json','utf8'));
const deployment=JSON.parse(await readFile('tmp/automation-release/deployed-program.json','utf8'));
const mint=new PublicKey(run.mint),funded=new PublicKey('C5JFX2W3YtLDmiZeUTcYjfLqXPWmW2GZZC5fbxv7ut64');
const authority=Keypair.fromSecretKey(bs58.decode(process.env.FUNDED_ROUTER_AUTHORITY_SECRET_KEY||'')),holder=Keypair.generate();
assert.equal(authority.publicKey.toBase58(),'7epA9KQ5wkwo5wZ5kcY8CfVUvpwVJoAMz2RNqt2ZwK5Y');
const c=new Connection(process.env.FUNDED_AUTOMATION_RPC_URL,{commitment:'finalized',disableRetryOnRateLimit:true,fetch:devnetAcceptanceFetch({intervalMs:750})});
assert.equal(await c.getGenesisHash(),'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG');
assert.equal((await readProgramDataEvidence(c,deployment.program,{rpcUrl:''})).sha256,deployment.programDataSha256);
const report={status:'running',cluster:'devnet',mint:mint.toBase58(),holder:holder.publicKey.toBase58(),snapshotBasis:'devnet-qa-cutoff',
  realMigrationSignature:run.migration,transactions:[],checks:[],privateKeyPersisted:false};
const save=()=>writeFile(output,JSON.stringify(report,null,2));
async function record(stage,data){report.checks.push({stage,...data});await save();console.log(JSON.stringify({stage,...data}));}
const token=execFileSync('docker',['exec','fundedapp-app-1','node','--input-type=module','-e',
  "import{readFileSync}from'node:fs';process.stdout.write(process.env.FUNDED_API_TOKEN||readFileSync(process.env.FUNDED_API_TOKEN_FILE,'utf8').trim())"],{encoding:'utf8'}).trim();
async function api(path,body){
  for(let attempt=0;;attempt++){
    const response=await fetch(base+path,{method:body?'POST':'GET',headers:{origin:'https://funded.vip',authorization:'Bearer '+token,
      ...(body?{'content-type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(120000)});
    const data=await response.json();if([429,503].includes(response.status)&&attempt<3){await new Promise(r=>setTimeout(r,15000));continue;}
    assert(response.ok,`${path}: ${response.status} ${JSON.stringify(data)}`);return data;
  }
}
const lookup=(await c.getAddressLookupTable(new PublicKey(process.env.FUNDED_V3_BUYBACK_LOOKUP_TABLE||'FDx4KpYEkjkfBg7nefPCeNY3tL5kJT4mFTFtsfej58U4'),{commitment:'finalized'})).value;
assert(lookup?.isActive());
async function send(stage,instructions,signer=authority){
  const latest=await c.getLatestBlockhash('finalized'),tx=new VersionedTransaction(new TransactionMessage({payerKey:signer.publicKey,
    recentBlockhash:latest.blockhash,instructions}).compileToV0Message([lookup]));tx.sign([signer]);
  const signature=bs58.encode(tx.signatures[0]),row={stage,signature,status:'submission-pending'};
  report.transactions.push(row);await save();
  assert(tx.serialize().length<=1232);assert.equal(await c.sendRawTransaction(tx.serialize(),{skipPreflight:false,preflightCommitment:'confirmed',maxRetries:2}),signature);
  let final=false;for(let poll=0;poll<90;poll++){
    await new Promise(r=>setTimeout(r,1000));const status=(await c.getSignatureStatuses([signature],{searchTransactionHistory:true})).value[0];
    assert.equal(status?.err||null,null);if(status?.confirmationStatus==='finalized'){final=true;break;}
  }
  assert(final,'Reconcile recorded signature before another attempt');row.status='finalized';await record(stage,{signature});return signature;
}
await send('fund-ephemeral-holder',[SystemProgram.transfer({fromPubkey:authority.publicKey,toPubkey:holder.publicKey,lamports:70000000})]);
const state=await new OnlinePumpAmmSdk(c).swapSolanaState(new PublicKey('EKKUWqwbZKeq4hdth8kdYuHZBtvxDCu3kZahHATbba32'),holder.publicKey);
await send('buy-funded-for-eligibility',await PUMP_AMM_SDK.buyQuoteInput(state,new BN('10000000'),1),holder);
const fundedAta=getAssociatedTokenAddressSync(funded,holder.publicKey,false,state.baseTokenProgram);
const holding=await c.getTokenAccountBalance(fundedAta,'finalized');assert(BigInt(holding.value.amount)>0n);
await record('real-funded-holding',{amount:holding.value.amount,tokenAccount:fundedAta.toBase58()});
const cutoff=await send('explicit-qa-snapshot-cutoff',[new TransactionInstruction({programId:new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr'),
  keys:[{pubkey:authority.publicKey,isSigner:true,isWritable:false}],data:Buffer.from(qaCommunityCutoffMemo({launchMint:mint,eligibilityMint:funded}))})]);
const prepared=await api('/api/airdrops/claims/prepare-qa',{mint:mint.toBase58(),migrationSignature:cutoff});await record('immutable-qa-manifest',prepared);
const approval=await api('/api/airdrops/claims/approval-instruction',{mint:mint.toBase58(),appOwner:authority.publicKey.toBase58()});
const opening=await api('/api/airdrops/claims/opening-instruction',{mint:mint.toBase58()});
const instruction=value=>{assert.equal(value.programId,deployment.program);return new TransactionInstruction({programId:new PublicKey(value.programId),
  keys:value.accounts.map(row=>({...row,pubkey:new PublicKey(row.pubkey)})),data:Buffer.from(value.data,'base64')});};
const opened=await send('approve-and-open-reserve-drop',[instruction(approval),instruction(opening)]);
const receipt=await api('/api/airdrops/claims/opening-receipt',{mint:mint.toBase58(),signature:opened});assert(receipt.verified);await record('verified-drop-opening',receipt);
const proofPath=`/api/airdrops/claims/proof?mint=${mint}&wallet=${holder.publicKey}`,proof=await api(proofPath);assert.equal(proof.status,'claimable');
assert(verifyCommunityProof({drop:proof.drop,recipient:proof.recipient,amount:proof.amount,index:proof.index,proof:proof.proof,root:proof.root}));
const claim=await api('/api/airdrops/claims/claim-instruction',{mint:mint.toBase58(),wallet:holder.publicKey.toBase58()}),mintInfo=await c.getAccountInfo(mint,'finalized');
const destination=new PublicKey(claim.recipientToken),before=await c.getTokenAccountBalance(destination,'finalized').then(r=>BigInt(r.value.amount)).catch(()=>0n);
const claimed=await send('holder-claims-airdrop',[createAssociatedTokenAccountIdempotentInstruction(holder.publicKey,destination,holder.publicKey,mint,mintInfo.owner),instruction(claim)],holder);
const after=BigInt((await c.getTokenAccountBalance(destination,'finalized')).value.amount);assert.equal(after-before,BigInt(proof.amount));
const payment=await c.getAccountInfo(new PublicKey(claim.payment),'finalized');assert(payment.owner.equals(new PublicKey(deployment.program)));assert.equal(payment.data.readBigUInt64LE(72),BigInt(proof.amount));
assert.equal((await api(proofPath)).status,'claimed');await record('exact-token-payment',{signature:claimed,amount:proof.amount,payment:claim.payment,balanceDeltaVerified:true});
report.status='passed-real-devnet-qa-cutoff-fixture';await save();
