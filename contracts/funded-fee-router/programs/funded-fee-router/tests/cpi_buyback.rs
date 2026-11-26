//! Complete router -> captured external DEX/fee SBF -> SPL transfer/burn CPIs.
//! Explicit opt-in: public snapshots, synthetic policy/funding, local-only VM.
#![cfg(feature="mainnet-v3-program")]
use anchor_lang::{prelude::{Pubkey,Clock}, AccountSerialize, AccountDeserialize, InstructionData, ToAccountMetas,
    solana_program::{instruction::{Instruction,AccountMeta},program_pack::Pack,program_option::COption}};
use anchor_spl::{token::spl_token,associated_token::{get_associated_token_address_with_program_id,spl_associated_token_account}};
use litesvm::LiteSVM;
use solana_keypair_lite::Keypair;
use solana_signer_lite::Signer;
use solana_message_lite::{Message,VersionedMessage,AddressLookupTableAccount,v0};
use solana_transaction_lite::versioned::VersionedTransaction;
use serde_json::Value;
use std::{str::FromStr,path::PathBuf};
mod support;
fn pk(s:&str)->Pubkey{Pubkey::from_str(s).unwrap()}
fn hex(s:&str)->Vec<u8>{s.as_bytes().chunks_exact(2).map(|c|u8::from_str_radix(std::str::from_utf8(c).unwrap(),16).unwrap()).collect()}
fn store<T:AccountSerialize>(svm:&mut LiteSVM,address:Pubkey,value:&T){
    let mut data=vec![];value.try_serialize(&mut data).unwrap();
    svm.set_account(address,solana_account::Account{lamports:10_000_000,data,owner:funded_fee_router::id(),executable:false,rent_epoch:0}).unwrap();
}
fn send(svm:&mut LiteSVM,payer:&Keypair,signers:&[&Keypair],instructions:&[Instruction])->Result<u64,String>{
    let mut ixs=vec![Instruction::new_with_bytes(pk("ComputeBudget111111111111111111111111111111"),&[2,192,92,21,0],vec![])]; // 1,400,000 CU
    ixs.extend_from_slice(instructions);
    let msg=Message::new_with_blockhash(&ixs,Some(&payer.pubkey()),&svm.latest_blockhash());
    let message=if msg.account_keys.len()>20 {
        // A local finalized ALT models the same packet-size constraint as RPC submission.
        let address=Pubkey::new_unique();
        let addresses=msg.account_keys.iter().filter(|k|!signers.iter().any(|s|s.pubkey()==**k)).copied().collect::<Vec<_>>();
        let mut data=vec![0;56];data[..4].copy_from_slice(&1u32.to_le_bytes());data[4..12].copy_from_slice(&u64::MAX.to_le_bytes());
        for key in &addresses {data.extend_from_slice(key.as_ref());}
        svm.set_account(address,solana_account::Account{lamports:10_000_000,data,owner:pk("AddressLookupTab1e1111111111111111111111111"),executable:false,rent_epoch:0}).unwrap();
        VersionedMessage::V0(v0::Message::try_compile(&payer.pubkey(),&ixs,&[AddressLookupTableAccount{key:address,addresses}],svm.latest_blockhash()).unwrap())
    }else{VersionedMessage::Legacy(msg)};
    let tx=VersionedTransaction::try_new(message,signers).unwrap();
    let wire_size=1+64*tx.signatures.len()+tx.message.serialize().len();
    assert!(wire_size<=1232,"transaction exceeds network packet limit: {wire_size}");
    let result=svm.send_transaction(tx).map(|m|m.compute_units_consumed).map_err(|e|format!("{e:?}"));
    svm.expire_blockhash();result
}
fn amount(svm:&LiteSVM,address:Pubkey,offset:usize)->u64{u64::from_le_bytes(svm.get_account(&address).unwrap().data[offset..offset+8].try_into().unwrap())}

