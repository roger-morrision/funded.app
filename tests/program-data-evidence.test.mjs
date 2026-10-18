import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {Keypair,PublicKey} from '@solana/web3.js';
import {readProgramDataEvidence} from '../server/program-data-evidence.mjs';
import {GENESIS_HASHES} from '../server/service-status.mjs';

const loader=new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111');
function fixture() {
  const program=Keypair.generate().publicKey,address=Keypair.generate().publicKey;
  const header=Buffer.alloc(36);header.writeUInt32LE(2);address.toBuffer().copy(header,4);
  const data=Buffer.alloc(73,19);data.writeUInt32LE(3);let reads=0;
  const account={owner:loader,executable:true,data:header},programData={owner:loader,executable:false,data};
  const connection={getGenesisHash:async()=>GENESIS_HASHES.devnet,getAccountInfo:async(key,commitment)=>{
    reads++;assert.equal(commitment,'finalized');return key.equals(program)?account:programData;
  }};
  return {program,address,account,programData,connection,reads:()=>reads};
}
test('default program evidence uses the existing provider and hashes complete ProgramData bytes',async()=>{
  const f=fixture(),result=await readProgramDataEvidence(f.connection,f.program,{rpcUrl:''});
  assert.equal(result.sha256,createHash('sha256').update(f.programData.data).digest('hex'));
  assert.equal(result.programDataAddress,f.address.toBase58());assert.equal(f.reads(),2);
});
test('alternate evidence RPC agrees on Devnet while the primary serves no large accounts',async()=>{
  const f=fixture();let primaryGenesis=0,signal;
  const result=await readProgramDataEvidence({getGenesisHash:async()=>{primaryGenesis++;return GENESIS_HASHES.devnet;},getAccountInfo:()=>assert.fail('Primary large read must not run')},f.program,{
    rpcUrl:'https://api.devnet.solana.com',connectionFactory:(url,s)=>{assert.equal(url,'https://api.devnet.solana.com');signal=s;return f.connection;},
  });
  assert.equal(primaryGenesis,1);assert.equal(result.sha256,createHash('sha256').update(f.programData.data).digest('hex'));assert.equal(signal.aborted,true);
});
for(const wrong of ['primary','alternate','both'])test(`alternate provider rejects ${wrong} network mismatch before reading accounts`,async()=>{
  const f=fixture(),primary={getGenesisHash:async()=>wrong==='alternate'?GENESIS_HASHES.devnet:GENESIS_HASHES['mainnet-beta']};
  f.connection.getGenesisHash=async()=>wrong==='primary'?GENESIS_HASHES.devnet:GENESIS_HASHES['mainnet-beta'];
  await assert.rejects(readProgramDataEvidence(primary,f.program,{rpcUrl:'https://api.devnet.solana.com',connectionFactory:()=>f.connection}),/match.*Devnet/);assert.equal(f.reads(),0);
});
test('a timed-out alternate read aborts and a fresh invocation can recover',async()=>{
  const f=fixture();let signal;
  await assert.rejects(readProgramDataEvidence(f.connection,f.program,{rpcUrl:'https://api.devnet.solana.com',timeoutMs:20,
    connectionFactory:(_url,s)=>{signal=s;return {...f.connection,getAccountInfo:()=>new Promise(()=>{})};},
  }),/timed out/);assert.equal(signal.aborted,true);
  assert((await readProgramDataEvidence(f.connection,f.program,{rpcUrl:'https://api.devnet.solana.com',connectionFactory:()=>f.connection})).sha256);
});
for(const malformed of ['owner','executable','header','length'])test(`upgradeable ProgramData rejects invalid ${malformed}`,async()=>{
  const f=fixture();if(malformed==='owner')f.programData.owner=Keypair.generate().publicKey;
  if(malformed==='executable')f.programData.executable=true;
  if(malformed==='header')f.programData.data.writeUInt32LE(2);
  if(malformed==='length')f.programData.data=Buffer.alloc(44);
  await assert.rejects(readProgramDataEvidence(f.connection,f.program,{rpcUrl:''}),/Invalid.*ProgramData/);
});
test('missing or non-executable program accounts provide no affirmative hash',async()=>{
  const f=fixture();f.account.executable=false;assert.equal((await readProgramDataEvidence(f.connection,f.program,{rpcUrl:''})).sha256,null);
});
test('alternate RPC configuration rejects cleartext and URL credentials before connection',async()=>{
  const f=fixture();for(const rpcUrl of ['http://api.devnet.solana.com','https://name:password@api.devnet.solana.com'])
    await assert.rejects(readProgramDataEvidence(f.connection,f.program,{rpcUrl,connectionFactory:()=>assert.fail('Invalid configuration')}),/Invalid.*configuration/);
});
