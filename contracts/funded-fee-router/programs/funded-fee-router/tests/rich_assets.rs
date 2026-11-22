//! Synthetic accounts, real compiled Mainnet-feature bytecode. No network funds.
#![cfg(feature = "configurable-rich-assets")]
use anchor_lang::{prelude::Pubkey, AccountDeserialize, AccountSerialize, InstructionData, ToAccountMetas,
    solana_program::{instruction::{Instruction, AccountMeta}, program_pack::Pack, program_option::COption}};
use anchor_spl::token::spl_token;
use funded_fee_router::instructions::rich_assets::{RichAssetConfig, RICH_ASSETS_SEED, RICH_REVISION_SEED, PUMP_SWAP};
use litesvm::LiteSVM;
use solana_keypair_lite::Keypair;
use solana_signer_lite::Signer;
use solana_message_lite::{Message,VersionedMessage};
use solana_transaction_lite::versioned::VersionedTransaction;
mod support;
#[path = "rich_assets/holder_reward.rs"]
mod holder_reward;
#[path = "rich_assets/token_reward.rs"]
mod token_reward;

fn send(svm: &mut LiteSVM, payer: &Keypair, signers: &[&Keypair], ix: Instruction) -> Result<(),String> {
    let message=Message::new_with_blockhash(&[ix],Some(&payer.pubkey()),&svm.latest_blockhash());
    let tx=VersionedTransaction::try_new(VersionedMessage::Legacy(message),signers).unwrap();
    let result=svm.send_transaction(tx).map(|_|()).map_err(|e|format!("{e:?}"));
    svm.expire_blockhash();result
}
fn store(svm:&mut LiteSVM, address:Pubkey, owner:Pubkey, data:Vec<u8>){
    svm.set_account(address,solana_account::Account {lamports:10_000_000,data,owner,executable:false,rent_epoch:0}).unwrap();
}
fn asset(svm:&mut LiteSVM)->(Pubkey,Pubkey){
    let mint=Pubkey::new_unique();let pool=Pubkey::new_unique();
    let mut data=vec![0;spl_token::state::Mint::LEN];
    spl_token::state::Mint::pack(spl_token::state::Mint {mint_authority:COption::None,supply:1_000_000_000,
        decimals:6,is_initialized:true,freeze_authority:COption::None},&mut data).unwrap();
    store(svm,mint,spl_token::ID,data);
    let mut data=vec![0;245];data[..8].copy_from_slice(&[241,154,109,4,17,177,109,188]);
    data[43..75].copy_from_slice(mint.as_ref());data[75..107].copy_from_slice(spl_token::native_mint::id().as_ref());
    store(svm,pool,PUMP_SWAP,data);(mint,pool)
}
fn config_address()->Pubkey{Pubkey::find_program_address(&[RICH_ASSETS_SEED],&funded_fee_router::id()).0}
fn history(revision:u64)->Pubkey{Pubkey::find_program_address(&[RICH_REVISION_SEED,&revision.to_le_bytes()],&funded_fee_router::id()).0}
fn configure(owner:Pubkey,program_data:Pubkey,mint:Pubkey,market:Pubkey,revision:u64,venue:u8)->Instruction{
    Instruction::new_with_bytes(funded_fee_router::id(),&funded_fee_router::instruction::ConfigureRichAssets {revision,venue}.data(),
        funded_fee_router::accounts::ConfigureRichAssets {asset_authority:owner,program:funded_fee_router::id(),program_data,
            config:config_address(),history:history(revision),mint,market,system_program:anchor_lang::system_program::ID}.to_account_metas(None))
}
fn fixture()->(LiteSVM,Keypair,Pubkey){
    let mut svm=LiteSVM::new();svm.add_program(funded_fee_router::id(),&support::program_bytes()).unwrap();
    let owner=Keypair::new();svm.airdrop(&owner.pubkey(),1_000_000_000).unwrap();
    let data=support::set_upgrade_owner(&mut svm,funded_fee_router::id(),owner.pubkey());(svm,owner,data)
}

