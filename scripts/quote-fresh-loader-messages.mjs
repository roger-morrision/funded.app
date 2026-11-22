// Construct unsigned fresh Loader-v3 messages from a frozen ELF and public quote.
// This module does not load signers, sign transactions or transmit messages.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile, mkdir, writeFile} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {Connection, PublicKey, SystemProgram, TransactionInstruction, TransactionMessage,
  SYSVAR_RENT_PUBKEY, SYSVAR_CLOCK_PUBKEY} from '@solana/web3.js';
import {assertRpcNetwork} from '../solana-network.js';

const plan = JSON.parse(await readFile('docs/evidence/production-contract-handoff-2026-11-22.json','utf8'));
const release = plan.productionArtifact;
const quote = plan.productionQuote;
const {keys} = plan.productionInit;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const elf = await readFile(release.file);
assert.equal(sha(elf), release.sha256);
assert.equal(elf.length, release.bytes);
assert.equal(quote.elfSha256, release.sha256);
const payer = new PublicKey(keys.deploymentPayer);
const admin = new PublicKey(keys.adminUpgrade);
const program = new PublicKey(keys.program);
const loader = new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111');
const seed = release.sha256.slice(0,32);
const buffer = await PublicKey.createWithSeed(payer,seed,loader);
const [programData] = PublicKey.findProgramAddressSync([program.toBuffer()],loader);
assert.equal(programData.toBase58(),keys.programData);
const rpc = new Connection('https://api.mainnet-beta.solana.com',{commitment:'finalized',disableRetryOnRateLimit:true});
await assertRpcNetwork(rpc,'mainnet-beta');
const addresses = [buffer,program,programData];
const snapshot = await rpc.getMultipleAccountsInfoAndContext(addresses,'finalized');
assert(snapshot.value.every(a=>a===null),'Target accounts must be absent for a fresh deployment quote.');
const rents = await Promise.all([36,37+elf.length,45+elf.length].map(n=>rpc.getMinimumBalanceForRentExemption(n)));
assert.deepEqual(rents,[quote.programRentLamports,quote.temporaryReusableBufferRentLamports,quote.programDataRentLamports]);
const {context,value:validity} = await rpc.getLatestBlockhashAndContext('finalized');
const meta = (pubkey,isSigner=false,isWritable=false)=>({pubkey,isSigner,isWritable});
const loaderIx = (data,accounts)=>new TransactionInstruction({programId:loader,keys:accounts,data});
const stages = [];
const feeExamples = new Map();
function record(stage,instructions,intent) {
  const message = new TransactionMessage({payerKey:payer,recentBlockhash:validity.blockhash,instructions}).compileToLegacyMessage();
  const bytes = message.serialize();
  const signatures = message.header.numRequiredSignatures;
  const wireLength = 1+64*signatures+bytes.length;
  assert(wireLength<=1232,'Transaction does not fit the Solana packet limit.');
  // Each class has the same signatures and instruction family. The plan uses zero priority bid.
  const feeClass = stage==='write'&&intent.byteLength!==900?'write-remainder':stage;
  if(!feeExamples.has(feeClass)) feeExamples.set(feeClass,message);
  stages.push({index:stages.length,stage,feeClass,intent,signers:message.accountKeys.slice(0,signatures).map(String),
    sha256:sha(bytes),wireLength,unsignedMessageBase64:Buffer.from(bytes).toString('base64')});
}

record('create-buffer',[
  SystemProgram.createAccountWithSeed({fromPubkey:payer,newAccountPubkey:buffer,basePubkey:payer,seed,
    lamports:rents[1],space:37+elf.length,programId:loader}),
  loaderIx(Buffer.alloc(4),[meta(buffer,false,true),meta(admin)])
],{buffer:String(buffer),base:String(payer),seed,owner:String(loader),authority:String(admin),
  rent:rents[1],space:37+elf.length,verify:'Finalized buffer state 1, assigned authority, zero upload bytes.'});
for(let offset=0;offset<elf.length;offset+=900) {
  const chunk=elf.subarray(offset,offset+900);
  const header=Buffer.alloc(16);
  header.writeUInt32LE(1,0);
  header.writeUInt32LE(offset,4);
  header.writeBigUInt64LE(BigInt(chunk.length),8);
  record('write',[loaderIx(Buffer.concat([header,chunk]),[meta(buffer,false,true),meta(admin,true)])],
    {offset,byteLength:chunk.length,sha256:sha(chunk)});
}
const deploy=Buffer.alloc(12);
deploy.writeUInt32LE(2);
deploy.writeBigUInt64LE(BigInt(elf.length),4);
record('deploy',[
  SystemProgram.createAccount({fromPubkey:payer,newAccountPubkey:program,lamports:rents[0],space:36,programId:loader}),
  loaderIx(deploy,[meta(payer,true,true),meta(programData,false,true),meta(program,false,true),meta(buffer,false,true),
    meta(SYSVAR_RENT_PUBKEY),meta(SYSVAR_CLOCK_PUBKEY),meta(SystemProgram.programId),meta(admin,true)])
],{program:String(program),programData:String(programData),admin:String(admin),allocation:elf.length,
  rentProgram:rents[0],rentProgramData:rents[2],bufferRefundFirst:rents[1],
  precondition:'Fresh target accounts, finalized buffer owner, authority, length and full ELF hash verified.',
  verify:'Finalized native loader pointer, executable flag, deployment slot, upgrade authority, full ProgramData and ELF hash.'});
const fees={};
for(const [family,message] of feeExamples){
  const sample=await rpc.getFeeForMessage(message,'finalized');
  assert(Number.isSafeInteger(sample.value)&&sample.value>0,'Fee unavailable for this blockhash.');
  fees[family]={sampleLamports:sample.value,slot:sample.context.slot,count:stages.filter(s=>s.feeClass===family).length};
}
const feeSum = Object.values(fees).reduce((sum,f)=>sum+f.sampleLamports*f.count,0);
const manifest={format:1,scope:'unsigned deployment prefix only',cluster:'mainnet-beta',genesis:quote.genesisHash,
  quotedAt:new Date().toISOString(),targetAccountSlot:snapshot.context.slot,feeBlockhashSlot:context.slot,validity,
  source:release.source,elfSha256:release.sha256,bytes:elf.length,loader:String(loader),payer:String(payer),
  admin:String(admin),buffer:String(buffer),program:String(program),programData:String(programData),feeClasses:fees,
  zeroPriorityFeeProjectionLamports:feeSum,stages,
  reconcile:'Re-read finalized buffer slices and transaction status before retry. Re-sign refreshed immutable messages after expiry. Stop on byte, signer, authority, cost or state mismatch.'};
const body=JSON.stringify(manifest)+'\n';
const file=resolve('tmp/production-contract-freeze',release.sha256,'unsigned-loader-'+validity.blockhash+'.json');
await mkdir(dirname(file),{recursive:true});
await writeFile(file,body);
console.log(JSON.stringify({file,sha256:sha(body),messages:stages.length,buffer:manifest.buffer,blockhash:validity.blockhash,
  lastValidBlockHeight:validity.lastValidBlockHeight,slot:context.slot,quotedAt:manifest.quotedAt,fees,feeSum,largestWire:Math.max(...stages.map(s=>s.wireLength))}));
