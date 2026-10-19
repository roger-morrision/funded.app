#![cfg(feature = "devnet-v3-program")]
use anchor_lang::{prelude::{Pubkey,Clock}, solana_program::{instruction::{AccountMeta,Instruction},system_instruction}, AccountDeserialize,InstructionData,ToAccountMetas};
use funded_fee_router::{MintAgencyPolicyV3,AgencyConfigV3,AgencyPromotionV3};
use litesvm::LiteSVM;
use solana_keypair_lite::Keypair;
use solana_message_lite::{Message,VersionedMessage};
use solana_signer_lite::Signer;
use solana_transaction_lite::versioned::VersionedTransaction;
mod support;
const UNITS:[u32;7]=[800_000,66_670,20_000,13_330,400_000,500_000,200_000];
const SHARES:[u32;3]=[6_000_000,1_000_000,1_000_000];
const GROSS:u64=1_000_000_000;
struct Fixture{svm:LiteSVM,program:Pubkey,authority:Keypair,creator:Keypair,mint:Keypair,billing:Keypair,
    legacy:Pubkey,config:Pubkey,router:Pubkey,policy:Pubkey,vaults:[Pubkey;8]}
fn send(svm:&mut LiteSVM,payer:&Keypair,signers:&[&Keypair],ix:Instruction)->bool{
    let message=Message::new_with_blockhash(&[ix],Some(&payer.pubkey()),&svm.latest_blockhash());
    let Ok(tx)=VersionedTransaction::try_new(VersionedMessage::Legacy(message),signers)else{return false;};
    let result=svm.send_transaction(tx);svm.expire_blockhash();
    if let Err(error)=&result{println!("Expected-or-diagnostic rejection: {:?}",error.err);}result.is_ok()
}
impl Fixture{
 fn new()->Self{
    let program=funded_fee_router::id();let mut svm=LiteSVM::new();svm.add_program(program,&support::program_bytes()).unwrap();
    svm.set_sysvar(&Clock{slot:100,unix_timestamp:1_760_000_000,..Clock::default()});
    let authority=Keypair::new();let owner=Keypair::new();let creator=Keypair::new();let mint=Keypair::new();let billing=Keypair::new();
    for wallet in [&authority,&creator,&billing]{svm.airdrop(&wallet.pubkey(),100_000_000_000).unwrap();}
    let program_data=support::set_upgrade_owner(&mut svm,program,owner.pubkey());
    let pda=|seeds:&[&[u8]]|Pubkey::find_program_address(seeds,&program).0;
    let legacy=pda(&[b"funded-fee-router-v1"]);let config=pda(&[b"agency-config-v3"]);
    let router=pda(&[b"funded-mint-router-v3",mint.pubkey().as_ref()]);
    let policy=pda(&[b"mint-agency-policy-v3",mint.pubkey().as_ref()]);
    let vaults=std::array::from_fn(|n|pda(&[b"mint-fee-vault-v3",mint.pubkey().as_ref(),&[n as u8]]));
    let init=Instruction::new_with_bytes(program,&funded_fee_router::instruction::Initialize{}.data(),
      funded_fee_router::accounts::Initialize{authority:authority.pubkey(),app_owner:owner.pubkey(),router:legacy,program,program_data,
      system_program:anchor_lang::system_program::ID}.to_account_metas(None));
    assert!(send(&mut svm,&authority,&[&authority,&owner],init));
    Self{svm,program,authority,creator,mint,billing,legacy,config,router,policy,vaults}
 }
 fn configure(&mut self){
    let ix=Instruction::new_with_bytes(self.program,&funded_fee_router::instruction::InitializeAgencyConfigV3{units:UNITS,recipient:self.billing.pubkey()}.data(),
      funded_fee_router::accounts::InitializeAgencyConfigV3{authority:self.authority.pubkey(),legacy_router:self.legacy,config:self.config,system_program:anchor_lang::system_program::ID}.to_account_metas(None));
    assert!(!send(&mut self.svm,&self.creator,&[&self.creator],ix.clone()));
    assert!(send(&mut self.svm,&self.authority,&[&self.authority],ix));
 }
 fn init_ix(&self,mask:u8,revision:u64)->Instruction{
    Instruction::new_with_bytes(self.program,&funded_fee_router::instruction::InitializeAgencyMintV3{directed_units:SHARES,selected_agents:mask,config_revision:revision}.data(),
      funded_fee_router::accounts::InitializeAgencyMintV3{authority:self.authority.pubkey(),creator:self.creator.pubkey(),mint:self.mint.pubkey(),
      legacy_router:self.legacy,config:self.config,router:self.router,policy:self.policy,system_program:anchor_lang::system_program::ID}.to_account_metas(None))
 }
 fn initialize(&mut self){self.configure();let ix=self.init_ix(7,1);assert!(send(&mut self.svm,&self.creator,&[&self.creator,&self.mint],ix));}
 fn settle_ix(&self,id:u8)->Instruction{
    let claim_id=[id;32];let claim=Pubkey::find_program_address(&[b"mint-fee-claim-v3",self.mint.pubkey().as_ref(),&claim_id],&self.program).0;
    let mut metas=funded_fee_router::accounts::SettleAgencyMintV3{authority:self.authority.pubkey(),creator:self.creator.pubkey(),mint:self.mint.pubkey(),legacy_router:self.legacy,
      router:self.router,policy:self.policy,claim,system_program:anchor_lang::system_program::ID}.to_account_metas(None);
    metas.extend(self.vaults.map(|pubkey|AccountMeta::new(pubkey,false)));
    Instruction::new_with_bytes(self.program,&funded_fee_router::instruction::SettleAgencyMintV3{claim_id,expected_lamports:GROSS}.data(),metas)
 }
 fn fund(&mut self){assert!(send(&mut self.svm,&self.authority,&[&self.authority],system_instruction::transfer(&self.authority.pubkey(),&self.router,GROSS)));}
 fn settle(&mut self,id:u8){self.fund();let ix=self.settle_ix(id);assert!(send(&mut self.svm,&self.authority,&[&self.authority,&self.creator],ix));}
 fn policy(&self)->MintAgencyPolicyV3{MintAgencyPolicyV3::try_deserialize(&mut &self.svm.get_account(&self.policy).unwrap().data[..]).unwrap()}
 fn disburse(&self,id:u8,category:u8,beneficiary:u8,amount:u64,holder_amount:u64,recipient:Pubkey)->Instruction{
    let withdrawal_id=[id;32];let withdrawal=Pubkey::find_program_address(&[b"mint-withdraw-v3",self.mint.pubkey().as_ref(),&withdrawal_id],&self.program).0;
    let approval=Pubkey::find_program_address(&[b"mint-approval-v3",self.mint.pubkey().as_ref(),&withdrawal_id],&self.program).0;
    Instruction::new_with_bytes(self.program,&funded_fee_router::instruction::DisburseAgencyMintV3{withdrawal_id,category,beneficiary,amount,holder_amount}.data(),
      funded_fee_router::accounts::DisburseAgencyMintV3{authority:self.authority.pubkey(),creator:self.creator.pubkey(),mint:self.mint.pubkey(),legacy_router:self.legacy,
      policy:self.policy,vault:self.vaults[usize::from(category)],recipient,approval,withdrawal,system_program:anchor_lang::system_program::ID}.to_account_metas(None))
 }
 fn promotion(&self,post_id:u64,sequence:u32,amount:u64,posted_at:i64,recipient:Pubkey,hash:[u8;32])->Instruction{
    let receipt=Pubkey::find_program_address(&[b"agency-promotion-v3",self.mint.pubkey().as_ref(),&post_id.to_le_bytes()],&self.program).0;
    Instruction::new_with_bytes(self.program,&funded_fee_router::instruction::BillAgencyPromotionV3{post_id,delivery_hash:hash,sequence,amount,posted_at}.data(),
      funded_fee_router::accounts::BillAgencyPromotionV3{authority:self.authority.pubkey(),mint:self.mint.pubkey(),legacy_router:self.legacy,policy:self.policy,
      vault:self.vaults[7],recipient,receipt,system_program:anchor_lang::system_program::ID}.to_account_metas(None))
 }
}

