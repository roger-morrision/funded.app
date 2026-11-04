import {createHash} from 'node:crypto';
import {PublicKey,SystemProgram} from '@solana/web3.js';
import {deriveMintVaultsV3,deriveCommunityRewardVaultV3,verifyMintPolicyV3Account} from '../mint-router-v3.js';
import {deriveAgencyVaultsV3} from '../agency-mint-router-v3.js';
import {DEVNET_GENESIS_HASH,parseReserve,rewardReserveAddress} from './automatic-reward-chain.mjs';
import {SOL_ASSET_MINT} from '../reward-merkle.js';
const categories=['Creator','Operations','Referral L1','Referral L2','Referral L3','Community','Buyback'];
const vaultDiscriminator=createHash('sha256').update('account:RewardVault').digest().subarray(0,8);

export async function readAdminVaults({state,offset,rpc,verifyPolicy=verifyMintPolicyV3Account}){
 const launches=Object.values(state.launches||{}).filter(row=>row.pumpFeeRoute?.scope==='per-mint-v3'&&row.pumpFeeRoute.programId);
 const page=launches.slice(offset,offset+10),groups=page.map(launch=>{
  const programId=launch.pumpFeeRoute.programId,vault=deriveCommunityRewardVaultV3(programId,launch.mint,launch.pumpFeeRoute.initialAuthority);
  return{vault,reserve:rewardReserveAddress({programId,vault,asset:'SOL'}),
   categories:(launch.pumpFeeRoute.protocolSplit?.agencyPercent===undefined?deriveMintVaultsV3:deriveAgencyVaultsV3)(programId,launch.mint)};
 });
 const addresses=groups.flatMap(g=>[...g.categories,g.vault,g.reserve]);
 if(await rpc.getGenesisHash()!==DEVNET_GENESIS_HASH)throw Error('The configured RPC is not Solana Devnet.');
 const [accounts,rent,rewardRent,policies]=await Promise.all([
  addresses.length?rpc.getMultipleAccountsInfo(addresses,'finalized'):[],
  page.length?rpc.getMinimumBalanceForRentExemption(0,'finalized'):0,
  page.length?rpc.getMinimumBalanceForRentExemption(73,'finalized'):0,
  Promise.all(page.map(async launch=>{try{return await verifyPolicy({connection:rpc,programId:launch.pumpFeeRoute.programId,mint:launch.mint,
   creator:launch.creatorWallet,initialAuthority:launch.pumpFeeRoute.initialAuthority,split:launch.pumpFeeRoute.protocolSplit});}
   catch{return{verified:false,reason:'v3-policy-read-unavailable'};}})),
 ]);
 let offsetIndex=0;
 const vaults=page.map((launch,index)=>{
  const group=groups[index],start=offsetIndex;offsetIndex+=group.categories.length+2;
  const fundedAccount=accounts[start+group.categories.length],reserveAccount=accounts[start+group.categories.length+1];
  const program=new PublicKey(launch.pumpFeeRoute.programId),data=Buffer.from(fundedAccount?.data||[]);
  const counter=reserveAccount?.owner?.equals(program)?parseReserve(reserveAccount):null;
  const rewardValid=fundedAccount?.owner?.equals(program)&&data.length===73&&data.subarray(0,8).equals(vaultDiscriminator)
   &&data.subarray(8,40).equals(new PublicKey(launch.pumpFeeRoute.initialAuthority).toBuffer())
   &&data.subarray(40,72).equals(new PublicKey(launch.mint).toBuffer())
   &&counter?.vault===group.vault.toBase58()&&counter.asset===SOL_ASSET_MINT;
  const names=[...categories,...(group.categories.length===8?['AI agency']:[]),'Holder and X SOL reserve'];
  return{mint:launch.mint,symbol:launch.symbol||null,policyStatus:policies[index].verified?'verified':policies[index].reason,
   categories:names.map((category,i)=>{
    const standard=i<group.categories.length,account=standard?accounts[start+i]:fundedAccount;
    const balance=BigInt(account?.lamports||0),accountValid=!account||account.owner?.equals(SystemProgram.programId)&&Buffer.from(account.data||[]).length===0;
    const payable=standard?policies[index].verified&&accountValid?policies[index].paidLamports[i]-policies[index].withdrawnLamports[i]:null
     :rewardValid?BigInt(counter.outstanding):null;
    const reserve=account?BigInt(standard?rent:rewardRent):0n;
    return{category,address:(standard?group.categories[i]:group.vault).toBase58(),lamports:String(balance),
     payableLamports:payable==null?null:String(payable),rentReserveLamports:account?String(reserve):null,
     unassignedLamports:payable==null?null:String(balance>reserve+payable?balance-reserve-payable:0n),
     shortfallLamports:payable==null?null:String(balance<reserve+payable?reserve+payable-balance:0n),
     ...(!standard?{reserveAddress:group.reserve.toBase58()}:{}),
     accountingStatus:standard?!accountValid?'vault-account-unverified':policies[index].verified?'verified':'policy-unverified'
      :rewardValid?'verified':'reward-reserve-unverified',custody:'V3 program vault',withdrawable:false};
   })};
 });
 return{totalLaunches:launches.length,offset,nextOffset:offset+page.length<launches.length?offset+page.length:null,vaults,
  note:'Reward SOL is held in the reward vault; its separate reserve account records outstanding liabilities. Unassigned SOL is not authorized for withdrawal.'};
}
