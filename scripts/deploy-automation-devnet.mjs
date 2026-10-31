import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import bs58 from 'bs58';
import {Connection,Keypair,PublicKey} from '@solana/web3.js';
import {readProgramDataEvidence} from '../server/automatic-reward-chain.mjs';
const programId=new PublicKey('9H1r2nTZs6gQaheYTMaBWpH12JX6dCFj2Rvxg7Lno2Sm');
const binaryPath=resolve(process.argv[2]||'contracts/funded-fee-router/target/automation-candidate/funded_fee_router.so');
const binary=await readFile(binaryPath),hash=createHash('sha256').update(binary).digest('hex');
const authority=Keypair.fromSecretKey(bs58.decode(process.env.FUNDED_ROUTER_AUTHORITY_SECRET_KEY||''));
if(authority.publicKey.toBase58()!=='7epA9KQ5wkwo5wZ5kcY8CfVUvpwVJoAMz2RNqt2ZwK5Y')throw Error('Dedicated Devnet signer differs');
const rpc=process.env.FUNDED_AUTOMATION_RPC_URL||'https://api.devnet.solana.com';
if(new URL(rpc).protocol!=='https:')throw Error('An HTTPS Devnet RPC is required');
const connection=new Connection(rpc,{commitment:'finalized',disableRetryOnRateLimit:true});
if(await connection.getGenesisHash()!=='EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG')throw Error('Not Devnet');
const prior=await readProgramDataEvidence(connection,programId);
if(!new PublicKey(prior.programData.data.subarray(13,45)).equals(authority.publicKey))throw Error('Upgrade authority differs');
const folder=resolve('tmp/automation-release');await mkdir(folder,{recursive:true});
const resumeBuffer=process.argv.find(value=>value.startsWith('--resume-buffer='))?.slice(16);
let skipBufferWrite=false;
if(resumeBuffer){
  const info=await connection.getAccountInfo(new PublicKey(resumeBuffer),'finalized');
  if(!info||info.data.readUInt32LE(0)!==1||info.data[4]!==1
    ||!new PublicKey(info.data.subarray(5,37)).equals(authority.publicKey))throw Error('Resume buffer authority differs');
  skipBufferWrite=info.data.subarray(37).equals(binary);
}else await writeFile(resolve(folder,'prior-programdata.bin'),prior.programData.data);
const buffer=Keypair.generate();
await writeFile(resolve(folder,'upgrade-attempt.json'),JSON.stringify({program:programId.toBase58(),binarySha256:hash,
  priorProgramDataSha256:prior.sha256,buffer:resumeBuffer||buffer.publicKey.toBase58(),startedAt:new Date().toISOString()},null,2));
if(process.argv.includes('--preflight')){console.log(JSON.stringify({status:'preflight',binarySha256:hash,binaryBytes:binary.length,priorProgramDataSha256:prior.sha256}));process.exit(0);}
const linux=path=>'/mnt/'+path[0].toLowerCase()+path.slice(2).replaceAll('\\','/');
const result=spawnSync('wsl',['--exec','python3',linux(resolve('scripts/deploy-automation-devnet.py')),linux(binaryPath),hash],
  {input:JSON.stringify({authority:[...authority.secretKey],buffer:[...buffer.secretKey],resumeBuffer,skipBufferWrite,rpc}),encoding:'utf8',timeout:1800000,maxBuffer:1024*1024});
if(result.status!==0){
  const reason=(result.stderr||'').split('\n').findLast(line=>line.startsWith('RuntimeError:'))||'No CLI summary';
  throw Error(`Devnet upgrade did not confirm (${result.error?.code||result.status}): ${reason}; reconcile the recorded buffer before retrying.`);
}
const final=await readProgramDataEvidence(connection,programId);
if(!final.programData.data.subarray(45,45+binary.length).equals(binary)
  ||final.programData.data.subarray(45+binary.length).some(byte=>byte!==0))throw Error('Finalized deployed bytes differ from candidate');
const evidence={status:'finalized-exact-binary',program:programId.toBase58(),binarySha256:hash,programDataSha256:final.sha256,
  cli:JSON.parse(result.stdout.trim()),at:new Date().toISOString()};
await writeFile(resolve(folder,'deployed-program.json'),JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence));
