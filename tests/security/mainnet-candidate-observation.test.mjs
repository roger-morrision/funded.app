import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {PublicKey} from '@solana/web3.js';
import {observeMainnetCandidate,observeDeploymentFunding} from '../../scripts/mainnet-candidate-observation.mjs';
const read=file=>JSON.parse(readFileSync(file,'utf8'));
const plan=read('config/mainnet-deployment-plan.json');
function fixture(){
  const binary=Buffer.from('7f454c4601020304','hex'),candidate={...read('config/mainnet-review-candidate.json'),
    binary:{bytes:binary.length,sha256:createHash('sha256').update(binary).digest('hex')}};
  const loader=new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111'),program=new PublicKey(candidate.programId);
  const address=PublicKey.findProgramAddressSync([program.toBuffer()],loader)[0];
  const pointer=Buffer.alloc(36);pointer.writeUInt32LE(2);address.toBuffer().copy(pointer,4);
  const bytes=Buffer.alloc(45+binary.length+16);bytes.writeUInt32LE(3);bytes.writeBigUInt64LE(90n,4);bytes[12]=1;
  new PublicKey(plan.upgradeAuthority).toBuffer().copy(bytes,13);binary.copy(bytes,45);
  const account={executable:true,owner:loader,data:pointer},data={executable:false,owner:loader,data:bytes};
  const result={context:{slot:100},value:[account,data]},calls={reads:0};
  const connection={getGenesisHash:async()=>plan.genesisHash,getSlot:async()=>100,
    getMultipleAccountsInfoAndContext:async(keys,options)=>{calls.reads++;assert.deepEqual(keys.map(String),[String(program),String(address)]);
      assert.deepEqual(options,{commitment:'finalized',minContextSlot:100});return result;},
    getBalanceAndContext:async()=>({context:{slot:100},value:0}),getMinimumBalanceForRentExemption:async bytes=>bytes*100};
  return {candidate,binary,plan,connection,result,account,data,calls};
}
const observe=(a,b)=>observeMainnetCandidate({...a,connections:[a.connection,b.connection]});

test('candidate observation discovers exact finalized ProgramData without granting release admission',async()=>{
  const a=fixture(),b=fixture(),report=await observe(a,b);
  assert.equal(report.status,'verified-candidate');assert.equal(report.mainnetActivationAuthorized,false);
  assert.equal(report.transactionsSigned,0);assert.equal(report.transactionsSubmitted,0);
  assert.equal(report.observations[0].programDataSha256,createHash('sha256').update(a.data.data).digest('hex'));
  assert.notEqual(report.observations[0].programDataSha256,a.candidate.binary.sha256);
});

test('candidate observation rejects stale banks, altered ELF, authority, padding and RPC disagreement',async()=>{
  for(const mutate of [f=>{f.result.context.slot=99;},f=>{f.account.executable=false;},
    f=>{f.account.data[4]^=1;},f=>{f.data.owner=new PublicKey(plan.upgradeAuthority);},
    f=>{f.data.data[12]=0;},f=>{f.data.data[13]^=1;},f=>{f.data.data[45]^=1;},
    f=>{f.data.data[f.data.data.length-1]=1;},f=>{f.data.data.writeBigUInt64LE(100n,4);},
    f=>{f.result.value[0]=null;}]){
    const a=fixture(),b=fixture();mutate(b);assert.equal((await observe(a,b)).status,'blocked');
  }
  const a=fixture(),b=fixture();b.data.data.writeBigUInt64LE(91n,4);
  assert.equal((await observe(a,b)).status,'blocked'); // individually valid, different deployed bank hashes
});

test('candidate observation distinguishes absent deployment and refuses wrong chain or unselected bytes',async()=>{
  const a=fixture(),b=fixture();a.result.value=[null,null];b.result.value=[null,null];
  assert.equal((await observe(a,b)).status,'not-deployed');
  b.connection.getGenesisHash=async()=> 'devnet';
  assert.equal((await observe(a,b)).status,'blocked');assert.equal(b.calls.reads,1);
  a.binary[4]^=1;const before=a.calls.reads;
  await assert.rejects(observe(a,b));assert.equal(a.calls.reads,before);
});

test('deployment funding reports exact zero balance and refuses malformed or wrong-chain observations',async()=>{
  const f=fixture(),report=await observeDeploymentFunding(f);
  assert.equal(report.balanceLamports,'0');assert.equal(report.lockedRentLamports,String((36+45+f.binary.length)*100));
  assert.equal(report.rentOnlyShortfallLamports,report.lockedRentLamports);
  f.connection.getBalanceAndContext=async()=>({context:{slot:100},value:NaN});
  assert.equal((await observeDeploymentFunding(f)).status,'unavailable');
  f.connection.getGenesisHash=async()=> 'devnet';
  assert.equal((await observeDeploymentFunding(f)).status,'unavailable');
});
