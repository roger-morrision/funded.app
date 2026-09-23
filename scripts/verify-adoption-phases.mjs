import assert from 'node:assert/strict';
import { Keypair,Transaction,SystemProgram } from '@solana/web3.js';
import bs58 from 'bs58';
import { readLaunchJournal, recordLaunchEvent, journalRecovery, policyMatchesJournal } from '../launch-journal.js';
import { executeLaunchPlan } from '../launch-executor.js';
import { imageDimensions,validateImageFile } from '../launch-image.js';
import { rewardView,renewClaimChallenge } from '../reward-discovery.js';
import { creatorCardPng } from '../server/share-card.mjs';
import { inflateSync } from 'node:zlib';
import { createReadCache } from '../server/read-cache.mjs';

const data=new Map(),storage={getItem:key=>data.get(key),setItem:(key,value)=>data.set(key,value)};
const cache=createReadCache();let loads=0;const shared=await Promise.all(Array.from({length:40},()=>cache('same',async()=>{loads++;return 'value';})));assert.equal(loads,1);assert.ok(shared.every(value=>value==='value'));
await assert.rejects(cache('error',()=>{throw new Error('fixture');}));assert.equal(await cache('error',()=>42),42);
recordLaunchEvent('one',{state:'prepared',name:'Fixture',secretKey:'NEVER',signedBytes:'NEVER'},storage);
recordLaunchEvent('one',{state:'unknown',signature:'test'},storage);
assert.equal(readLaunchJournal(storage).length,1);assert.doesNotMatch([...data.values()].join(''),/NEVER|secretKey|signedBytes/);
assert.match(journalRecovery(readLaunchJournal(storage)[0]),/uncertain/);
const damaged={getItem:()=>JSON.stringify([{id:'damaged',state:'confirmed',events:{bad:true},secretKey:'NEVER'}])};
const recovered=readLaunchJournal(damaged)[0];assert.equal(recovered.state,'unknown');assert.deepEqual(recovered.events,[]);assert.equal(recovered.secretKey,undefined);
assert.throws(()=>recordLaunchEvent('one',{state:'paid'},storage));
assert.throws(()=>recordLaunchEvent('one',{state:'prepared'},{getItem:()=>null,setItem:()=>{throw new Error('full');}}),/recovery could not be saved/);
const row={mint:'mint',payer:'payer',cluster:'devnet',signature:'sig'};
assert.equal(policyMatchesJournal({mint:'mint',creatorWallet:'payer',cluster:'devnet',pumpFeeRoute:{transaction:'sig'}},row),true);
assert.equal(policyMatchesJournal({mint:'other',creatorWallet:'payer',cluster:'devnet',signature:'sig'},row),false);
assert.deepEqual(imageDimensions(2000,1000),{width:1024,height:512});assert.deepEqual(imageDimensions(2000,1000,true),{width:512,height:512});
assert.throws(()=>imageDimensions(9000,9000),/megapixels/);assert.throws(()=>validateImageFile({type:'image/svg+xml',size:100}),/PNG/);assert.throws(()=>validateImageFile({type:'image/png',size:13000000}),/12 MB/);
const obligation={id:'claim',mint:'mint',amountLamports:'100',amountSol:.0000001},claim={status:'paid',payoutSignature:'sig',publicKey:'wallet'};
assert.equal(rewardView(obligation,claim).group,'Pending verification');assert.equal(rewardView(obligation,null).group,'Available to prepare');
assert.equal(rewardView(obligation,claim,[{claimId:'claim',signature:'sig',to:'wallet',amountLamports:100,source:'mint-router-settle-mint'}]).group,'Paid');
assert.equal(rewardView(obligation,claim,[{claimId:'claim',signature:'sig',to:'wrong',amountLamports:100,source:'mint-router-settle-mint'}]).receiptVerified,false);
const expired={expiresAt:'2020-01-01T00:00:00Z',nonce:'old',status:'wallet-verified',publicKey:'bound',xUserId:'123',obligationId:'original'};
const renewed=renewClaimChallenge(expired,'new');assert.equal(renewed.nonce,'new');assert.equal(renewed.publicKey,'bound');assert.equal(renewed.obligationId,'original');
assert.equal(renewClaimChallenge({...expired,status:'executing'},'new').nonce,'old');
const png=creatorCardPng('@fixture','devnet');assert.equal(png.subarray(0,8).toString('hex'),'89504e470d0a1a0a');assert.equal(png.readUInt32BE(16),1200);assert.equal(png.readUInt32BE(20),630);
const idat=png.indexOf(Buffer.from('IDAT'));assert.equal(inflateSync(png.subarray(idat+4,idat+4+png.readUInt32BE(idat-4))).length,(1200*3+1)*630);

// In-memory ephemeral signers only; RPC is mocked and no transaction is broadcast.
async function execute(mode){
  const payer=Keypair.generate(),mint=Keypair.generate(),events=[],hashes=[];let sends=0,approvals=0;
  const steps=['initialize-mint-router','launch'].map(kind=>({kind,transaction:new Transaction().add(SystemProgram.createAccount({fromPubkey:payer.publicKey,newAccountPubkey:mint.publicKey,lamports:1,space:0,programId:SystemProgram.programId}))}));
  const connection={getLatestBlockhash:async()=>{const blockhash=Keypair.generate().publicKey.toBase58();hashes.push(blockhash);return {blockhash,lastValidBlockHeight:100};},sendRawTransaction:async raw=>{sends++;if(mode==='timeout')throw new Error('RPC timeout');return bs58.encode(Transaction.from(raw).signature);},confirmTransaction:async()=>({value:{err:mode==='chain-error'?{InstructionError:[0,'fixture']}:null}})};
  const provider={signTransaction:async tx=>{approvals++;if(mode==='reject'||mode==='second-reject'&&approvals===2)throw new Error('User rejected');tx.partialSign(payer);return tx;}};
  try {await executeLaunchPlan({connection,provider,payer:payer.publicKey,mint,plan:{steps},onEvent:event=>{events.push(event);if(mode==='journal-fail'&&event.state==='broadcasting')throw new Error('storage unavailable');}});assert.equal(mode,'success');}
  catch(error){assert.notEqual(mode,'success',error.message);}
  if(mode==='success'){assert.equal(sends,2);assert.equal(new Set(hashes).size,2);assert.equal(events.filter(e=>e.state==='confirmed').length,2);}
  if(mode==='timeout'){assert.equal(sends,1);assert.equal(events.at(-1).state,'unknown');assert.ok(events.find(e=>e.state==='broadcasting').signature);}
  if(mode==='reject'||mode==='journal-fail')assert.equal(sends,0);
  if(mode==='second-reject'){assert.equal(sends,1);assert.equal(events.at(-1).state,'cancelled');assert.ok(events.find(e=>e.state==='confirmed'));}
  if(mode==='chain-error'){assert.equal(sends,1);assert.equal(events.at(-1).state,'failed');}
}
for(const mode of ['success','timeout','reject','second-reject','chain-error','journal-fail'])await execute(mode);
console.log('Adoption phases: journal privacy/recovery, fresh-blockhash execution, rejection/timeout/partial success, image constraints, reward evidence/renewal and PNG structure passed (local-only/mocked).');
