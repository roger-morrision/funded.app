// Protocol guard of the Mainnet fee-router build (see
// contracts/funded-fee-router/programs/funded-fee-router/src/instructions/guard.rs).
// The Mainnet router header is the 74-byte legacy header followed by:
// guardian (32) | paused (1) | daily cap lamports (u64) | window day (i64) | window spent (u64).
import {Buffer} from 'buffer';
import {PublicKey,TransactionInstruction} from '@solana/web3.js';

export const ROUTER_BASE_LEN=74;
export const GUARD_LEN=57;
export const MAINNET_ROUTER_LEN=ROUTER_BASE_LEN+GUARD_LEN;
// Mirrors REWARD_CYCLE_MIN_DELAY_SECONDS in the Mainnet program build.
export const MAINNET_REWARD_REVIEW_DELAY_SECONDS=24*60*60;
// Slack between planning a cycle and the transaction that creates it.
export const REWARD_REVIEW_MARGIN_SECONDS=15*60;

const ROUTER_SEED=Buffer.from('funded-fee-router-v1');
const UPGRADEABLE_LOADER=new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111');
const DISCRIMINATORS={
  configure:Buffer.from('589be76edab76ac5','hex'),
  pause:Buffer.from('13eb87fab872d159','hex'),
  cancel:Buffer.from('4d8d14589017b0a1','hex'),
};

const key=value=>value instanceof PublicKey?value:new PublicKey(value);
const isMainnet=cluster=>cluster==='mainnet-beta'||cluster==='mainnet';

export function routerHeaderLength(cluster){return isMainnet(cluster)?MAINNET_ROUTER_LEN:ROUTER_BASE_LEN;}
export function rewardReviewDelaySeconds(cluster){return isMainnet(cluster)?MAINNET_REWARD_REVIEW_DELAY_SECONDS:0;}

// Earliest payout_at a cycle planned now can use and still be created
// within the planning margin.
export function earliestRewardPayoutAt(cluster,nowSeconds=Math.floor(Date.now()/1000)){
  const delay=rewardReviewDelaySeconds(cluster);
  return delay?nowSeconds+delay+REWARD_REVIEW_MARGIN_SECONDS:nowSeconds;
}

// Devnet keeps the planned time unchanged; Mainnet moves it past the review delay.
export function plannedRewardPayoutAt(cluster,payoutAt,nowSeconds=Math.floor(Date.now()/1000)){
  if(!rewardReviewDelaySeconds(cluster))return Number(payoutAt);
  return Math.max(Number(payoutAt),earliestRewardPayoutAt(cluster,nowSeconds));
}

export function parseProtocolGuard(data){
  const bytes=Buffer.from(data||[]);
  if(bytes.length!==MAINNET_ROUTER_LEN)return null;
  const base=ROUTER_BASE_LEN;
  return {
    guardian:new PublicKey(bytes.subarray(base,base+32)).toBase58(),
    paused:bytes[base+32]!==0,
    dailyCapLamports:bytes.readBigUInt64LE(base+33).toString(),
    windowDay:Number(bytes.readBigInt64LE(base+41)),
    windowSpentLamports:bytes.readBigUInt64LE(base+49).toString(),
  };
}

// Lamports the authority may still move out today; null when unguarded.
export function remainingDailyOutflow(guard,nowSeconds=Math.floor(Date.now()/1000)){
  if(!guard)return null;
  const day=Math.floor(nowSeconds/86400);
  const spent=guard.windowDay===day?BigInt(guard.windowSpentLamports):0n;
  const left=BigInt(guard.dailyCapLamports)-spent;
  return (left>0n?left:0n).toString();
}

export function deriveRouterHeader(programId){
  return PublicKey.findProgramAddressSync([ROUTER_SEED],key(programId))[0];
}

function programData(programId){
  return PublicKey.findProgramAddressSync([key(programId).toBuffer()],UPGRADEABLE_LOADER)[0];
}

function u64(value){
  const amount=BigInt(value);
  if(amount<0n||amount>0xffffffffffffffffn)throw new Error('Daily cap must be a u64 lamport amount.');
  const out=Buffer.alloc(8);out.writeBigUInt64LE(amount);return out;
}

// Signed by the program upgrade owner wallet.
export function buildConfigureProtocolGuard({programId,upgradeOwner,guardian,dailyCapLamports}){
  const program=key(programId);
  return new TransactionInstruction({programId:program,data:Buffer.concat([DISCRIMINATORS.configure,u64(dailyCapLamports)]),
    keys:[{pubkey:key(upgradeOwner),isSigner:true,isWritable:false},
      {pubkey:key(guardian),isSigner:false,isWritable:false},
      {pubkey:deriveRouterHeader(program),isSigner:false,isWritable:true},
      {pubkey:program,isSigner:false,isWritable:false},
      {pubkey:programData(program),isSigner:false,isWritable:false}]});
}

// The guardian may pause; unpausing needs the upgrade owner.
export function buildSetProtocolPause({programId,signer,paused}){
  const program=key(programId);
  return new TransactionInstruction({programId:program,data:Buffer.concat([DISCRIMINATORS.pause,Buffer.from([paused?1:0])]),
    keys:[{pubkey:key(signer),isSigner:true,isWritable:false},
      {pubkey:deriveRouterHeader(program),isSigner:false,isWritable:true},
      {pubkey:program,isSigner:false,isWritable:false},
      {pubkey:programData(program),isSigner:false,isWritable:false}]});
}

export function buildCancelRewardCycle({programId,signer,reserve,cycle}){
  const program=key(programId);
  return new TransactionInstruction({programId:program,data:DISCRIMINATORS.cancel,
    keys:[{pubkey:key(signer),isSigner:true,isWritable:false},
      {pubkey:deriveRouterHeader(program),isSigner:false,isWritable:false},
      {pubkey:program,isSigner:false,isWritable:false},
      {pubkey:programData(program),isSigner:false,isWritable:false},
      {pubkey:key(reserve),isSigner:false,isWritable:true},
      {pubkey:key(cycle),isSigner:false,isWritable:true}]});
}