#[test]
#[ignore = "requires explicit public DEX snapshots; run with FUNDED_CPI_FIXTURE and --ignored"]
fn real_dex_purchase_burn_replay_and_custody(){run(false,0);}
#[test]
#[ignore = "requires explicit public DEX snapshots; run with FUNDED_CPI_FIXTURE and --ignored"]
fn agency_real_dex_purchase_burn_replay_and_custody(){run(true,0);}
#[test]
#[ignore = "requires explicit public DEX snapshots"]
fn donated_accounts_cannot_block_protected_buybacks(){run(false,1);if pool_fixture(){run(false,2);}}
#[test]
#[ignore = "requires explicit public DEX snapshots"]
fn donated_accounts_cannot_block_agency_buybacks(){run(true,1);if pool_fixture(){run(true,2);}}
#[cfg(feature="cpi-milestone-fixture-test")]
#[test]
#[ignore = "requires a public own-coin PumpSwap pool snapshot"]
fn agency_milestone_buyback_burns_own_coin_and_marks_agent_complete(){run(true,0);}
fn pool_fixture()->bool{
    let f:Value=serde_json::from_slice(&std::fs::read(PathBuf::from(std::env::var("FUNDED_CPI_FIXTURE").unwrap()).join("fixture.json")).unwrap()).unwrap();f["venue"]=="pool"
}
fn run(agency:bool,donation:u8){
    let directory=PathBuf::from(std::env::var("FUNDED_CPI_FIXTURE").expect("snapshot directory"));
    let fixture:Value=serde_json::from_slice(&std::fs::read(directory.join("fixture.json")).unwrap()).unwrap();
    let milestone=fixture["category"].as_u64()==Some(7);
    assert!(!milestone || agency && fixture["venue"]=="pool");
    let key=|field:&str|pk(fixture[field].as_str().unwrap());
    let program=funded_fee_router::id();assert_eq!(program,key("routerProgram"));
    let mut svm=LiteSVM::new();
    for account in fixture["accounts"].as_array().unwrap(){
        if account["executable"].as_bool().unwrap(){continue;}
        svm.set_account(pk(account["address"].as_str().unwrap()),solana_account::Account{
            lamports:account["lamports"].as_u64().unwrap(),data:hex(account["dataHex"].as_str().unwrap()),
            owner:pk(account["owner"].as_str().unwrap()),executable:false,rent_epoch:0}).unwrap();
    }
    for dex in fixture["programs"].as_array().unwrap(){
        let bytes=std::fs::read(directory.join(dex["file"].as_str().unwrap())).unwrap();
        assert_eq!(solana_sha256_hasher::hashv(&[&bytes]).to_bytes().iter().map(|b|format!("{b:02x}")).collect::<String>(),dex["sha256"].as_str().unwrap());
        svm.add_program(pk(dex["address"].as_str().unwrap()),&bytes).unwrap();
    }
    assert!(!fixture["programs"].as_array().unwrap().is_empty(),"never replace DEX execution with a mock");
    svm.add_program(program,&support::program_bytes()).unwrap();
    // set_account above refreshes the VM sysvar cache from captured Rent and Clock.
    let (owner,op,price)=(Keypair::new(),Keypair::new(),Keypair::new());
    for signer in [&owner,&op,&price]{svm.airdrop(&signer.pubkey(),2_000_000_000).unwrap();}
    let program_data=support::set_upgrade_owner(&mut svm,program,owner.pubkey());
    let router=Pubkey::find_program_address(&[funded_fee_router::SEED],&program).0;
    let init=Instruction::new_with_bytes(program,&funded_fee_router::instruction::Initialize {}.data(),
        funded_fee_router::accounts::Initialize{authority:op.pubkey(),app_owner:owner.pubkey(),router,program,program_data,
            system_program:anchor_lang::system_program::ID}.to_account_metas(None));
    send(&mut svm,&op,&[&op,&owner],&[init]).unwrap();
    let guard=Instruction::new_with_bytes(program,&funded_fee_router::instruction::ConfigureProtocolGuard {daily_cap_lamports:10_000_000}.data(),
        funded_fee_router::accounts::ConfigureGuard{upgrade_owner:owner.pubkey(),guardian:owner.pubkey(),legacy_router:router,program,program_data}.to_account_metas(None));
    send(&mut svm,&owner,&[&owner],&[guard]).unwrap();
    let config=Pubkey::find_program_address(&[b"rich-assets-v1"],&program).0;
    let history=Pubkey::find_program_address(&[b"rich-assets-revision-v1",&1u64.to_le_bytes()],&program).0;
    let configure=Instruction::new_with_bytes(program,&funded_fee_router::instruction::ConfigureRichAssets {revision:1,venue:if fixture["venue"]=="curve"{1}else{0}}.data(),
        funded_fee_router::accounts::ConfigureRichAssets {asset_authority:owner.pubkey(),program,program_data,config,history,
            mint:key("mint"),market:key("market"),system_program:anchor_lang::system_program::ID}.to_account_metas(None));
    send(&mut svm,&owner,&[&owner],&[configure]).unwrap();
    let source=key("sourceMint");let creator=Pubkey::new_unique();
    if milestone{assert_eq!(source,key("mint"));}
    let (policy,bump)=Pubkey::find_program_address(&[if agency{b"mint-agency-policy-v3"}else{funded_fee_router::MINT_POLICY_V3_SEED},source.as_ref()],&program);
    if agency{
        let mut paid=[0;8];paid[if milestone{7}else{6}]=1_000_000;
        store(&mut svm,policy,&funded_fee_router::MintAgencyPolicyV3{mint:source,creator,authority:op.pubkey(),protocol_units:[0;7],settled_lamports:1_000_000,
            paid_lamports:paid,withdrawn_lamports:[0;8],directed_units:[0;3],directed_released:[0;3],selected_agents:if milestone{2}else{0},agent_spent:[0;3],
            completed_agents:0,last_promotion_at:0,promotion_sequence:0,promotion_recipient:Pubkey::default(),config_revision:1,bump,
            remainder:[0;8],credit_base:[0;8],directed_ceiling:[0;3],directed_remainder:[0;3],directed_pool_base:0,
            agent_ceiling:[0;3],agent_remainder:[0;3],agent_pool_base:0});
    }else{
        let mut paid=[0;7];paid[6]=1_000_000;
        store(&mut svm,policy,&funded_fee_router::MintFeePolicyV3{mint:source,creator,authority:op.pubkey(),protocol_units:[0;6],settled_lamports:1_000_000,paid_lamports:paid,withdrawn_lamports:[0;7],bump,remainder:[0;7]});
    }
    let vault=key("vault");svm.airdrop(&vault,2_000_000).unwrap();
    let price_config=Pubkey::find_program_address(&[b"buyback-price-signer-v1"],&program).0;
    store(&mut svm,price_config,&funded_fee_router::instructions::buyback_price::BuybackPriceConfig{price_signer:price.pubkey()});
    let (token,mint,pool)=(key("tokenProgram"),key("mint"),key("market"));
    let ata=get_associated_token_address_with_program_id(&vault,&mint,&token);
    let wsol=get_associated_token_address_with_program_id(&vault,&spl_token::native_mint::id(),&spl_token::ID);
    let base_donation=if donation>0{3}else{0};
    if donation>0{
        // An unrelated payer can create canonical vault ATAs and transfer dust.
        let donor=Keypair::new();svm.airdrop(&donor.pubkey(),1_000_000_000).unwrap();
        let source_account=Pubkey::new_unique();let mut data=vec![0;spl_token::state::Account::LEN];
        spl_token::state::Account::pack(spl_token::state::Account{mint,owner:donor.pubkey(),amount:base_donation,
            delegate:COption::None,state:spl_token::state::AccountState::Initialized,is_native:COption::None,
            delegated_amount:0,close_authority:COption::None},&mut data).unwrap();
        svm.set_account(source_account,solana_account::Account{lamports:10_000_000,data,owner:token,executable:false,rent_epoch:0}).unwrap();
        let mut dust=vec![spl_associated_token_account::instruction::create_associated_token_account_idempotent(&donor.pubkey(),&vault,&mint,&token),
            anchor_spl::token_2022::spl_token_2022::instruction::transfer_checked(&token,&source_account,&mint,&ata,&donor.pubkey(),&[],base_donation,svm.get_account(&mint).unwrap().data[44]).unwrap()];
        let volume_index=if fixture["venue"]=="pool"{20}else{13};
        let volume=pk(fixture["buy"]["keys"][volume_index]["pubkey"].as_str().unwrap());
        dust.push(anchor_lang::solana_program::system_instruction::transfer(&donor.pubkey(),&volume,700_000));
        if fixture["venue"]=="pool"{
            if donation==2{dust.push(spl_associated_token_account::instruction::create_associated_token_account_idempotent(&donor.pubkey(),&vault,&spl_token::native_mint::id(),&spl_token::ID));}
            dust.push(anchor_lang::solana_program::system_instruction::transfer(&donor.pubkey(),&wsol,if donation==2{3_000_000}else{700_000}));
            if donation==2{dust.push(spl_token::instruction::sync_native(&spl_token::ID,&wsol).unwrap());}
        }
        send(&mut svm,&donor,&[&donor],&dust).unwrap();
    }
    let quote_donation=if fixture["venue"]=="pool"{svm.get_account(&wsol).map_or(0,|a|a.lamports)}else{0};
    let receipt=Pubkey::find_program_address(&[b"mint-buyback-v3",source.as_ref(),&[7;32]],&program).0;
    let mut accounts=funded_fee_router::accounts::BuybackMintV3{authority:op.pubkey(),creator,mint:source,legacy_router:router,policy,vault,
        funded_mint:mint,funded_token_account:ata,quote_token_account:wsol,pool,receipt,base_token_program:token,quote_token_program:spl_token::ID,
        associated_token_program:anchor_spl::associated_token::ID,pump_swap_program:pk(fixture["buy"]["programId"].as_str().unwrap()),
        system_program:anchor_lang::system_program::ID,price_config,price_signer:price.pubkey()}.to_account_metas(None);
    accounts[3].is_writable=true;
    let buy=fixture["buy"]["keys"].as_array().unwrap();
    for k in buy{accounts.push(AccountMeta{pubkey:pk(k["pubkey"].as_str().unwrap()),is_signer:false,is_writable:k["isWritable"].as_bool().unwrap()});}
    accounts.push(AccountMeta::new_readonly(config,false));
    let minimum:u64=fixture["minBaseAmountOut"].as_str().unwrap().parse().unwrap();
    assert!(minimum>1,"use the actual protected quote, not a one-unit placeholder");
    let clock=svm.get_sysvar::<Clock>();
    let data=if agency {funded_fee_router::instruction::BuybackConfiguredAgencyMintV3{buyback_id:[7;32],category:if milestone{7}else{6},agent:if milestone{1}else{255},
        observation_slot:if milestone{clock.slot}else{0},observed_at:if milestone{clock.unix_timestamp}else{0},
        market_cap_usd_micros:if milestone{100_000_000_000}else{0},observation_hash:if milestone{[1;32]}else{[0;32]},spendable_quote_in:1_000_000,
        min_base_amount_out:minimum,max_total_debit:1_000_000,assets_revision:1}.data()}
        else{funded_fee_router::instruction::BuybackConfiguredMintV3{buyback_id:[7;32],spendable_quote_in:1_000_000,
        min_base_amount_out:minimum,max_total_debit:1_000_000,assets_revision:1}.data()};
    let ix=Instruction::new_with_bytes(program,&data,accounts);
    let mut setup=vec![];
    if fixture["venue"]=="pool"{
        for (owner_index,ata_index) in [(9,10),(18,17),(buy.len()-2,buy.len()-1)]{
            let owner=pk(buy[owner_index]["pubkey"].as_str().unwrap());let ata=pk(buy[ata_index]["pubkey"].as_str().unwrap());
            assert_eq!(ata,get_associated_token_address_with_program_id(&owner,&spl_token::native_mint::id(),&spl_token::ID));
            setup.push(spl_associated_token_account::instruction::create_associated_token_account_idempotent(&op.pubkey(),&owner,&spl_token::native_mint::id(),&spl_token::ID));
        }
    }else{
        let creator_vault=pk(buy[9]["pubkey"].as_str().unwrap());
        let rent:u64=fixture["creatorRent"].as_str().unwrap().parse().unwrap();
        if rent>0{setup.push(anchor_lang::solana_program::system_instruction::transfer(&op.pubkey(),&creator_vault,rent));}
    }
    let before_supply=amount(&svm,mint,36);let before_vault=svm.get_account(&vault).unwrap().lamports;
    // Reject an impossible minimum through the real DEX; no partial custody or burn.
    let before_policy=svm.get_account(&policy).unwrap();let before_pool=svm.get_account(&pool).unwrap();
    let mut invalid=ix.clone();let min_offset=if agency{106}else{48};
    invalid.data[min_offset..min_offset+8].copy_from_slice(&u64::MAX.to_le_bytes());
    let mut rejected=setup.clone();rejected.push(invalid);
    assert!(send(&mut svm,&op,&[&op,&price],&rejected).is_err());
    assert_eq!(svm.get_account(&policy).unwrap(),before_policy);assert_eq!(svm.get_account(&pool).unwrap(),before_pool);
    assert_eq!(amount(&svm,mint,36),before_supply);assert_eq!(svm.get_account(&vault).unwrap().lamports,before_vault);
    assert!(svm.get_account(&receipt).is_none());
    setup.push(ix.clone());
    let compute=send(&mut svm,&op,&[&op,&price],&setup).unwrap();
    let receipt_account=svm.get_account(&receipt).unwrap();
    let (spent,burned)=if agency{let saved=funded_fee_router::AgencyBuybackV3::try_deserialize(&mut &receipt_account.data[..]).unwrap();(saved.spent_lamports,saved.burned_base_units)}
        else{let saved=funded_fee_router::MintBuybackV3::try_deserialize(&mut &receipt_account.data[..]).unwrap();(saved.spent_lamports,saved.burned_base_units)};
    assert!(burned>0&&spent>0&&spent<=1_000_000);
    assert_eq!(before_supply-amount(&svm,mint,36),burned);
    assert_eq!(before_vault+quote_donation-svm.get_account(&vault).unwrap().lamports,spent);
    assert_eq!(amount(&svm,ata,64),base_donation);assert!(svm.get_account(&wsol).is_none_or(|a|a.lamports==0));
    if milestone{
        let saved=funded_fee_router::MintAgencyPolicyV3::try_deserialize(&mut &svm.get_account(&policy).unwrap().data[..]).unwrap();
        assert_eq!(saved.completed_agents&2,2);assert_eq!(saved.agent_spent[1],spent);
        assert_eq!(saved.withdrawn_lamports[7],spent);
    }
    let final_policy=svm.get_account(&policy).unwrap();let final_vault=svm.get_account(&vault).unwrap();
    assert!(send(&mut svm,&op,&[&op,&price],&[ix]).is_err());
    assert_eq!(svm.get_account(&policy).unwrap(),final_policy);assert_eq!(svm.get_account(&vault).unwrap(),final_vault);
    println!("CPI_EVIDENCE venue={} agency={} milestone={} donation={} compute_units={} spent={} burned={} receipt={} fixture_slot={}",fixture["venue"],agency,milestone,donation,compute,spent,burned,receipt,fixture["slot"]);
}
