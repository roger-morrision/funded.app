import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {PublicKey} from '@solana/web3.js';
import {SOL_ASSET_MINT} from '../reward-merkle.js';
import {assertRpcNetwork,requireSolanaCluster} from '../solana-network.js';
import {reviewedMainnetManifest} from '../mainnet-program.js';
import {deriveRouterHeader,parseProtocolGuard,routerHeaderLength} from '../protocol-guard.js';
import {financialRecordNetwork} from './financial-network.mjs';
import {parseCycleFields,parseReserve} from './reward-account-codec.mjs';

const key=value=>new PublicKey(value),disc=createHash('sha256').update('account:RewardVault').digest().subarray(0,8);
const owned=(account,program)=>account?.owner?.equals(program)&&account.executable===false;
const slot=(read,minimum)=>{assert(Number.isSafeInteger(read?.context?.slot)&&read.context.slot>0&&read.context.slot>=minimum,'Stale committed reward context.');return read.context.slot;};
const immutable=['vault','cycleId','root','asset','totalAmount','cutoffAt','payoutAt','leafCount','receiptMode'];
const equal=(a,b)=>immutable.every(name=>String(a[name])===String(b[name]));

// Resolve an existing commitment from its saved cycle, never from a successor's
// key. The chain's normal readiness/ProgramData gate remains mandatory; this is
// account/namespace authentication, not a new program or financial admission.
export async function readCommittedRewardContext({connection,programId,currentAuthority,plan,cluster,recipient,
  expectedProgramDataSha256,release=reviewedMainnetManifest()}){
  const input=plan,source=plan?.manifest;
  // Only the immutable tuple and count are needed here. Copying every Merkle
  // leaf for each recipient would make a complete cohort quadratic in size.
  plan={...plan,cycle:plan?.cycle?String(plan.cycle):null,mint:plan?.mint?String(plan.mint):null,
    manifest:source?{cycleId:source.cycleId,root:source.root,asset:source.asset,totalAmount:String(source.totalAmount),
      leafCount:Array.isArray(source.leaves)?source.leaves.length:0}:null};
  requireSolanaCluster(cluster);
  const program=key(programId),operator=key(currentAuthority),manifest=plan?.manifest;
  if(cluster==='mainnet-beta'){
    const approved=reviewedMainnetManifest(release);
    assert(approved?.programId===String(program)&&approved.programDataSha256===expectedProgramDataSha256?.toLowerCase(),'Reviewed committed reward program required.');
  }
  assert(financialRecordNetwork(plan,cluster,{legacyDevnet:true}),'Committed reward plan belongs to a different network.');
  assert(plan?.cycle&&manifest&&/^[a-f0-9]{64}$/.test(manifest.cycleId)&&/^[a-f0-9]{64}$/.test(manifest.root)
    &&/^[1-9]\d*$/.test(manifest.totalAmount)&&BigInt(manifest.totalAmount)<=0xffffffffffffffffn
    &&Number.isSafeInteger(manifest.leafCount)&&manifest.leafCount>0&&manifest.leafCount<=0xffffffff&&Number.isSafeInteger(plan.cutoffAt)&&plan.cutoffAt>0
    &&Number.isSafeInteger(plan.payoutAt)&&plan.payoutAt>=plan.cutoffAt,'Saved immutable committed reward cycle required.');
  if(plan.asset!==undefined)assert(plan.asset===manifest.asset,'Committed reward asset differs.');
  const cycle=key(plan.cycle),mint=key(plan.mint),asset=key(manifest.asset==='SOL'?SOL_ASSET_MINT:manifest.asset),router=deriveRouterHeader(program);
  const payment=recipient?PublicKey.findProgramAddressSync([Buffer.from('reward-payment-v1'),cycle.toBuffer(),key(recipient).toBuffer()],program)[0]:null;
  await assertRpcNetwork(connection,cluster);
  const firstRead=await connection.getAccountInfoAndContext(cycle,{commitment:'finalized'}),firstSlot=slot(firstRead,1),first=parseCycleFields(firstRead.value);
  assert(owned(firstRead.value,program)&&first,'Saved committed reward cycle is missing or foreign.');
  const vault=key(first.vault),reserve=PublicKey.findProgramAddressSync([Buffer.from('reward-reserve-v1'),vault.toBuffer(),asset.toBuffer()],program)[0];
  const addresses=[cycle,vault,reserve,router,...(payment?[payment]:[])];
  const batch=await connection.getMultipleAccountsInfoAndContext(addresses,{commitment:'finalized',minContextSlot:firstSlot}),contextSlot=slot(batch,firstSlot);
  const [cycleInfo,vaultInfo,reserveInfo,routerInfo,paymentInfo]=batch.value.map(a=>a?{...a,data:Buffer.from(a.data)}:null);
  const record=parseCycleFields(cycleInfo),liability=parseReserve(reserveInfo),legacy=cycleInfo?.data.length===173;
  assert(owned(cycleInfo,program)&&record&&equal(first,record),'Committed cycle changed during namespace review.');
  assert(equal(record,{vault:String(vault),cycleId:manifest.cycleId,root:manifest.root,asset:manifest.asset,totalAmount:manifest.totalAmount,
    cutoffAt:plan.cutoffAt,payoutAt:plan.payoutAt,leafCount:manifest.leafCount,receiptMode:record.receiptMode}),'Committed cycle differs from its frozen manifest.');
  assert(record.receiptMode==='legacy'||cluster==='devnet'&&record.receiptMode==='bitmap','Committed receipt mode is not supported on this network.');
  assert(owned(vaultInfo,program)&&vaultInfo.data.length===73&&vaultInfo.data.subarray(0,8).equals(disc),'Historical committed vault is foreign or malformed.');
  const originalAuthority=key(vaultInfo.data.subarray(8,40));
  const [expectedVault,vaultBump]=PublicKey.findProgramAddressSync([Buffer.from('reward-vault-v1'),originalAuthority.toBuffer(),mint.toBuffer()],program);
  const [expectedCycle,cycleBump]=PublicKey.findProgramAddressSync([Buffer.from('reward-cycle-v1'),vault.toBuffer(),Buffer.from(manifest.cycleId,'hex')],program);
  assert(vault.equals(expectedVault)&&cycle.equals(expectedCycle)&&vaultInfo.data.subarray(40,72).equals(mint.toBuffer())&&vaultInfo.data[72]===vaultBump
    &&cycleInfo.data[172]===cycleBump&&(legacy||[0,1].includes(cycleInfo.data[173])),'Historical committed reward seeds or mint differ.');
  if(plan.originalAuthority!==undefined)assert(originalAuthority.equals(key(plan.originalAuthority)),'Committed original authority differs.');
  const [,reserveBump]=PublicKey.findProgramAddressSync([Buffer.from('reward-reserve-v1'),vault.toBuffer(),asset.toBuffer()],program);
  assert(legacy&&!reserveInfo||owned(reserveInfo,program)&&liability?.vault===String(vault)&&liability.asset===String(asset)&&liability.bump===reserveBump,'Committed reserve identity differs.');
  const unpaid=BigInt(record.totalAmount)-BigInt(record.distributedAmount);
  assert(unpaid>=0n&&(!record.reserved||BigInt(liability.outstanding)>=unpaid),'Committed reward liability is inconsistent.');
  assert(owned(routerInfo,program)&&routerInfo.data.length===routerHeaderLength(cluster)&&routerInfo.data.subarray(0,8).toString()==='FUNDFEE1'
    &&routerInfo.data.subarray(41,73).equals(operator.toBuffer()),'Committed payout current operator/router differs.');
  if(cluster==='mainnet-beta')assert(parseProtocolGuard(routerInfo.data)?.paused===false,'Committed reward payouts are paused.');
  assert(['cycle','mint','asset','cluster','genesisHash','originalAuthority','cutoffAt','payoutAt'].every(name=>String(input[name])===String(plan[name]))
    &&['cycleId','root','asset','totalAmount'].every(name=>String(input.manifest?.[name])===String(manifest[name]))
    &&Array.isArray(input.manifest?.leaves)&&input.manifest.leaves.length===manifest.leafCount,'Committed plan changed during namespace review.');
  return {vault,cycle,reserve,payment,originalAuthority,record,liability,legacy,slot:contextSlot,cycleInfo,vaultInfo,reserveInfo,paymentInfo};
}
