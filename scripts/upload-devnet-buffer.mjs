// Loader-v3 Write layout: https://docs.rs/solana-loader-v3-interface/latest/src/solana_loader_v3_interface/instruction.rs.html
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import bs58 from 'bs58';
import nodeFetch from 'node-fetch';
import {Agent} from 'node:https';
import {Connection,Keypair,PublicKey,Transaction,TransactionInstruction} from '@solana/web3.js';
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const attempt=JSON.parse(await readFile('tmp/automation-release/upgrade-attempt.json','utf8'));
const binary=await readFile('contracts/funded-fee-router/target/automation-candidate/funded_fee_router.so');
if(createHash('sha256').update(binary).digest('hex')!==attempt.binarySha256)throw Error('Candidate hash differs');
const authority=Keypair.fromSecretKey(bs58.decode(process.env.FUNDED_ROUTER_AUTHORITY_SECRET_KEY||''));
if(authority.publicKey.toBase58()!=='7epA9KQ5wkwo5wZ5kcY8CfVUvpwVJoAMz2RNqt2ZwK5Y')throw Error('Dedicated Devnet signer differs');
const agent=new Agent({keepAlive:true,maxSockets:1,maxFreeSockets:1});
const c=new Connection(process.env.FUNDED_AUTOMATION_RPC_URL||'https://api.devnet.solana.com',{commitment:'confirmed',disableRetryOnRateLimit:true,
  fetch:(url,options)=>nodeFetch(url,{...options,agent})});
if(await c.getGenesisHash()!=='EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG')throw Error('Not Devnet');
const buffer=new PublicKey(attempt.buffer),loader=new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111');
const info=await c.getAccountInfo(buffer,'confirmed');
if(!info?.owner.equals(loader)||info.data.length!==binary.length+37||info.data.readUInt32LE(0)!==1||info.data[4]!==1
  ||!new PublicKey(info.data.subarray(5,37)).equals(authority.publicKey))throw Error('Buffer identity differs');
const pending=[];for(let offset=0;offset<binary.length;offset+=900){const bytes=binary.subarray(offset,offset+900);
  if(!info.data.subarray(37+offset,37+offset+bytes.length).equals(bytes))pending.push({offset,bytes});}
const journal={buffer:buffer.toBase58(),candidateSha256:attempt.binarySha256,pending:pending.length,writes:[]};
console.log(JSON.stringify({stage:'resume-missing-buffer-writes',chunks:pending.length}));
let latest,latestAt=0;
for(const [index,row] of pending.entries()){
  if(Date.now()-latestAt>15000){latest=await c.getLatestBlockhash('confirmed');latestAt=Date.now();}
  const data=Buffer.alloc(16+row.bytes.length);data.writeUInt32LE(1);data.writeUInt32LE(row.offset,4);data.writeBigUInt64LE(BigInt(row.bytes.length),8);row.bytes.copy(data,16);
  const tx=new Transaction({feePayer:authority.publicKey,recentBlockhash:latest.blockhash}).add(new TransactionInstruction({programId:loader,
    keys:[{pubkey:buffer,isSigner:false,isWritable:true},{pubkey:authority.publicKey,isSigner:true,isWritable:false}],data}));
  tx.sign(authority);const signature=bs58.encode(tx.signature);journal.writes.push({offset:row.offset,signature,status:'pending'});
  await writeFile('tmp/automation-release/buffer-writes.json',JSON.stringify(journal,null,2));
  const submitted=await c.sendRawTransaction(tx.serialize(),{skipPreflight:false,maxRetries:2});if(submitted!==signature)throw Error('Unexpected signature');
  let confirmed=false;
  for(let poll=0;poll<40;poll++){
    await pause(900);const status=(await c.getSignatureStatuses([signature])).value[0];
    if(status?.err)throw Error('Buffer write failed; inspect recorded signature');
    if(['confirmed','finalized'].includes(status?.confirmationStatus)){confirmed=true;break;}
  }
  if(!confirmed)throw Error('Buffer write outcome uncertain; re-read buffer before retrying');
  journal.writes.at(-1).status='confirmed';
  if(index%20===0||index===pending.length-1)console.log(JSON.stringify({stage:'buffer-write-progress',written:index+1,total:pending.length}));
  await pause(400);
}
for(let poll=0;poll<30;poll++){
  await pause(2000);const final=await c.getAccountInfo(buffer,'finalized');
  if(final?.data.subarray(37).equals(binary)){
    journal.status='finalized-exact-buffer';await writeFile('tmp/automation-release/buffer-writes.json',JSON.stringify(journal,null,2));
    console.log(JSON.stringify({stage:journal.status,buffer:buffer.toBase58(),sha256:attempt.binarySha256}));process.exit(0);
  }
}
throw Error('Finalized buffer bytes do not yet match; no upgrade was submitted');
