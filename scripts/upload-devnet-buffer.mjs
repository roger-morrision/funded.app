// Loader-v3 Write layout: https://docs.rs/solana-loader-v3-interface/latest/src/solana_loader_v3_interface/instruction.rs.html
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import bs58 from 'bs58';
import {Keypair,PublicKey,Transaction,TransactionInstruction} from '@solana/web3.js';
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const batchSize=Number(process.env.FUNDED_BUFFER_BATCH_SIZE||8);
const intervalMs=Number(process.env.FUNDED_BUFFER_BATCH_INTERVAL_MS||4000);
if(!Number.isInteger(batchSize)||batchSize<1||batchSize>8||!Number.isInteger(intervalMs)||intervalMs<4000)
  throw Error('Upload requires 1-8 writes per batch and at least 4 seconds between batches');
const attempt=JSON.parse(await readFile('tmp/automation-release/upgrade-attempt.json','utf8'));
const binary=await readFile('contracts/funded-fee-router/target/automation-candidate/funded_fee_router.so');
if(createHash('sha256').update(binary).digest('hex')!==attempt.binarySha256)throw Error('Candidate hash differs');
const authority=Keypair.fromSecretKey(bs58.decode(process.env.FUNDED_ROUTER_AUTHORITY_SECRET_KEY||''));
if(authority.publicKey.toBase58()!=='7epA9KQ5wkwo5wZ5kcY8CfVUvpwVJoAMz2RNqt2ZwK5Y')throw Error('Dedicated Devnet signer differs');
const rpc=process.env.FUNDED_AUTOMATION_RPC_URL||'https://api.devnet.solana.com';
if(new URL(rpc).protocol!=='https:')throw Error('HTTPS RPC required');
// Batch independent writes and status reads to stay below public connection limits.
// A failed send is never blindly replayed: the next run first reconciles buffer bytes.
async function batch(calls,{readOnly=false}={}){
  for(let retry=0;;retry++){
    const response=await fetch(rpc,{method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify(calls.map(([method,params],id)=>({jsonrpc:'2.0',id,method,params}))),signal:AbortSignal.timeout(30000)});
    if(response.status===429&&readOnly&&retry<3){
      const seconds=Math.min(60,Math.max(15,Number(response.headers.get('retry-after'))||15));
      await response.text();console.log(JSON.stringify({stage:'rpc-read-backoff',seconds,retry:retry+1}));await pause(seconds*1000);continue;
    }
    if(!response.ok){const detail=(await response.text()).slice(0,250);throw Error(`Devnet RPC HTTP ${response.status}, retry-after ${response.headers.get('retry-after')||'unspecified'}: ${detail}; reconcile recorded writes before resuming`);}
    const rows=await response.json();if(!Array.isArray(rows))throw Error('Expected RPC batch response');
    return calls.map((_,id)=>{const row=rows.find(row=>row.id===id);if(!row||row.error)throw Error(`Devnet RPC ${row?.error?.code||'missing-response'}; reconcile recorded writes before resuming`);return row.result;});
  }
}
const buffer=new PublicKey(attempt.buffer),loader=new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111');
const [genesis,account]=await batch([['getGenesisHash',[]],['getAccountInfo',[buffer.toBase58(),{encoding:'base64',commitment:'finalized'}]]],{readOnly:true});
if(genesis!=='EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG')throw Error('Not Devnet');
const info=account?.value,initial=info?Buffer.from(info.data[0],'base64'):null;
if(info?.owner!==loader.toBase58()||initial?.length!==binary.length+37||initial.readUInt32LE(0)!==1||initial[4]!==1
  ||!new PublicKey(initial.subarray(5,37)).equals(authority.publicKey))throw Error('Buffer identity differs');
const pending=[];for(let offset=0;offset<binary.length;offset+=900){const bytes=binary.subarray(offset,offset+900);
  if(!initial.subarray(37+offset,37+offset+bytes.length).equals(bytes))pending.push({offset,bytes});}
const journal={buffer:buffer.toBase58(),candidateSha256:attempt.binarySha256,pending:pending.length,writes:[]};
console.log(JSON.stringify({stage:'resume-missing-buffer-writes',chunks:pending.length}));
let latest,latestAt=0;
for(let index=0;index<pending.length;index+=batchSize){
  const started=Date.now(),group=pending.slice(index,index+batchSize);
  if(Date.now()-latestAt>15000){[latest]=await batch([['getLatestBlockhash',[{commitment:'confirmed'}]]],{readOnly:true});latest=latest.value;latestAt=Date.now();}
  const transactions=group.map(row=>{
    const data=Buffer.alloc(16+row.bytes.length);data.writeUInt32LE(1);data.writeUInt32LE(row.offset,4);data.writeBigUInt64LE(BigInt(row.bytes.length),8);row.bytes.copy(data,16);
    const tx=new Transaction({feePayer:authority.publicKey,recentBlockhash:latest.blockhash}).add(new TransactionInstruction({programId:loader,
      keys:[{pubkey:buffer,isSigner:false,isWritable:true},{pubkey:authority.publicKey,isSigner:true,isWritable:false}],data}));
    tx.sign(authority);const signature=bs58.encode(tx.signature);journal.writes.push({offset:row.offset,signature,status:'pending'});
    return {signature,serialized:tx.serialize().toString('base64')};
  });
  await writeFile('tmp/automation-release/buffer-writes.json',JSON.stringify(journal,null,2));
  const submitted=await batch(transactions.map(tx=>['sendTransaction',[tx.serialized,{encoding:'base64',skipPreflight:false,maxRetries:2,preflightCommitment:'confirmed'}]]));
  if(submitted.some((signature,i)=>signature!==transactions[i].signature))throw Error('Unexpected signature');
  let confirmed=false;
  for(let poll=0;poll<40;poll++){
    await pause(1000);const [statuses]=await batch([['getSignatureStatuses',[submitted]]],{readOnly:true});
    if(statuses.value.some(status=>status?.err))throw Error('Buffer write failed; inspect recorded signatures');
    if(statuses.value.every(status=>['confirmed','finalized'].includes(status?.confirmationStatus))){confirmed=true;break;}
  }
  if(!confirmed)throw Error('Buffer write outcome uncertain; re-read buffer before retrying');
  for(const row of journal.writes.slice(-group.length))row.status='confirmed';
  await writeFile('tmp/automation-release/buffer-writes.json',JSON.stringify(journal,null,2));
  console.log(JSON.stringify({stage:'buffer-write-progress',written:index+group.length,total:pending.length}));
  await pause(Math.max(0,intervalMs-(Date.now()-started)));
}
for(let poll=0;poll<30;poll++){
  await pause(2000);const [final]=await batch([['getAccountInfo',[buffer.toBase58(),{encoding:'base64',commitment:'finalized'}]]],{readOnly:true});
  if(final?.value&&Buffer.from(final.value.data[0],'base64').subarray(37).equals(binary)){
    journal.status='finalized-exact-buffer';await writeFile('tmp/automation-release/buffer-writes.json',JSON.stringify(journal,null,2));
    console.log(JSON.stringify({stage:journal.status,buffer:buffer.toBase58(),sha256:attempt.binarySha256}));process.exit(0);
  }
}
throw Error('Finalized buffer bytes do not yet match; no upgrade was submitted');