#[test]
fn asset_admin_can_rotate_after_immutability_and_handoff_preserves_history(){
    let (mut svm,owner,program_data)=fixture();let (mint,pool)=asset(&mut svm);
    let stranger=Keypair::new();svm.airdrop(&stranger.pubkey(),100_000_000).unwrap();
    assert!(send(&mut svm,&stranger,&[&stranger],configure(stranger.pubkey(),program_data,mint,pool,1,0)).is_err());
    assert!(svm.get_account(&config_address()).is_none());
    let fake=Pubkey::new_unique();svm.set_account(fake,svm.get_account(&program_data).unwrap()).unwrap();
    assert!(send(&mut svm,&owner,&[&owner],configure(owner.pubkey(),fake,mint,pool,1,0)).is_err());
    let binary=svm.get_account(&program_data).unwrap();
    send(&mut svm,&owner,&[&owner],configure(owner.pubkey(),program_data,mint,pool,1,0)).unwrap();
    let first=svm.get_account(&history(1)).unwrap();
    assert_eq!(first.data,svm.get_account(&config_address()).unwrap().data);
    let (second,second_pool)=asset(&mut svm);
    for revision in [1,3] {
        assert!(send(&mut svm,&owner,&[&owner],configure(owner.pubkey(),program_data,second,second_pool,revision,0)).is_err());
        assert_eq!(first.data,svm.get_account(&config_address()).unwrap().data);
    }
    send(&mut svm,&owner,&[&owner],configure(owner.pubkey(),program_data,second,second_pool,2,0)).unwrap();
    let saved=RichAssetConfig::try_deserialize(&mut &svm.get_account(&config_address()).unwrap().data[..]).unwrap();
    assert_eq!((saved.mint,saved.market,saved.revision),(second,second_pool,2));
    assert_eq!(svm.get_account(&history(1)).unwrap(),first);
    assert_eq!(svm.get_account(&program_data).unwrap(),binary,"rotation must not change deployed bytecode");
    // Freezing code upgrades does not freeze independently administered assets.
    let mut immutable=svm.get_account(&program_data).unwrap();
    immutable.data[12]=0;
    svm.set_account(program_data,immutable).unwrap();
    send(&mut svm,&owner,&[&owner],configure(owner.pubkey(),program_data,mint,pool,3,0)).unwrap();
    let manage=|authority|funded_fee_router::accounts::ManageRichAuthority {authority,config:config_address()}.to_account_metas(None);
    let accept=|authority|Instruction::new_with_bytes(funded_fee_router::id(),&funded_fee_router::instruction::AcceptRichAuthority {}.data(),manage(authority));
    assert!(send(&mut svm,&stranger,&[&stranger],accept(stranger.pubkey())).is_err());
    let propose=|successor|Instruction::new_with_bytes(funded_fee_router::id(),&funded_fee_router::instruction::ProposeRichAuthority {successor}.data(),manage(owner.pubkey()));
    assert!(send(&mut svm,&owner,&[&owner],propose(Pubkey::default())).is_err());
    send(&mut svm,&owner,&[&owner],propose(stranger.pubkey())).unwrap();
    send(&mut svm,&owner,&[&owner],propose(owner.pubkey())).unwrap();
    assert!(send(&mut svm,&stranger,&[&stranger],accept(stranger.pubkey())).is_err(),"cancelled successor cannot accept");
    send(&mut svm,&owner,&[&owner],propose(stranger.pubkey())).unwrap();
    assert!(send(&mut svm,&stranger,&[&stranger],configure(stranger.pubkey(),program_data,mint,pool,4,0)).is_err());
    // The current administrator may still rotate the asset while acceptance is pending.
    send(&mut svm, &owner, &[&owner], configure(owner.pubkey(), program_data, second, second_pool, 4, 0)).unwrap();
    let revision_four = svm.get_account(&history(4)).unwrap();
    let pending = RichAssetConfig::try_deserialize(&mut revision_four.data.as_slice()).unwrap();
    assert_eq!((pending.authority, pending.pending_authority), (owner.pubkey(), stranger.pubkey()));
    assert_eq!((pending.mint, pending.market, pending.revision), (second, second_pool, 4));
    let before_handoff = svm.get_account(&config_address()).unwrap();
    assert_eq!(before_handoff.data, revision_four.data);
    send(&mut svm,&stranger,&[&stranger],accept(stranger.pubkey())).unwrap();
    let after_handoff = svm.get_account(&config_address()).unwrap();
    let mut expected = pending;
    expected.authority = stranger.pubkey();
    expected.pending_authority = Pubkey::default();
    let mut expected_data = Vec::new();
    expected.try_serialize(&mut expected_data).unwrap();
    assert_eq!(after_handoff.data, expected_data);
    assert_eq!(after_handoff.lamports, before_handoff.lamports);
    assert_eq!(svm.get_account(&history(4)).unwrap(), revision_four);
    assert!(send(&mut svm,&owner,&[&owner],configure(owner.pubkey(),program_data,mint,pool,5,0)).is_err());
    assert!(svm.get_account(&history(5)).is_none());
    send(&mut svm,&stranger,&[&stranger],configure(stranger.pubkey(),program_data,mint,pool,5,0)).unwrap();
    assert_eq!(svm.get_account(&history(1)).unwrap(),first);

}

