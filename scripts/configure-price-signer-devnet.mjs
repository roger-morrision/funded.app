// One explicit upgrade-owner + incoming-signer configuration transaction.
// Never rotates an already configured, different signer automatically.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import bs58 from 'bs58';
import {Connection,Keypair,PublicKey,SystemProgram,TransactionInstruction,TransactionMessage,VersionedTransaction} from '@solana/web3.js';
import {priceConfigAddress,priceSignerActivated} from '../server/buyback-price-signer.mjs';
import {verifiedProgram,PRICE_SIGNER_GENESIS} from '../server/price-signer-review.mjs';

const required=name=>{const value=process.env[name];assert(value,`${name} is required.`);return value;};
const secret=name=>{
  try{const value=readFileSync(required(name),'utf8').trim();return Keypair.fromSecretKey(value.startsWith('[')?Uint8Array.from(JSON.parse(value)):bs58.decode(value));}
  catch{throw Error(`Invalid signer file for ${name}.`);}
};
const config=JSON.parse(readFileSync(required('PRICE_SIGNER_CONFIG_FILE'),'utf8'));
assert(config.cluster==='devnet'&&config.programs?.length===1,'Configure one explicitly reviewed Devnet program.');
const approved=config.programs[0],program=new PublicKey(approved.programId);
const connection=new Connection(readFileSync(required('PRICE_SIGNER_RPC_FILE'),'utf8').trim(),{commitment:'finalized',disableRetryOnRateLimit:true});
assert.equal(await connection.getGenesisHash(),PRICE_SIGNER_GENESIS);
await verifiedProgram(connection,approved);
const owner=secret('PRICE_SIGNER_UPGRADE_KEY_FILE'),signer=secret('PRICE_SIGNER_KEY_FILE');
assert.equal(String(owner.publicKey),approved.upgradeAuthority);assert(!owner.publicKey.equals(signer.publicKey));
const output=required('PRICE_SIGNER_ACTIVATION_EVIDENCE');
const address=priceConfigAddress(program),existing=await connection.getAccountInfo(address,'finalized');
if(existing){assert(await priceSignerActivated(connection,program,signer.publicKey),'A different signer already exists; explicit rotation review required.');
  console.log(JSON.stringify({status:'already-configured',signer:String(signer.publicKey),address:String(address)}));
}else{
  assert(!existsSync(output),'Reconcile prior activation evidence before another transaction.');
  const loader=new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111');
  const programData=PublicKey.findProgramAddressSync([program.toBuffer()],loader)[0];
  const meta=(pubkey,isSigner=false,isWritable=false)=>({pubkey,isSigner,isWritable});
  const instruction=new TransactionInstruction({programId:program,
    data:createHash('sha256').update('global:configure_buyback_price_signer').digest().subarray(0,8),
    keys:[meta(owner.publicKey,true,true),meta(signer.publicKey,true),meta(program),meta(programData),meta(address,false,true),meta(SystemProgram.programId)]});
  const block=await connection.getLatestBlockhash('finalized');
  const tx=new VersionedTransaction(new TransactionMessage({payerKey:owner.publicKey,recentBlockhash:block.blockhash,instructions:[instruction]}).compileToV0Message());
  const fee=await connection.getFeeForMessage(tx.message,'finalized'),rent=await connection.getMinimumBalanceForRentExemption(40,'finalized');
  assert(Number.isSafeInteger(fee.value)&&fee.value<=20000&&rent<=2000000);
  assert((await connection.getBalance(owner.publicKey,'finalized'))-rent-fee.value>=3000000000,'Preserve 3 SOL reserve.');
  tx.sign([owner,signer]);
  const simulation=await connection.simulateTransaction(tx,{sigVerify:true,commitment:'finalized'});assert.equal(simulation.value.err,null,'Signer setup simulation failed.');
  const signature=bs58.encode(tx.signatures[0]);
  const evidence={cluster:'devnet',program:approved.programId,signer:String(signer.publicKey),address:String(address),signature,...block,status:'submitting'};
  writeFileSync(output,JSON.stringify(evidence,null,2)+'\n');
  try{assert.equal(await connection.sendRawTransaction(tx.serialize(),{skipPreflight:false,maxRetries:2}),signature);}catch{console.log('Reconciling recorded signer activation signature.');}
  for(let attempt=0;attempt<90;attempt++){
    const row=(await connection.getSignatureStatuses([signature],{searchTransactionHistory:true})).value[0];assert(!row?.err,'Activation transaction failed.');
    if(row?.confirmationStatus==='finalized'){
      assert(await priceSignerActivated(connection,program,signer.publicKey));
      Object.assign(evidence,{status:'finalized',slot:row.slot,verifiedAt:new Date().toISOString()});writeFileSync(output,JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify(evidence));break;
    }
    assert(attempt<89,'Activation outcome unknown; reconcile recorded signature.');await new Promise(r=>setTimeout(r,1000));
  }
}
