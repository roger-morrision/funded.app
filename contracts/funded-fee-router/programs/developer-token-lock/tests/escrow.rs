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
  let binary=std::fs::read(std::env::var("DEVELOPER_LOCK_TEST_SO").unwrap()).unwrap();
  svm.add_program(developer_token_lock::id(),&binary).unwrap();svm.airdrop(&creator.pubkey(),30_000_000_000).unwrap();
  let mut clock=svm.get_sysvar::<Clock>();clock.unix_timestamp=START;svm.set_sysvar(&clock);
  let source=get_associated_token_address_with_program_id(&creator.pubkey(),&mint,&TOKEN_ID);
  let(lock,_)=Pubkey::find_program_address(&[developer_token_lock::SEED,mint.as_ref(),creator.pubkey().as_ref()],&developer_token_lock::id());
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
 fn deposit(&self,amount:u64)->Instruction{Instruction{program_id:developer_token_lock::id(),
  accounts:developer_token_lock::accounts::InitializeAndLock{creator:self.creator.pubkey(),mint:self.mint,source:self.source,lock:self.lock,vault:self.vault,
    token_program:TOKEN_ID,associated_token_program:ATA_ID,system_program:system_program::ID}.to_account_metas(None),
  data:{let mut data=developer_token_lock::instruction::InitializeAndLock{amount}.data();data.extend_from_slice(&[1,2,3,4,5,6,7,8]);data}}}
 fn release(&self,creator:Pubkey)->Instruction{Instruction{program_id:developer_token_lock::id(),
  accounts:developer_token_lock::accounts::Release{payer:self.creator.pubkey(),creator,mint:self.mint,lock:self.lock,vault:self.vault,destination:self.source,
    token_program:TOKEN_ID,associated_token_program:ATA_ID,system_program:system_program::ID}.to_account_metas(None),data:developer_token_lock::instruction::Release{}.data()}}
 fn send(&mut self,ix:Instruction)->bool{self.svm.expire_blockhash();let message=Message::new_with_blockhash(&[ix],Some(&self.creator.pubkey()),&self.svm.latest_blockhash());
  let tx=VersionedTransaction::try_new(VersionedMessage::Legacy(message),&[&self.creator]).unwrap();self.svm.send_transaction(tx).is_ok()}
 fn clock(&mut self,time:i64){let mut clock=self.svm.get_sysvar::<Clock>();clock.unix_timestamp=time;self.svm.set_sysvar(&clock);}
 fn amount(&self,address:Pubkey)->u64{let a=self.svm.get_account(&address).unwrap();TokenAccount::unpack(&a.data[..TokenAccount::LEN]).unwrap().amount}
}

#[test]
fn exact_twelve_hour_custody_and_permissionless_fixed_beneficiary_release(){
 let mut f=Fixture::new(false,false);let before=f.amount(f.source);
 assert!(f.send(f.deposit(AMOUNT)));assert_eq!(f.amount(f.source),before-AMOUNT);assert_eq!(f.amount(f.vault),AMOUNT);
 let state=f.svm.get_account(&f.lock).unwrap().data;
 assert_eq!(i64::from_le_bytes(state[80..88].try_into().unwrap()),START);
 assert_eq!(i64::from_le_bytes(state[88..96].try_into().unwrap()),START+43_200);
 assert!(!f.send(f.release(f.creator.pubkey())));assert_eq!(f.amount(f.vault),AMOUNT);
 f.clock(START+43_199);assert!(!f.send(f.release(f.creator.pubkey())));
 assert!(!f.send(f.deposit(AMOUNT))); // Cannot reinitialize or change the original deadline.
 f.clock(START+43_200);assert!(!f.send(f.release(Pubkey::new_unique())));
 // A different fee payer may trigger release, but cannot redirect the tokens.
 let caller=Keypair::new();f.svm.airdrop(&caller.pubkey(),30_000_000).unwrap();
 let mut release=f.release(f.creator.pubkey());release.accounts[0].pubkey=caller.pubkey();f.svm.expire_blockhash();
 let message=Message::new_with_blockhash(&[release],Some(&caller.pubkey()),&f.svm.latest_blockhash());
 let tx=VersionedTransaction::try_new(VersionedMessage::Legacy(message),&[&caller]).unwrap();
 assert!(f.svm.send_transaction(tx).is_ok());assert_eq!(f.amount(f.vault),0);assert_eq!(f.amount(f.source),before);
 assert!(!f.send(f.release(f.creator.pubkey())));assert_eq!(f.amount(f.source),before);
}

#[test]
fn zero_oversized_freezable_and_permanent_delegate_mints_fail_without_deposit(){
 for (unsafe_mint,delegate,amount) in [(false,false,0),(false,false,200_000_000_000_001),(true,false,AMOUNT),(false,true,AMOUNT)] {
  let mut f=Fixture::new(unsafe_mint,delegate);let before=f.amount(f.source);
  assert!(!f.send(f.deposit(amount)));assert_eq!(f.amount(f.source),before);assert!(f.svm.get_account(&f.lock).is_none());
 }
}