#[test]
fn unsupported_markets_and_forged_mints_roll_back_configuration(){
    let (mut svm,owner,program_data)=fixture();let (mint,pool)=asset(&mut svm);
    let valid=svm.get_account(&pool).unwrap();
    for offset in [0,43,75,243,244] {
        let mut bad=valid.clone();bad.data[offset]^=1;svm.set_account(pool,bad).unwrap();
        assert!(send(&mut svm,&owner,&[&owner],configure(owner.pubkey(),program_data,mint,pool,1,0)).is_err());
        assert!(svm.get_account(&config_address()).is_none());assert!(svm.get_account(&history(1)).is_none());
    }
    let mut wrong_owner=valid.clone();wrong_owner.owner=anchor_lang::system_program::ID;svm.set_account(pool,wrong_owner).unwrap();
    assert!(send(&mut svm,&owner,&[&owner],configure(owner.pubkey(),program_data,mint,pool,1,0)).is_err());
    svm.set_account(pool,valid).unwrap();
    for venue in [1,2,255]{assert!(send(&mut svm,&owner,&[&owner],configure(owner.pubkey(),program_data,mint,pool,1,venue)).is_err());}
    let mut bad_mint=svm.get_account(&mint).unwrap();bad_mint.owner=anchor_lang::system_program::ID;svm.set_account(mint,bad_mint).unwrap();
    assert!(send(&mut svm,&owner,&[&owner],configure(owner.pubkey(),program_data,mint,pool,1,0)).is_err());
}

#[test]
fn curve_configuration_requires_canonical_live_sol_curve(){
    let (mut svm,owner,program_data)=fixture();let (mint,_)=asset(&mut svm);
    let pump=funded_fee_router::instructions::buyback_curve_v3::PUMP;
    let curve=Pubkey::find_program_address(&[b"bonding-curve",mint.as_ref()],&pump).0;
    let mut data=vec![0;115];data[..8].copy_from_slice(&[23,183,248,55,96,216,172,96]);
    store(&mut svm,curve,pump,data.clone());
    send(&mut svm,&owner,&[&owner],configure(owner.pubkey(),program_data,mint,curve,1,1)).unwrap();
    for offset in [48,81,82,83] {
        let mut bad=data.clone();bad[offset]=1;store(&mut svm,curve,pump,bad);
        assert!(send(&mut svm,&owner,&[&owner],configure(owner.pubkey(),program_data,mint,curve,2,1)).is_err());
    }
}