#[test]fn agency_launch_requires_current_config_and_immutable_selection(){
 let mut f=Fixture::new();f.configure();
 for (mask,revision)in[(8,1),(7,2)]{let ix=f.init_ix(mask,revision);assert!(!send(&mut f.svm,&f.creator,&[&f.creator,&f.mint],ix));}
 let ix=f.init_ix(7,1);assert!(!send(&mut f.svm,&f.creator,&[&f.creator],ix.clone()));
 assert!(send(&mut f.svm,&f.creator,&[&f.creator,&f.mint],ix));
 let saved=f.policy();assert_eq!(f.svm.get_account(&f.policy).unwrap().data.len(),383);
 assert_eq!(saved.protocol_units,UNITS);assert_eq!(saved.directed_units,SHARES);assert_eq!(saved.selected_agents,7);
 assert_eq!(saved.promotion_recipient,f.billing.pubkey());
 let mut changed=UNITS;changed[0]=700_000;changed[4]=500_000;
 let update=Instruction::new_with_bytes(f.program,&funded_fee_router::instruction::UpdateAgencyConfigV3{units:changed,recipient:f.creator.pubkey(),expected_revision:1}.data(),
    funded_fee_router::accounts::UpdateAgencyConfigV3{authority:f.authority.pubkey(),legacy_router:f.legacy,config:f.config}.to_account_metas(None));
 assert!(!send(&mut f.svm,&f.creator,&[&f.creator],update.clone()));
 assert!(send(&mut f.svm,&f.authority,&[&f.authority],update.clone()));assert!(!send(&mut f.svm,&f.authority,&[&f.authority],update));
 assert_eq!(f.policy().protocol_units,UNITS);assert_eq!(f.policy().promotion_recipient,f.billing.pubkey());
 let config=AgencyConfigV3::try_deserialize(&mut &f.svm.get_account(&f.config).unwrap().data[..]).unwrap();assert_eq!(config.revision,2);
 // Same mint router prevents creating another policy through the old initializer.
 let old_policy=Pubkey::find_program_address(&[b"mint-fee-policy-v3",f.mint.pubkey().as_ref()],&f.program).0;
 let old=Instruction::new_with_bytes(f.program,&funded_fee_router::instruction::InitializeProtectedMintV3{protocol_units:[800_000,200_000,60_000,40_000,400_000,500_000],directed_units:SHARES}.data(),
   funded_fee_router::accounts::InitializeProtectedMintV3{authority:f.authority.pubkey(),creator:f.creator.pubkey(),mint:f.mint.pubkey(),legacy_router:f.legacy,
   router:f.router,policy:old_policy,system_program:anchor_lang::system_program::ID}.to_account_metas(None));
 assert!(!send(&mut f.svm,&f.creator,&[&f.creator,&f.mint],old));assert!(f.svm.get_account(&old_policy).is_none());
}

