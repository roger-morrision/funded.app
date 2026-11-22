import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {PublicKey,TransactionInstruction} from '@solana/web3.js';
import {SOL_ASSET_MINT} from '../reward-merkle.js';
import {assertRpcNetwork,requireSolanaCluster} from '../solana-network.js';
import {reviewedMainnetManifest} from '../mainnet-program.js';
import {deriveRouterHeader,parseProtocolGuard,routerHeaderLength} from '../protocol-guard.js';
import {parseCycleFields,parseReserve} from './reward-account-codec.mjs';
import {finalizedProgramContext} from './finalized-program-context.mjs';
import {financialRecordNetwork} from './financial-network.mjs';

const key=value=>new PublicKey(value),disc=(namespace,name)=>createHash('sha256').update(namespace+':'+name).digest().subarray(0,8);
const slot=(read,floor)=>{assert(Number.isSafeInteger(read?.context?.slot)&&read.context.slot>0&&read.context.slot>=floor,'Stale expiry account context.');return read.context.slot;};
const owned=(account,program)=>account?.owner?.equals(program)&&account.executable===false;
const fields=['vault','cycleId','root','asset','totalAmount','cutoffAt','payoutAt','leafCount','receiptMode'];
const sameCycle=(a,b)=>fields.every(field=>String(a[field])===String(b[field]));

// The saved cycle, not the successor's key, selects the historical namespace.
// This constructs no transaction signature and cannot admit a program release.
export async function readRewardExpiryContext({connection,programId,currentAuthority,plan,cluster,release=reviewedMainnetManifest(),readOnlyRecovery=false}){
  plan=structuredClone(plan);requireSolanaCluster(cluster);
  const approved=cluster==='mainnet-beta'?reviewedMainnetManifest(release):null;
  assert(cluster!=='mainnet-beta'||approved?.programId===String(programId),'Reviewed expiry program required.');
  assert(financialRecordNetwork(plan,cluster,{legacyDevnet:true}),'Saved expiry plan belongs to a different network.');
  const program=key(programId),operator=key(currentAuthority),manifest=plan?.manifest;
  assert(plan?.cycle&&manifest&&/^[a-f0-9]{64}$/.test(manifest.cycleId)&&/^[a-f0-9]{64}$/.test(manifest.root)
    &&/^[1-9]\d*$/.test(manifest.totalAmount)&&BigInt(manifest.totalAmount)<=0xffffffffffffffffn
    &&Array.isArray(manifest.leaves)&&manifest.leaves.length>0&&Number.isSafeInteger(plan.cutoffAt)&&plan.cutoffAt>0
    &&Number.isSafeInteger(plan.payoutAt)&&plan.payoutAt>=plan.cutoffAt,'Saved immutable reward cycle and manifest required.');
  const cycle=key(plan.cycle),mint=key(plan.mint),asset=key(manifest.asset==='SOL'?SOL_ASSET_MINT:manifest.asset),router=deriveRouterHeader(program);
  if(plan.asset!==undefined)assert(plan.asset===manifest.asset,'Saved reward asset differs.');
  await assertRpcNetwork(connection,cluster);
  const initial=await connection.getAccountInfoAndContext(cycle,{commitment:'finalized'}),firstSlot=slot(initial,1),first=parseCycleFields(initial.value);
  assert(owned(initial.value,program)&&first,'Saved reward cycle is missing or foreign.');
  const vault=key(first.vault),reserve=PublicKey.findProgramAddressSync([Buffer.from('reward-reserve-v1'),vault.toBuffer(),asset.toBuffer()],program)[0];
  const snapshot=await connection.getMultipleAccountsInfoAndContext([cycle,vault,reserve,router],{commitment:'finalized',minContextSlot:firstSlot}),contextSlot=slot(snapshot,firstSlot);
  const [cycleInfo,vaultInfo,reserveInfo,routerInfo]=snapshot.value.map(account=>account?{...account,data:Buffer.from(account.data)}:null),record=parseCycleFields(cycleInfo),liability=parseReserve(reserveInfo);
  assert(owned(cycleInfo,program)&&record&&sameCycle(first,record),'Saved cycle changed during expiry review.');
  assert(sameCycle(record,{vault:String(vault),cycleId:manifest.cycleId,root:manifest.root,asset:manifest.asset,
    totalAmount:manifest.totalAmount,cutoffAt:plan.cutoffAt,payoutAt:plan.payoutAt,leafCount:manifest.leaves.length,receiptMode:record.receiptMode}),
  'Reward cycle differs from its immutable manifest.');
  assert((record.receiptMode==='legacy'&&cycleInfo.data.length===174)||(cluster==='devnet'&&record.receiptMode==='bitmap'),
    'Expiry receipt mode is not supported for this network.');
  assert(owned(vaultInfo,program)&&vaultInfo.data.length===73&&vaultInfo.data.subarray(0,8).equals(disc('account','RewardVault')),'Historical reward vault is foreign or malformed.');
  const originalAuthority=key(vaultInfo.data.subarray(8,40));
  const [expectedVault,vaultBump]=PublicKey.findProgramAddressSync([Buffer.from('reward-vault-v1'),originalAuthority.toBuffer(),mint.toBuffer()],program);
  const [expectedCycle,cycleBump]=PublicKey.findProgramAddressSync([Buffer.from('reward-cycle-v1'),vault.toBuffer(),Buffer.from(manifest.cycleId,'hex')],program);
  assert(vault.equals(expectedVault)&&cycle.equals(expectedCycle)&&vaultInfo.data.subarray(40,72).equals(mint.toBuffer())&&vaultInfo.data[72]===vaultBump,
    'Historical reward vault/cycle seeds or mint differ.');
  assert(cycleInfo.data[172]===cycleBump&&[0,1].includes(cycleInfo.data[173]),'Historical reward cycle bump/flag differs.');
  if(plan.originalAuthority!==undefined)assert(originalAuthority.equals(key(plan.originalAuthority)),'Saved original reward authority differs.');
  const [,reserveBump]=PublicKey.findProgramAddressSync([Buffer.from('reward-reserve-v1'),vault.toBuffer(),asset.toBuffer()],program);
  assert(owned(reserveInfo,program)&&liability?.vault===String(vault)&&liability.asset===String(asset)&&liability.bump===reserveBump,'Historical reserve identity differs.');
  assert(owned(routerInfo,program)&&routerInfo.data.length===routerHeaderLength(cluster)&&routerInfo.data.subarray(0,8).toString()==='FUNDFEE1'
    &&routerInfo.data.subarray(41,73).equals(operator.toBuffer()),'Current expiry operator/router differs.');
  if(cluster==='mainnet-beta')assert(parseProtocolGuard(routerInfo.data)?.paused===false||readOnlyRecovery===true,'Reward expiry is paused.');
  const unpaid=BigInt(record.totalAmount)-BigInt(record.distributedAmount);
  assert(unpaid>=0n&&(!record.reserved||BigInt(liability.outstanding)>=unpaid),'Invalid unpaid reward liability.');
  const time=await connection.getBlockTime(contextSlot),grace=cluster==='devnet'?600:30*24*60*60;
  assert(Number.isSafeInteger(time)&&(!record.reserved||time>=record.payoutAt+grace),'Reward expiry grace has not elapsed or time is unavailable.');
  if(approved)await finalizedProgramContext({connection,release:approved,transactionSlot:contextSlot});
  const instruction=new TransactionInstruction({programId:program,data:disc('global',record.receiptMode==='bitmap'?'expire_bitmap_cycle':'expire_reward_cycle'),keys:[
    {pubkey:operator,isSigner:true,isWritable:false},{pubkey:vault,isSigner:false,isWritable:false},
    {pubkey:reserve,isSigner:false,isWritable:true},{pubkey:cycle,isSigner:false,isWritable:true},{pubkey:router,isSigner:false,isWritable:false}]});
  return {instruction,cycle:String(cycle),vault:String(vault),reserve:String(reserve),originalAuthority:String(originalAuthority),currentAuthority:String(operator),
    slot:contextSlot,record,liability,unpaidAmount:String(unpaid),cycleInfo,vaultInfo,reserveInfo};
}