#[test]
fn queued_orders_reject_stale_revision_even_after_switching_back(){
    let (mut svm,owner,program_data)=fixture();let (mint,pool)=asset(&mut svm);let id=funded_fee_router::id();
    let operator=Keypair::new();let price=Keypair::new();svm.airdrop(&operator.pubkey(),1_000_000_000).unwrap();
    let router=Pubkey::find_program_address(&[b"funded-fee-router-v1"],&id).0;
    send(&mut svm,&operator,&[&operator,&owner],Instruction::new_with_bytes(id,&funded_fee_router::instruction::Initialize {}.data(),
        funded_fee_router::accounts::Initialize {authority:operator.pubkey(),app_owner:owner.pubkey(),router,program:id,program_data,
            system_program:anchor_lang::system_program::ID}.to_account_metas(None))).unwrap();
    send(&mut svm,&owner,&[&owner],configure(owner.pubkey(),program_data,mint,pool,1,0)).unwrap();
    let (other,other_pool)=asset(&mut svm);
    send(&mut svm,&owner,&[&owner],configure(owner.pubkey(),program_data,other,other_pool,2,0)).unwrap();
    send(&mut svm,&owner,&[&owner],configure(owner.pubkey(),program_data,mint,pool,3,0)).unwrap();
    let source=Pubkey::new_unique();let creator=Pubkey::new_unique();
    let (policy,bump_actual)=Pubkey::find_program_address(&[funded_fee_router::MINT_POLICY_V3_SEED,source.as_ref()],&id);
    let mut data=Vec::new();funded_fee_router::MintFeePolicyV3 {mint:source,creator,authority:operator.pubkey(),protocol_units:[0;6],
        settled_lamports:1_000_000,paid_lamports:[1_000_000;7],withdrawn_lamports:[0;7],bump:bump_actual}.try_serialize(&mut data).unwrap();
    store(&mut svm,policy,id,data);
    let vault=Pubkey::find_program_address(&[funded_fee_router::MINT_VAULT_V3_SEED,source.as_ref(),&[6]],&id).0;
    let price_config=Pubkey::find_program_address(&[b"buyback-price-signer-v1"],&id).0;
    let mut data=Vec::new();funded_fee_router::instructions::buyback_price::BuybackPriceConfig {price_signer:price.pubkey()}.try_serialize(&mut data).unwrap();
    store(&mut svm,price_config,id,data);
    let receipt=Pubkey::find_program_address(&[b"mint-buyback-v3",source.as_ref(),&[7;32]],&id).0;
    let mut accounts=funded_fee_router::accounts::BuybackMintV3 {authority:operator.pubkey(),creator,mint:source,legacy_router:router,policy,vault,
        funded_mint:mint,funded_token_account:Pubkey::new_unique(),quote_token_account:Pubkey::new_unique(),pool,receipt,
        base_token_program:spl_token::ID,quote_token_program:spl_token::ID,associated_token_program:anchor_spl::associated_token::ID,
        pump_swap_program:PUMP_SWAP,system_program:anchor_lang::system_program::ID,price_config,price_signer:price.pubkey()}.to_account_metas(None);
    accounts.push(AccountMeta::new_readonly(config_address(),false));
    let ix=|revision|Instruction::new_with_bytes(id,&funded_fee_router::instruction::BuybackConfiguredMintV3 {buyback_id:[7;32],
        spendable_quote_in:10_000,min_base_amount_out:1,max_total_debit:10_000,assets_revision:revision}.data(),accounts.clone());
    let before=svm.get_account(&policy).unwrap();
    let stale=send(&mut svm,&operator,&[&operator,&price],ix(1)).unwrap_err();
    assert!(stale.contains("StaleRevision"),"{stale}");
    assert_eq!(svm.get_account(&policy).unwrap(),before);assert!(svm.get_account(&receipt).is_none());
    let current=send(&mut svm,&operator,&[&operator,&price],ix(3)).unwrap_err();
    assert!(!current.contains("StaleRevision"),"current revision must reach subsequent custody checks");
}

#[test]
fn legacy_buyback_cannot_bypass_configured_assets(){
    let (mut svm,owner,_)=fixture();
    for name in ["buyback_mint_v3","buyback_agency_mint_v3"] {
        let hash=solana_sha256_hasher::hashv(&[format!("global:{name}").as_bytes()]).to_bytes();
        let error=send(&mut svm,&owner,&[&owner],Instruction::new_with_bytes(funded_fee_router::id(),&hash[..8],vec![])).unwrap_err();
        assert!(error.contains("Custom(101)"),"legacy instruction must be absent: {error}");
    }
}
