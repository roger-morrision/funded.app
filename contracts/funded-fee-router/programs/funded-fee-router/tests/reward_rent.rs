#![cfg(feature="devnet-v3-program")]
use anchor_lang::{prelude::{Clock,Pubkey}, solana_program::{instruction::Instruction,system_instruction}, InstructionData,ToAccountMetas};
use litesvm::LiteSVM;
use solana_keypair_lite::Keypair;
use solana_signer_lite::Signer;
use solana_message_lite::{Message,VersionedMessage};
use solana_transaction_lite::versioned::VersionedTransaction;
use solana_sha256_hasher::hashv;
mod support;

fn send(svm:&mut LiteSVM,payer:&Keypair,ixs:&[Instruction])->bool {
    let msg=Message::new_with_blockhash(ixs,Some(&payer.pubkey()),&svm.latest_blockhash());
    let tx=VersionedTransaction::try_new(VersionedMessage::Legacy(msg),&[payer]).unwrap();
    let result=svm.send_transaction(tx);svm.expire_blockhash();result.is_ok()
}
struct Fixture { svm:LiteSVM,payer:Keypair,vault:Pubkey,reserve:Pubkey,router:Pubkey,holder:Pubkey,other:Pubkey }
impl Fixture {
    fn new()->Self {
        let id=funded_fee_router::id();let mut svm=LiteSVM::new();svm.add_program(id,&support::program_bytes()).unwrap();
        let mut clock=svm.get_sysvar::<Clock>();clock.unix_timestamp=1_800_000_000;svm.set_sysvar(&clock);
        let payer=Keypair::new();svm.airdrop(&payer.pubkey(),1_000_000_000).unwrap();
        let program_data=support::set_upgrade_owner(&mut svm,id,payer.pubkey());
        let router=Pubkey::find_program_address(&[b"funded-fee-router-v1"],&id).0;
        let init=Instruction::new_with_bytes(id,&funded_fee_router::instruction::Initialize{}.data(),funded_fee_router::accounts::Initialize{
            authority:payer.pubkey(),app_owner:payer.pubkey(),router,program:id,program_data,system_program:anchor_lang::system_program::ID}.to_account_metas(None));
        assert!(send(&mut svm,&payer,&[init]));
        let mint=Pubkey::new_unique();let vault=Pubkey::find_program_address(&[b"reward-vault-v1",payer.pubkey().as_ref(),mint.as_ref()],&id).0;
        let reserve=Pubkey::find_program_address(&[b"reward-reserve-v1",vault.as_ref(),Pubkey::default().as_ref()],&id).0;
        let init=Instruction::new_with_bytes(id,&funded_fee_router::instruction::InitializeRewardVault{}.data(),funded_fee_router::accounts::InitializeRewardVault{
            authority:payer.pubkey(),mint,vault,legacy_router:router,system_program:anchor_lang::system_program::ID}.to_account_metas(None));
        let liability=Instruction::new_with_bytes(id,&funded_fee_router::instruction::InitializeRewardReserve{asset_mint:Pubkey::default()}.data(),funded_fee_router::accounts::InitializeRewardReserve{
            authority:payer.pubkey(),vault,reserve,legacy_router:router,system_program:anchor_lang::system_program::ID}.to_account_metas(None));
        assert!(send(&mut svm,&payer,&[init,liability,system_instruction::transfer(&payer.pubkey(),&vault,1_000_000)]));
        let holder=Pubkey::new_unique();let other=Pubkey::new_unique();svm.airdrop(&holder,1_000_000).unwrap();svm.airdrop(&other,1_000_000).unwrap();
        Self{svm,payer,vault,reserve,router,holder,other}
    }
    fn cycle(&self,cycle_id:[u8;32])->Pubkey {Pubkey::find_program_address(&[b"reward-cycle-v1",self.vault.as_ref(),&cycle_id],&funded_fee_router::id()).0}
    fn leaf(&self,cycle_id:[u8;32],index:u32)->[u8;32]{let recipient=if index==0{self.holder}else{self.other};hashv(&[b"funded-reward-leaf-v1",&cycle_id,recipient.as_ref(),Pubkey::default().as_ref(),&10_000u64.to_le_bytes(),&index.to_le_bytes()]).to_bytes()}
    fn create(&self,cycle_id:[u8;32],bitmap:bool)->Instruction {
        let a=self.leaf(cycle_id,0);let b=self.leaf(cycle_id,1);let root=if a<=b{hashv(&[&a,&b])}else{hashv(&[&b,&a])}.to_bytes();
        let data=if bitmap{funded_fee_router::instruction::CreateBitmapCycle{cycle_id,merkle_root:root,asset_mint:Pubkey::default(),total_amount:20_000,cutoff_at:1_800_000_000,payout_at:1_800_000_000,leaf_count:2}.data()}
        else{funded_fee_router::instruction::CreateRewardCycle{cycle_id,merkle_root:root,asset_mint:Pubkey::default(),total_amount:20_000,cutoff_at:1_800_000_000,payout_at:1_800_000_000,leaf_count:2}.data()};
        Instruction::new_with_bytes(funded_fee_router::id(),&data,funded_fee_router::accounts::CreateRewardCycle{authority:self.payer.pubkey(),vault:self.vault,reserve:self.reserve,cycle:self.cycle(cycle_id),legacy_router:self.router,system_program:anchor_lang::system_program::ID}.to_account_metas(None))
    }
    fn payment(&self,id:[u8;32],index:u32)->Pubkey {Pubkey::find_program_address(&[b"reward-payment-v1",self.cycle(id).as_ref(),if index==0{self.holder.as_ref()}else{self.other.as_ref()}],&funded_fee_router::id()).0}
    fn pay(&self,id:[u8;32],index:u32,bitmap:bool)->Instruction{
        let proof=vec![self.leaf(id,1-index)];let recipient=if index==0{self.holder}else{self.other};
        let data=if bitmap{funded_fee_router::instruction::PayoutBitmapSol{amount:10_000,leaf_index:index,proof}.data()}else{funded_fee_router::instruction::PayoutRewardSol{amount:10_000,leaf_index:index,proof}.data()};
        let mut accounts=funded_fee_router::accounts::PayoutRewardSol{payer:self.payer.pubkey(),vault:self.vault,reserve:self.reserve,cycle:self.cycle(id),recipient,payment:self.payment(id,index),system_program:anchor_lang::system_program::ID}.to_account_metas(None);
        if bitmap{accounts.remove(5);}Instruction::new_with_bytes(funded_fee_router::id(),&data,accounts)
    }
    fn complete(&self,id:[u8;32])->Instruction{Instruction::new_with_bytes(funded_fee_router::id(),&funded_fee_router::instruction::CompleteRewardCycle{}.data(),funded_fee_router::accounts::CompleteRewardCycle{authority:self.payer.pubkey(),vault:self.vault,cycle:self.cycle(id),legacy_router:self.router}.to_account_metas(None))}
    fn close(&self,id:[u8;32],index:u32)->Instruction{Instruction::new_with_bytes(funded_fee_router::id(),&funded_fee_router::instruction::CloseRewardPayment{}.data(),funded_fee_router::accounts::CloseRewardPayment{authority:self.payer.pubkey(),vault:self.vault,cycle:self.cycle(id),payment:self.payment(id,index),legacy_router:self.router}.to_account_metas(None))}
}
#[test]
fn cleanup_refunds_receipts_but_never_reopens_cycle(){
    let mut f=Fixture::new();let id=[41;32];let create=f.create(id,false);assert!(send(&mut f.svm,&f.payer,&[create.clone()]));
    let pay=f.pay(id,0,false);assert!(send(&mut f.svm,&f.payer,&[pay.clone()]));
    let close=f.close(id,0);let complete=f.complete(id);
    assert!(!send(&mut f.svm,&f.payer,&[close.clone()]));assert!(!send(&mut f.svm,&f.payer,&[complete.clone()]));
    let second=f.pay(id,1,false);assert!(send(&mut f.svm,&f.payer,&[second]));
    let receipt=f.payment(id,0);let rent=f.svm.get_account(&receipt).unwrap().lamports;
    let before=f.svm.get_account(&f.payer.pubkey()).unwrap().lamports;
    assert!(send(&mut f.svm,&f.payer,&[complete,close.clone()]));
    assert_eq!(f.svm.get_account(&f.payer.pubkey()).unwrap().lamports,before+rent-5000);
    assert!(f.svm.get_account(&receipt).is_none());assert!(!send(&mut f.svm,&f.payer,&[pay]));
    assert!(!send(&mut f.svm,&f.payer,&[create]));assert!(!send(&mut f.svm,&f.payer,&[close]));
    let bitmap_create=f.create(id,true);assert!(!send(&mut f.svm,&f.payer,&[bitmap_create]));
}
#[test]
fn bitmap_rejects_duplicates_forged_proofs_and_legacy_bypass(){
    let mut f=Fixture::new();let id=[42;32];let create=f.create(id,true);assert!(send(&mut f.svm,&f.payer,&[create.clone()]));
    let pay=f.pay(id,0,true);let mut wrong=pay.clone();wrong.data[8]=11;assert!(!send(&mut f.svm,&f.payer,&[wrong]));
    let before=f.svm.get_account(&f.holder).unwrap().lamports;
    // Two identical payouts in one transaction roll back both writes and funds.
    assert!(!send(&mut f.svm,&f.payer,&[pay.clone(),pay.clone()]));
    assert_eq!(f.svm.get_account(&f.holder).unwrap().lamports,before);
    assert!(send(&mut f.svm,&f.payer,&[pay.clone()]));
    assert!(!send(&mut f.svm,&f.payer,&[pay]));
    assert_eq!(f.svm.get_account(&f.holder).unwrap().lamports,before+10_000);
    assert!(f.svm.get_account(&f.payment(id,0)).is_none());
    let legacy=f.pay(id,1,false);assert!(!send(&mut f.svm,&f.payer,&[legacy]));
    assert!(!send(&mut f.svm,&f.payer,&[create]));
    let second=f.pay(id,1,true);assert!(send(&mut f.svm,&f.payer,&[second]));
    let cycle=f.svm.get_account(&f.cycle(id)).unwrap();assert_eq!(cycle.data.len(),179);assert_eq!(cycle.data[178],3);
}
#[test]
fn failed_sol_delivery_rolls_back_paid_bit(){
    let mut f=Fixture::new();let id=[43;32];let create=f.create(id,true);assert!(send(&mut f.svm,&f.payer,&[create]));
    let mut vault=f.svm.get_account(&f.vault).unwrap();let original=vault.clone();vault.lamports=f.svm.minimum_balance_for_rent_exemption(vault.data.len());f.svm.set_account(f.vault,vault).unwrap();
    let pay=f.pay(id,0,true);assert!(!send(&mut f.svm,&f.payer,&[pay.clone()]));
    assert_eq!(f.svm.get_account(&f.cycle(id)).unwrap().data[178],0);
    f.svm.set_account(f.vault,original).unwrap();assert!(send(&mut f.svm,&f.payer,&[pay]));
}