#[test]fn agency_settlement_requires_both_signers_eight_vaults_and_replay_protection(){
 let mut f=Fixture::new();f.initialize();f.fund();let ix=f.settle_ix(1);
 assert!(!send(&mut f.svm,&f.authority,&[&f.authority],ix.clone()));
 let mut missing=ix.clone();missing.accounts.pop();assert!(!send(&mut f.svm,&f.authority,&[&f.authority,&f.creator],missing));
 let mut swapped=ix.clone();swapped.accounts.swap(14,15);assert!(!send(&mut f.svm,&f.authority,&[&f.authority,&f.creator],swapped));
 assert!(send(&mut f.svm,&f.authority,&[&f.authority,&f.creator],ix.clone()));assert!(!send(&mut f.svm,&f.authority,&[&f.authority,&f.creator],ix));
 assert_eq!(f.policy().paid_lamports,[800_000_000,80_000_000,6_667_000,2_000_000,1_333_000,40_000_000,50_000_000,20_000_000]);
 let amount=f.svm.get_account(&f.vaults[7]).unwrap().lamports;
 assert_eq!(amount-f.svm.minimum_balance_for_rent_exemption(0),20_000_000);
}

#[test]fn promotion_billing_enforces_immutable_recipient_agent_cap_sequence_and_daily_cadence(){
 let mut f=Fixture::new();f.initialize();f.settle(1);let now=1_760_000_000i64;
 for (post,seq,amount,at,recipient,hash)in[(1,0,6_666_667,now,f.billing.pubkey(),[1;32]),(1,1,1,now,f.billing.pubkey(),[1;32]),
   (1,0,1,now+1,f.billing.pubkey(),[1;32]),(1,0,1,now,f.creator.pubkey(),[1;32]),(1,0,1,now,f.billing.pubkey(),[0;32])]{
    let ix=f.promotion(post,seq,amount,at,recipient,hash);assert!(!send(&mut f.svm,&f.authority,&[&f.authority],ix));
 }
 let ix=f.promotion(1,0,6_666_666,now,f.billing.pubkey(),[1;32]);let before=f.svm.get_account(&f.billing.pubkey()).unwrap().lamports;
 assert!(send(&mut f.svm,&f.authority,&[&f.authority],ix.clone()));assert!(!send(&mut f.svm,&f.authority,&[&f.authority],ix));
 assert_eq!(f.svm.get_account(&f.billing.pubkey()).unwrap().lamports,before+6_666_666);assert_eq!(f.policy().agent_spent,[6_666_666,0,0]);
 let receipt=Pubkey::find_program_address(&[b"agency-promotion-v3",f.mint.pubkey().as_ref(),&1u64.to_le_bytes()],&f.program).0;
 let billed=AgencyPromotionV3::try_deserialize(&mut &f.svm.get_account(&receipt).unwrap().data[..]).unwrap();assert_eq!(billed.post_id,1);assert_eq!(billed.amount,6_666_666);
 f.settle(2);let early=f.promotion(2,1,1,now,f.billing.pubkey(),[2;32]);assert!(!send(&mut f.svm,&f.authority,&[&f.authority],early));
 f.svm.set_sysvar(&Clock{slot:200,unix_timestamp:now+86_400,..Clock::default()});
 let next=f.promotion(2,1,6_666_667,now+86_400,f.billing.pubkey(),[2;32]);assert!(send(&mut f.svm,&f.authority,&[&f.authority],next));
 assert_eq!(f.policy().promotion_sequence,2);assert_eq!(f.policy().withdrawn_lamports[7],13_333_333);
}

