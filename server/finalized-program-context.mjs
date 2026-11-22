import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {PublicKey} from '@solana/web3.js';
import {reviewedMainnetManifest} from '../mainnet-program.js';
import {mainnetReleaseVerified} from './mainnet-program.mjs';

const loader=new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111');
const contextSlot=(result,minimum)=>{
  const slot=result?.context?.slot;
  assert(Number.isSafeInteger(slot)&&slot>=minimum,'Missing, malformed or stale finalized program context.');return slot;
};

// Deliberately uncached. A current hash alone says nothing about an older tx.
// Both account reads are finalized at/after that transaction. The ProgramData
// header must place deployment BEFORE the transaction: Loader-v3 programs become
// effective one slot after deploy/upgrade, not during the deployment slot.
export async function finalizedProgramContext({connection,release,transactionSlot}){
  const approved=reviewedMainnetManifest(release);
  assert(approved&&Number.isSafeInteger(transactionSlot)&&transactionSlot>0,'Reviewed transaction interval required.');
  const program=new PublicKey(approved.programId),address=PublicKey.findProgramAddressSync([program.toBuffer()],loader)[0];
  const programRead=await connection.getAccountInfoAndContext(program,{commitment:'finalized',minContextSlot:transactionSlot});
  const programContextSlot=contextSlot(programRead,transactionSlot),account=programRead.value;
  assert(account?.executable===true&&account.owner.equals(loader)&&account.data.length===36&&account.data.readUInt32LE(0)===2
    &&new PublicKey(account.data.subarray(4)).equals(address),'Finalized executable/ProgramData pointer differs.');
  const dataRead=await connection.getAccountInfoAndContext(address,{commitment:'finalized',minContextSlot:programContextSlot});
  const programDataContextSlot=contextSlot(dataRead,programContextSlot),programData=dataRead.value;
  assert(programData?.data?.length>=45,'Finalized ProgramData is missing or malformed.');
  const deploymentSlot=programData.data.readBigUInt64LE(4);
  assert(deploymentSlot<BigInt(transactionSlot),'Transaction predates effective reviewed deployment.');
  const evidence={account,programData,programDataAddress:String(address),sha256:createHash('sha256').update(programData.data).digest('hex')};
  assert(mainnetReleaseVerified(evidence,program,approved.programDataSha256,approved),'Finalized reviewed program bytes or authority differ.');
  return {...evidence,deploymentSlot:String(deploymentSlot),programContextSlot,programDataContextSlot};
}