export function verifyRewardExpiryTransition(before,after){
  assert(before.record.reserved&&!after.record.reserved&&after.slot>=before.slot&&sameCycle(before.record,after.record)
    &&before.cycle===after.cycle&&before.vault===after.vault&&before.reserve===after.reserve
    &&before.originalAuthority===after.originalAuthority&&before.currentAuthority===after.currentAuthority,'Reward expiry immutable context differs.');
  const cycle=Buffer.from(before.cycleInfo.data);cycle[173]=0;
  // Bitmap flags live in the same fixed header; the paid bitmap remains intact.
  const reserve=Buffer.from(before.reserveInfo.data);reserve.writeBigUInt64LE(BigInt(before.liability.outstanding)-BigInt(before.unpaidAmount),72);
  assert(cycle.equals(after.cycleInfo.data)&&reserve.equals(after.reserveInfo.data)&&before.vaultInfo.data.equals(after.vaultInfo.data)
    &&['cycleInfo','vaultInfo','reserveInfo'].every(field=>before[field].lamports===after[field].lamports),
  'Reward expiry lacks exact unpaid liability release or moved custody.');
  return {address:before.cycle,vault:before.vault,originalAuthority:before.originalAuthority,
    expired:true,unpaidAmount:before.unpaidAmount,liabilityDeltaVerified:true};
}
