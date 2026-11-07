use anchor_lang::{prelude::{Clock,Pubkey}, solana_program::{instruction::Instruction, program_option::COption, program_pack::Pack, system_program}, InstructionData, ToAccountMetas};
use anchor_spl::{associated_token::{get_associated_token_address_with_program_id,ID as ATA_ID}, token_2022::{ID as TOKEN_ID,spl_token_2022::{state::{Mint,Account as TokenAccount,AccountState},extension::ExtensionType}}};
use litesvm::LiteSVM;
use solana_account::Account;
use solana_keypair_lite::Keypair;
use solana_message_lite::{Message,VersionedMessage};
use solana_signer_lite::Signer;
use solana_transaction_lite::versioned::VersionedTransaction;

const START:i64=1_700_000_000;
const AMOUNT:u64=100_000_000_000;
struct Fixture { svm:LiteSVM, creator:Keypair, mint:Pubkey,source:Pubkey,lock:Pubkey,vault:Pubkey }
impl Fixture {
 fn new(unsafe_mint:bool,delegate:bool)->Self{
  let mut svm=LiteSVM::new();let creator=Keypair::new();let mint=Pubkey::new_unique();
  let binary=std::fs::read(std::env::var("FUNDED_ROUTER_TEST_SO").unwrap()).unwrap();
  svm.add_program(funded_fee_router::id(),&binary).unwrap();svm.airdrop(&creator.pubkey(),30_000_000_000).unwrap();
  let mut clock=svm.get_sysvar::<Clock>();clock.unix_timestamp=START;svm.set_sysvar(&clock);
  let source=get_associated_token_address_with_program_id(&creator.pubkey(),&mint,&TOKEN_ID);
  let(lock,_)=Pubkey::find_program_address(&[funded_fee_router::DEVELOPER_LOCK_SEED,mint.as_ref(),creator.pubkey().as_ref()],&funded_fee_router::id());
  let vault=get_associated_token_address_with_program_id(&lock,&mint,&TOKEN_ID);
  let mut mint_data=vec![0; if delegate {202} else {Mint::LEN}];
  Mint::pack(Mint {mint_authority:COption::None,supply:1_000_000_000_000_000,decimals:6,is_initialized:true,
    freeze_authority:if unsafe_mint{COption::Some(creator.pubkey())}else{COption::None}},&mut mint_data[..Mint::LEN]).unwrap();
  if delegate {mint_data[165]=1;mint_data[166..168].copy_from_slice(&(ExtensionType::PermanentDelegate as u16).to_le_bytes());mint_data[168..170].copy_from_slice(&32u16.to_le_bytes());mint_data[170..202].copy_from_slice(creator.pubkey().as_ref());}
  svm.set_account(mint,Account{lamports:10_000_000,data:mint_data,owner:TOKEN_ID,executable:false,rent_epoch:0}).unwrap();
  let mut data=vec![0;TokenAccount::LEN];TokenAccount::pack(TokenAccount{mint,owner:creator.pubkey(),amount:500_000_000_000_000,
    delegate:COption::None,state:AccountState::Initialized,is_native:COption::None,delegated_amount:0,close_authority:COption::None},&mut data).unwrap();
  svm.set_account(source,Account{lamports:10_000_000,data,owner:TOKEN_ID,executable:false,rent_epoch:0}).unwrap();
  Self{svm,creator,mint,source,lock,vault}
 }
 fn deposit(&self,amount:u64)->Instruction{Instruction{program_id:funded_fee_router::id(),
  accounts:funded_fee_router::accounts::InitializeAndLock{creator:self.creator.pubkey(),mint:self.mint,source:self.source,lock:self.lock,vault:self.vault,
    token_program:TOKEN_ID,associated_token_program:ATA_ID,system_program:system_program::ID}.to_account_metas(None),
  data:{let mut data=funded_fee_router::instruction::InitializeAndLock{amount}.data();data.extend_from_slice(&[1,2,3,4,5,6,7,8]);data}}}
 fn release(&self,creator:Pubkey)->Instruction{Instruction{program_id:funded_fee_router::id(),
  accounts:funded_fee_router::accounts::Release{payer:self.creator.pubkey(),creator,mint:self.mint,lock:self.lock,vault:self.vault,destination:self.source,
    token_program:TOKEN_ID,associated_token_program:ATA_ID,system_program:system_program::ID}.to_account_metas(None),data:funded_fee_router::instruction::Release{}.data()}}
 fn setup(&self,owner:Pubkey)->Instruction {
  anchor_spl::associated_token::spl_associated_token_account::instruction::create_associated_token_account_idempotent(
   &self.creator.pubkey(),&owner,&self.mint,&TOKEN_ID)
 }
 fn send(&mut self,ix:Instruction)->Result<(),String>{
  let owner=if ix.data[..8]==(funded_fee_router::instruction::InitializeAndLock{amount:0}).data()[..8] {self.lock} else {self.creator.pubkey()};
  self.send_all(&[self.setup(owner),ix])
 }
 fn send_all(&mut self,instructions:&[Instruction])->Result<(),String>{self.svm.expire_blockhash();let message=Message::new_with_blockhash(instructions,Some(&self.creator.pubkey()),&self.svm.latest_blockhash());
  let tx=VersionedTransaction::try_new(VersionedMessage::Legacy(message),&[&self.creator]).unwrap();
  self.svm.send_transaction(tx).map(|_| ()).map_err(|error| format!("{:?}\n{}",error.err,error.meta.logs.join("\n")))}
 fn clock(&mut self,time:i64){let mut clock=self.svm.get_sysvar::<Clock>();clock.unix_timestamp=time;self.svm.set_sysvar(&clock);}
 fn amount(&self,address:Pubkey)->u64{let a=self.svm.get_account(&address).unwrap();TokenAccount::unpack(&a.data[..TokenAccount::LEN]).unwrap().amount}
}

