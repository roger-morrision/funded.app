import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {Keypair,PublicKey,SystemProgram} from '@solana/web3.js';
import {readAdminVaults} from '../server/admin-vaults.mjs';
import {deriveCommunityRewardVaultV3} from '../mint-router-v3.js';
import {rewardReserveAddress,DEVNET_GENESIS_HASH} from '../server/automatic-reward-chain.mjs';
import {SOL_ASSET_MINT} from '../reward-merkle.js';
const key=()=>Keypair.generate().publicKey;
function fixture(agency=false){
 const program=key(),mint=key(),authority=key(),vault=deriveCommunityRewardVaultV3(program,mint,authority),reserve=rewardReserveAddress({programId:program,vault,asset:'SOL'});
 const vaultData=Buffer.alloc(73),reserveData=Buffer.alloc(81);
 createHash('sha256').update('account:RewardVault').digest().copy(vaultData,0,0,8);authority.toBuffer().copy(vaultData,8);mint.toBuffer().copy(vaultData,40);
 createHash('sha256').update('account:RewardReserve').digest().copy(reserveData,0,0,8);vault.toBuffer().copy(reserveData,8);new PublicKey(SOL_ASSET_MINT).toBuffer().copy(reserveData,40);reserveData.writeBigUInt64LE(4000000n,72);
 const funded={owner:program,data:vaultData,lamports:5500000},counter={owner:program,data:reserveData,lamports:1000000};
 const launch={mint:String(mint),pumpFeeRoute:{scope:'per-mint-v3',programId:String(program),initialAuthority:String(authority),protocolSplit:agency?{agencyPercent:10}:{}}};
 const state={launches:{[String(mint)]:launch}};
 const accounts=new Map([[String(vault),funded],[String(reserve),counter]]);
 const rpc={getGenesisHash:async()=>DEVNET_GENESIS_HASH,getMultipleAccountsInfo:async addresses=>addresses.map(k=>accounts.get(String(k))||null),
 getMinimumBalanceForRentExemption:async size=>size===73?1500000:890880};
 const read=()=>readAdminVaults({state,offset:0,rpc,verifyPolicy:async()=>({verified:true,paidLamports:Array(8).fill(0n),withdrawnLamports:Array(8).fill(0n)})});
 return{read,funded,counter,accounts,vault,reserve,rpc,state};
}
for(const agency of [false,true])test(`reward cash and liabilities use separate accounts (${agency?'agency':'legacy'})`,async()=>{
 const f=fixture(agency),row=(await f.read()).vaults[0].categories.at(-1);
 assert.equal(row.address,String(f.vault));assert.equal(row.reserveAddress,String(f.reserve));assert.equal(row.lamports,'5500000');
 assert.equal(row.payableLamports,'4000000');assert.equal(row.rentReserveLamports,'1500000');assert.equal(row.shortfallLamports,'0');assert.equal(row.unassignedLamports,'0');
 f.counter.lamports=990000000;assert.equal((await f.read()).vaults[0].categories.at(-1).shortfallLamports,'0');
 f.funded.lamports-=100000;assert.equal((await f.read()).vaults[0].categories.at(-1).shortfallLamports,'100000');
 f.funded.lamports+=200000;assert.equal((await f.read()).vaults[0].categories.at(-1).unassignedLamports,'100000');
});
test('missing, substituted or mismatched reward accounts never certify payable cash',async()=>{
 for(const mutate of [f=>f.accounts.delete(String(f.vault)),f=>f.funded.owner=SystemProgram.programId,
  f=>key().toBuffer().copy(f.funded.data,8),f=>key().toBuffer().copy(f.funded.data,40),f=>f.counter.owner=SystemProgram.programId,
  f=>key().toBuffer().copy(f.counter.data,8),f=>key().toBuffer().copy(f.counter.data,40)]){
  const f=fixture();mutate(f);const row=(await f.read()).vaults[0].categories.at(-1);assert.equal(row.payableLamports,null);assert.equal(row.shortfallLamports,null);assert.equal(row.accountingStatus,'reward-reserve-unverified');
 }
});
test('inventory rejects a different cluster before reading balances',async()=>{
 const f=fixture();f.rpc.getGenesisHash=async()=>'wrong-chain';f.rpc.getMultipleAccountsInfo=()=>assert.fail('No balance query on another cluster');
 await assert.rejects(f.read(),/not Solana Devnet/);
});
