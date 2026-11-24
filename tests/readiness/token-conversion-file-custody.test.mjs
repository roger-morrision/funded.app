import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,chmod,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {Keypair,TransactionMessage,TransactionInstruction,VersionedTransaction,AddressLookupTableAccount} from '@solana/web3.js';
import nacl from 'tweetnacl';
import {createFileTokenConversionCustody} from '../../server/token-conversion-file-custody.mjs';

// Synthetic wire shape only. Full policy/financial review is exercised by the
// separate bootstrap integration using the retained public compiled fixture.
function messageFixture(){
  const key=n=>Keypair.fromSeed(new Uint8Array(32).fill(n)).publicKey;
  const operator=key(33),price=key(34),program=key(90),addresses=Array.from({length:39},(_,i)=>key(50+i));
  const table=new AddressLookupTableAccount({key:key(91),state:{deactivationSlot:0xffffffffffffffffn,lastExtendedSlot:0,lastExtendedSlotStartIndex:0,addresses}});
  const data=Buffer.alloc(57,1);Buffer.from('647795a88d096dab','hex').copy(data);data[40]=5;data.writeBigUInt64LE(1n,41);data.writeBigUInt64LE(1n,49);
  const ix=new TransactionInstruction({programId:program,data,keys:[operator,price,...addresses].map((pubkey,i)=>({pubkey,isSigner:i<2,isWritable:i===0}))});
  const unsigned=new VersionedTransaction(new TransactionMessage({payerKey:operator,recentBlockhash:String(key(92)),instructions:[ix]}).compileToV0Message([table]));
  return {config:{programId:String(program)},unsigned,request:{transaction:Buffer.from(unsigned.serialize()).toString('base64')}};
}

async function fixture(t,role='operator'){
  const dir=await mkdtemp(join(tmpdir(),'funded-file-custody-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const key=Keypair.fromSeed(new Uint8Array(32).fill(role==='operator'?33:34)),file=join(dir,'role.json'),f=messageFixture();
  await writeFile(file,JSON.stringify(Array.from(key.secretKey)),{mode:0o400});
  const config={role,reference:'custody-'+role,publicKey:String(key.publicKey),programId:f.config.programId,keyFile:file};
  const resolver=createFileTokenConversionCustody(config);t.after(()=>resolver.close());
  const expected={role,publicKey:config.publicKey},message=Buffer.from(f.unsigned.message.serialize());
  const args={role,version:0,message,messageHash:createHash('sha256').update(message).digest('hex'),transactionBase64:f.request.transaction,intentDigest:'a'.repeat(64),signal:new AbortController().signal};
  return {dir,file,key,f,config,resolver,expected,args,load:()=>resolver(config.reference,expected)};
}
for(const role of ['operator','price-attestation'])test('private '+role+' file signs only its exact serialized conversion message',async t=>{
  const f=await fixture(t,role),signer=await f.load(),signature=await signer.signMessage(f.args);
  assert(nacl.sign.detached.verify(f.args.message,signature,f.key.publicKey.toBytes()));
  assert.equal(await f.load(),signer);await f.resolver.close();await assert.rejects(signer.signMessage(f.args));await assert.rejects(f.load());
});
test('wrong reference role or public identity fails without reading the key',async t=>{
  const f=await fixture(t);await rm(f.file);
  for(const [ref,expected]of [['other',f.expected],[f.config.reference,{...f.expected,role:'price-attestation'}],[f.config.reference,{...f.expected,publicKey:String(Keypair.generate().publicKey)}]])
    await assert.rejects(f.resolver(ref,expected),/reference or role differs/);
});
test('failed custody resolution stays failed after file replacement',async t=>{
  const f=await fixture(t);await chmod(f.file,0o644);await assert.rejects(f.load(),/unavailable/);
  await chmod(f.file,0o400);await assert.rejects(f.load(),/unavailable/);
});
test('symlinked and wrong-identity private files are refused',async t=>{
  const f=await fixture(t),link=join(f.dir,'link.json');await symlink(f.file,link);
  const linked=createFileTokenConversionCustody({...f.config,keyFile:link});t.after(()=>linked.close());await assert.rejects(linked(f.config.reference,f.expected),/unavailable/);
  await chmod(f.file,0o600);await writeFile(f.file,JSON.stringify(Array.from(Keypair.generate().secretKey)));await chmod(f.file,0o400);
  await assert.rejects(f.load(),/unavailable/);
});
test('aborted changed signed or malformed requests cannot reach file custody signing',async t=>{
  const f=await fixture(t),signer=await f.load(),controller=new AbortController();controller.abort();
  const signed=Buffer.from(f.args.transactionBase64,'base64');signed[1]=1;
  for(const patch of [{role:'price-attestation'},{version:1},{signal:controller.signal},{intentDigest:''},{messageHash:'0'.repeat(64)},
    {message:Buffer.from('not a Solana transaction')},{transactionBase64:signed.toString('base64')},{transactionBase64:'not-base64'}])
    await assert.rejects(signer.signMessage({...f.args,...patch}),/refused/);
});