#[test]
fn exact_twelve_hour_custody_and_permissionless_fixed_beneficiary_release(){
 let mut f=Fixture::new(false,false);let before=f.amount(f.source);
 f.send(f.deposit(AMOUNT)).unwrap();assert_eq!(f.amount(f.source),before-AMOUNT);assert_eq!(f.amount(f.vault),AMOUNT);
 let state=f.svm.get_account(&f.lock).unwrap().data;
 assert_eq!(i64::from_le_bytes(state[80..88].try_into().unwrap()),START);
 assert_eq!(i64::from_le_bytes(state[88..96].try_into().unwrap()),START+43_200);
 assert!(f.send(f.release(f.creator.pubkey())).unwrap_err().contains("Error Code: StillLocked"));assert_eq!(f.amount(f.vault),AMOUNT);
 f.clock(START+43_199);assert!(f.send(f.release(f.creator.pubkey())).unwrap_err().contains("Error Code: StillLocked"));
 assert!(f.send(f.deposit(AMOUNT)).is_err()); // Cannot reinitialize or change the original deadline.
 f.clock(START+43_200);assert!(f.send(f.release(Pubkey::new_unique())).unwrap_err().contains("ConstraintSeeds"));
 // A different fee payer may trigger release, but cannot redirect the tokens.
 let caller=Keypair::new();f.svm.airdrop(&caller.pubkey(),30_000_000).unwrap();
 let mut release=f.release(f.creator.pubkey());release.accounts[0].pubkey=caller.pubkey();f.svm.expire_blockhash();
 let message=Message::new_with_blockhash(&[release],Some(&caller.pubkey()),&f.svm.latest_blockhash());
 let tx=VersionedTransaction::try_new(VersionedMessage::Legacy(message),&[&caller]).unwrap();
 assert!(f.svm.send_transaction(tx).is_ok());assert_eq!(f.amount(f.vault),0);assert_eq!(f.amount(f.source),before);
 assert!(f.send(f.release(f.creator.pubkey())).unwrap_err().contains("Error Code: AlreadyReleased"));assert_eq!(f.amount(f.source),before);
}

#[test]
fn zero_oversized_freezable_and_permanent_delegate_mints_fail_without_deposit(){
 for (unsafe_mint,delegate,amount) in [(false,false,0),(false,false,200_000_000_000_001),(true,false,AMOUNT),(false,true,AMOUNT)] {
  let mut f=Fixture::new(unsafe_mint,delegate);let before=f.amount(f.source);
  let expected = if unsafe_mint || delegate { "Error Code: UnsafeMint" } else { "Error Code: InvalidAmount" };
  let error = f.send(f.deposit(amount)).unwrap_err();
  assert!(error.contains(expected), "Unexpected rejection: {error}");
  assert_eq!(f.amount(f.source),before);assert!(f.svm.get_account(&f.lock).is_none());
  assert!(f.svm.get_account(&f.vault).is_none(), "ATA creation must roll back with a rejected deposit");
 }
}