#[test]fn agency_beneficiary_releases_preserve_shares_and_block_generic_agency_sweeps(){
 let mut f=Fixture::new();f.initialize();f.settle(1);
 for(category,beneficiary,amount,holder,recipient)in[(7,9,1,0,f.billing.pubkey()),(0,0,600_000_001,0,f.creator.pubkey()),
    (0,0,1,0,f.billing.pubkey()),(0,0,1,1,f.creator.pubkey())]{
    let ix=f.disburse(20,category,beneficiary,amount,holder,recipient);assert!(!send(&mut f.svm,&f.authority,&[&f.authority,&f.creator],ix));
 }
 let wallet=f.disburse(20,0,0,600_000_000,0,f.creator.pubkey());assert!(!send(&mut f.svm,&f.authority,&[&f.authority],wallet.clone()));
 let before=f.svm.get_account(&f.creator.pubkey()).unwrap().lamports;
 assert!(send(&mut f.svm,&f.authority,&[&f.authority,&f.creator],wallet));
 assert_eq!(f.svm.get_account(&f.creator.pubkey()).unwrap().lamports,before+600_000_000);
 let reward=Pubkey::find_program_address(&[b"reward-vault-v1",f.authority.pubkey().as_ref(),f.mint.pubkey().as_ref()],&f.program).0;
 let init=Instruction::new_with_bytes(f.program,&funded_fee_router::instruction::InitializeRewardVault{}.data(),
    funded_fee_router::accounts::InitializeRewardVault{authority:f.authority.pubkey(),mint:f.mint.pubkey(),vault:reward,legacy_router:f.legacy,
    system_program:anchor_lang::system_program::ID}.to_account_metas(None));
 assert!(send(&mut f.svm,&f.authority,&[&f.authority],init));
 let bad=f.disburse(21,0,1,200_000_000,200_000_000,reward);assert!(!send(&mut f.svm,&f.authority,&[&f.authority,&f.creator],bad));
 let good=f.disburse(21,0,1,200_000_000,100_000_000,reward);let before=f.svm.get_account(&reward).unwrap().lamports;
 assert!(send(&mut f.svm,&f.authority,&[&f.authority,&f.creator],good));assert_eq!(f.svm.get_account(&reward).unwrap().lamports,before+200_000_000);
 assert_eq!(f.policy().directed_released,[600_000_000,100_000_000,100_000_000]);assert_eq!(f.policy().withdrawn_lamports[7],0);
 let ops=f.disburse(22,1,3,80_000_000,0,f.billing.pubkey());assert!(!send(&mut f.svm,&f.authority,&[&f.authority,&f.creator],ops.clone()));
 let withdrawal_id=[22;32];let approval=Pubkey::find_program_address(&[b"mint-approval-v3",f.mint.pubkey().as_ref(),&withdrawal_id],&f.program).0;
 let approve=Instruction::new_with_bytes(f.program,&funded_fee_router::instruction::ApproveAgencyWithdrawalV3{withdrawal_id,category:1,beneficiary:3,amount:80_000_000}.data(),
    funded_fee_router::accounts::ApproveAgencyWithdrawalV3{authority:f.authority.pubkey(),creator:f.creator.pubkey(),mint:f.mint.pubkey(),legacy_router:f.legacy,policy:f.policy,
    recipient:f.billing.pubkey(),approval,system_program:anchor_lang::system_program::ID}.to_account_metas(None));
 assert!(send(&mut f.svm,&f.authority,&[&f.authority,&f.creator],approve));assert!(send(&mut f.svm,&f.authority,&[&f.authority,&f.creator],ops.clone()));
 assert!(!send(&mut f.svm,&f.authority,&[&f.authority,&f.creator],ops));assert_eq!(f.policy().withdrawn_lamports[1],80_000_000);
}
