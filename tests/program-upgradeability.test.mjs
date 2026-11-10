import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {PublicKey} from '@solana/web3.js';
import {inspectUpgradeability,auditProgramUpgradeability} from '../scripts/program-upgradeability.mjs';
import {SOLANA_GENESIS} from '../solana-network.js';
const loader=new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111');
const key=n=>new PublicKey(new Uint8Array(32).fill(n));
function fixture(){
  const program=key(1),authority=key(2),address=PublicKey.findProgramAddressSync([program.toBuffer()],loader)[0];
  const bytes=Buffer.alloc(49);bytes.writeUInt32LE(3);bytes[12]=1;authority.toBuffer().copy(bytes,13);
  const data=Buffer.alloc(36);data.writeUInt32LE(2);address.toBuffer().copy(data,4);
  const hash=createHash('sha256').update(bytes).digest('hex');
  return {program,address,expected:{programId:program.toBase58(),authority:authority.toBase58(),hash},
    proof:{account:{owner:loader,executable:true,data},programData:{owner:loader,executable:false,data:bytes},programDataAddress:address.toBase58(),sha256:hash}};
}
test('all app roles retain the expected upgrade authority; shared programs are read once',async()=>{
  const f=fixture();let reads=0;
  const c={getGenesisHash:async()=>SOLANA_GENESIS.devnet,getAccountInfo:async k=>{reads++;return k.equals(f.program)?f.proof.account:f.proof.programData;}};
  const report=await auditProgramUpgradeability(c,['router','escrow'].map(role=>({...f.expected,role})),{cluster:'devnet'});
  assert.equal(report.status,'verified');assert.equal(reads,2);assert.equal(report.programs.length,2);
});
test('immutable, changed-authority and malformed programs never pass upgradeability verification',()=>{
  for(const mutation of [f=>{f.proof.programData.data[12]=0;},f=>{key(3).toBuffer().copy(f.proof.programData.data,13);},
    f=>{f.proof.programData.data[12]=2;},f=>{f.proof.programData.owner=key(3);},
    f=>{f.proof.account.executable=false;},f=>{f.proof.programData.executable=true;},f=>{f.expected.authority=null;}]){
    const f=fixture();mutation(f);assert.equal(inspectUpgradeability(f.proof,f.expected).status,'blocked');
  }
});
test('a valid-looking noncanonical ProgramData pointer and forged digest are rejected',()=>{
  const f=fixture();key(9).toBuffer().copy(f.proof.account.data,4);f.proof.programDataAddress=key(9).toBase58();
  assert.equal(inspectUpgradeability(f.proof,f.expected).checks.canonicalProgramData,false);
  const other=fixture();other.proof.programData.data[48]=1;
  assert.equal(inspectUpgradeability(other.proof,other.expected).checks.approvedProgramBytes,false);
});
test('wrong network is rejected before program reads and an empty inventory cannot pass',async()=>{
  let reads=0;const c={getGenesisHash:async()=>SOLANA_GENESIS['mainnet-beta'],getAccountInfo:async()=>{reads++;}};
  await assert.rejects(()=>auditProgramUpgradeability(c,[fixture().expected],{cluster:'devnet'}));assert.equal(reads,0);
  await assert.rejects(()=>auditProgramUpgradeability({...c,getGenesisHash:async()=>SOLANA_GENESIS.devnet},[],{cluster:'devnet'}),/inventory/);
});