#[test]
fn app_setup_is_required_idempotent_and_cannot_redirect_custody() {
 let mut f=Fixture::new(false,false);
 let before=f.amount(f.source);
 assert!(f.send_all(&[f.deposit(AMOUNT)]).unwrap_err().contains("AccountNotInitialized"));
 assert!(f.svm.get_account(&f.lock).is_none());
 f.send_all(&[f.setup(f.lock)]).unwrap();
 let clean=f.svm.get_account(&f.vault).unwrap();
 for mode in 0..4 {
  let mut forged=clean.clone();
  let mut token=TokenAccount::unpack(&forged.data[..TokenAccount::LEN]).unwrap();
  match mode {
   0=>token.owner=Pubkey::new_unique(),
   1=>token.mint=Pubkey::new_unique(),
   2=>token.delegate=COption::Some(Pubkey::new_unique()),
   _=>token.close_authority=COption::Some(Pubkey::new_unique()),
  }
  TokenAccount::pack(token,&mut forged.data[..TokenAccount::LEN]).unwrap();
  f.svm.set_account(f.vault,forged).unwrap();
  assert!(f.send_all(&[f.deposit(AMOUNT)]).is_err());
  assert!(f.svm.get_account(&f.lock).is_none());assert_eq!(f.amount(f.source),before);
 }
 f.svm.set_account(f.vault,clean).unwrap();
 let alternate=Pubkey::new_unique();
 f.svm.set_account(alternate,f.svm.get_account(&f.vault).unwrap()).unwrap();
 let mut redirected=f.deposit(AMOUNT);redirected.accounts[4].pubkey=alternate;
 assert!(f.send_all(&[redirected]).is_err());
 assert!(f.svm.get_account(&f.lock).is_none());assert_eq!(f.amount(f.source),before);
 f.send(f.deposit(AMOUNT)).unwrap(); // Pre-existing ATA: idempotent setup still works.
 assert_eq!(f.amount(f.vault),AMOUNT);
}

#[test]
fn app_recreates_closed_destination_and_release_failure_rolls_back() {
 let mut f=Fixture::new(false,false);
 f.send(f.deposit(AMOUNT)).unwrap();
 // Model the creator closing its now-empty ATA while the escrow is locked.
 f.svm.set_account(f.source,Account::default()).unwrap();
 assert!(f.send(f.release(f.creator.pubkey())).unwrap_err().contains("StillLocked"));
 assert!(f.svm.get_account(&f.source).map_or(true,|a|a.data.is_empty()));
 assert_eq!(f.amount(f.vault),AMOUNT);
 f.clock(START+43_200);
 f.send(f.release(f.creator.pubkey())).unwrap();
 assert_eq!(f.amount(f.vault),0);assert_eq!(f.amount(f.source),AMOUNT);
}

#[test]
fn merged_router_does_not_take_over_legacy_locks_and_legacy_release_still_works() {
 let mut f=Fixture::new(false,false);
 let legacy:Pubkey="EPywNBhXu8QEeukKfwKwo7WPBw6KoSbUGyKgcMFPH9pT".parse().unwrap();
 let binary=std::fs::read(std::env::var("LEGACY_DEVELOPER_LOCK_TEST_SO").unwrap()).unwrap();
 f.svm.add_program(legacy,&binary).unwrap();
 let(lock,_)=Pubkey::find_program_address(&[funded_fee_router::DEVELOPER_LOCK_SEED,f.mint.as_ref(),f.creator.pubkey().as_ref()],&legacy);
 assert_ne!(lock,f.lock);
 let vault=get_associated_token_address_with_program_id(&lock,&f.mint,&TOKEN_ID);
 let before=f.amount(f.source);
 let mut deposit=f.deposit(AMOUNT);deposit.program_id=legacy;deposit.accounts[3].pubkey=lock;deposit.accounts[4].pubkey=vault;
 f.send_all(&[f.setup(lock),deposit]).unwrap();
 f.send(f.deposit(AMOUNT)).unwrap();
 assert_eq!(f.amount(vault),AMOUNT);assert_eq!(f.amount(f.vault),AMOUNT);
 f.clock(START+43_200);
 let mut release=f.release(f.creator.pubkey());release.accounts[3].pubkey=lock;release.accounts[4].pubkey=vault;
 assert!(f.send_all(&[release.clone()]).is_err()); // Router cannot own or sign the old escrow PDA.
 assert_eq!(f.amount(vault),AMOUNT);
 release.program_id=legacy;f.send_all(&[release]).unwrap();
 assert_eq!(f.amount(vault),0);assert_eq!(f.amount(f.vault),AMOUNT);
 f.send(f.release(f.creator.pubkey())).unwrap();assert_eq!(f.amount(f.source),before);
}
