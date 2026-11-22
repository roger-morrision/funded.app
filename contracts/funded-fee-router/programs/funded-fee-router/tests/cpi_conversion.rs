//! Real captured PumpSwap CPI with synthetic paired-fee custody in LiteSVM.
//! Opt in with a public fixture and a test-only binary containing its pool.
#![cfg(feature = "mainnet-v3-program")]
use anchor_lang::{prelude::{Pubkey,Rent}, AccountDeserialize, AccountSerialize, InstructionData, ToAccountMetas,
    solana_program::{instruction::{AccountMeta, Instruction}, program_option::COption, program_pack::Pack}};
use anchor_spl::{associated_token::{get_associated_token_address_with_program_id,spl_associated_token_account}, token::spl_token};
use litesvm::LiteSVM;
use serde_json::Value;
use solana_keypair_lite::Keypair;
use solana_message_lite::{v0,AddressLookupTableAccount,Message,VersionedMessage};
use solana_signer_lite::Signer;
use solana_transaction_lite::versioned::VersionedTransaction;
use std::{path::PathBuf,str::FromStr};
mod support;

fn pk(s:&str)->Pubkey{Pubkey::from_str(s).unwrap()}
fn hex(s:&str)->Vec<u8>{s.as_bytes().chunks_exact(2).map(|c|u8::from_str_radix(std::str::from_utf8(c).unwrap(),16).unwrap()).collect()}
fn store<T:AccountSerialize>(svm:&mut LiteSVM,address:Pubkey,value:&T){
    let mut data=vec![];value.try_serialize(&mut data).unwrap();
    svm.set_account(address,solana_account::Account{lamports:10_000_000,data,owner:funded_fee_router::id(),executable:false,rent_epoch:0}).unwrap();
}
fn send(svm:&mut LiteSVM,payer:&Keypair,signers:&[&Keypair],instructions:&[Instruction])->Result<u64,String>{
    let mut ixs=vec![Instruction::new_with_bytes(pk("ComputeBudget111111111111111111111111111111"),&[2,192,92,21,0],vec![])];
    ixs.extend_from_slice(instructions);
    let msg=Message::new_with_blockhash(&ixs,Some(&payer.pubkey()),&svm.latest_blockhash());
    let message=if msg.account_keys.len()>20{
        let address=Pubkey::new_unique();
        let addresses=msg.account_keys.iter().filter(|k|!signers.iter().any(|s|s.pubkey()==**k)).copied().collect::<Vec<_>>();
        let mut data=vec![0;56];data[..4].copy_from_slice(&1u32.to_le_bytes());data[4..12].copy_from_slice(&u64::MAX.to_le_bytes());
        for key in &addresses{data.extend_from_slice(key.as_ref());}
        svm.set_account(address,solana_account::Account{lamports:10_000_000,data,owner:pk("AddressLookupTab1e1111111111111111111111111"),executable:false,rent_epoch:0}).unwrap();
        VersionedMessage::V0(v0::Message::try_compile(&payer.pubkey(),&ixs,&[AddressLookupTableAccount{key:address,addresses}],svm.latest_blockhash()).unwrap())
    }else{VersionedMessage::Legacy(msg)};
    let tx=VersionedTransaction::try_new(message,signers).unwrap();
    let wire_size=1+64*tx.signatures.len()+tx.message.serialize().len();
    assert!(wire_size<=1232,"transaction exceeds network packet limit: {wire_size}");
    let result=svm.send_transaction(tx).map(|m|m.compute_units_consumed).map_err(|e|format!("{e:?}"));
    svm.expire_blockhash();result
}
fn token_amount(svm:&LiteSVM,address:Pubkey)->u64{
    u64::from_le_bytes(svm.get_account(&address).unwrap().data[64..72].try_into().unwrap())
}

#[test]
#[ignore = "requires finalized public USDC/WSOL pool snapshot and test-only conversion binary"]
fn paired_token_to_sol_reconciles_dex_custody_and_rejects_replay(){
    let directory=PathBuf::from(std::env::var("FUNDED_CPI_FIXTURE").expect("snapshot directory"));
    let fixture:Value=serde_json::from_slice(&std::fs::read(directory.join("fixture.json")).unwrap()).unwrap();
    let key=|field:&str|pk(fixture[field].as_str().unwrap());
    let program=funded_fee_router::id();
    assert_eq!(program,key("routerProgram"));
    assert_eq!(fixture["venue"],"pool");assert_eq!(fixture["category"],5);
    assert_eq!(key("mint"),spl_token::native_mint::id());
    let quote=pk("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");
    assert_eq!(pk(fixture["buy"]["keys"][4]["pubkey"].as_str().unwrap()),quote);
    let mut svm=LiteSVM::new();
    for account in fixture["accounts"].as_array().unwrap(){
        if account["executable"].as_bool().unwrap(){continue;}
        svm.set_account(pk(account["address"].as_str().unwrap()),solana_account::Account{
            lamports:account["lamports"].as_u64().unwrap(),data:hex(account["dataHex"].as_str().unwrap()),
            owner:pk(account["owner"].as_str().unwrap()),executable:false,rent_epoch:0}).unwrap();
    }
    for dex in fixture["programs"].as_array().unwrap(){
        let bytes=std::fs::read(directory.join(dex["file"].as_str().unwrap())).unwrap();
        let hash=solana_sha256_hasher::hashv(&[&bytes]).to_bytes().iter().map(|b|format!("{b:02x}")).collect::<String>();
        assert_eq!(hash,dex["sha256"].as_str().unwrap());
        svm.add_program(pk(dex["address"].as_str().unwrap()),&bytes).unwrap();
    }
    assert!(!fixture["programs"].as_array().unwrap().is_empty());
    svm.add_program(program,&support::program_bytes()).unwrap();
    let (owner,operator,price)=(Keypair::new(),Keypair::new(),Keypair::new());
    for signer in [&owner,&operator,&price]{svm.airdrop(&signer.pubkey(),2_000_000_000).unwrap();}
    let program_data=support::set_upgrade_owner(&mut svm,program,owner.pubkey());
    let router=Pubkey::find_program_address(&[funded_fee_router::SEED],&program).0;
    let initialize=Instruction::new_with_bytes(program,&funded_fee_router::instruction::Initialize{}.data(),
        funded_fee_router::accounts::Initialize{authority:operator.pubkey(),app_owner:owner.pubkey(),router,program,program_data,
            system_program:anchor_lang::system_program::ID}.to_account_metas(None));
    send(&mut svm,&operator,&[&operator,&owner],&[initialize]).unwrap();
    let source=key("sourceMint");let vault=key("vault");let creator=Pubkey::new_unique();
    let (policy,policy_bump)=Pubkey::find_program_address(&[b"mint-agency-policy-v3",source.as_ref()],&program);
    store(&mut svm,policy,&funded_fee_router::MintAgencyPolicyV3{
        mint:source,creator,authority:operator.pubkey(),protocol_units:[0;7],settled_lamports:0,
        paid_lamports:[0;8],withdrawn_lamports:[0;8],directed_units:[0;3],directed_released:[0;3],
        selected_agents:0,agent_spent:[0;3],completed_agents:0,last_promotion_at:0,promotion_sequence:0,
        promotion_recipient:Pubkey::default(),config_revision:1,bump:policy_bump});
    let (ledger,ledger_bump)=Pubkey::find_program_address(&[funded_fee_router::MINT_TOKEN_LEDGER_V3_SEED,source.as_ref(),quote.as_ref()],&program);
    let mut paid=[0;8];paid[5]=1_000_000;
    store(&mut svm,ledger,&funded_fee_router::MintTokenLedgerV3{
        mint:source,quote_mint:quote,settled:1_000_000,paid,withdrawn:[0;8],released:[0;3],bump:ledger_bump});
    let quote_ata=get_associated_token_address_with_program_id(&vault,&quote,&spl_token::ID);
    let wsol_ata=get_associated_token_address_with_program_id(&vault,&spl_token::native_mint::id(),&spl_token::ID);
    let mut token_data=vec![0;spl_token::state::Account::LEN];
    spl_token::state::Account::pack(spl_token::state::Account{
        mint:quote,owner:vault,amount:1_000_000,delegate:COption::None,state:spl_token::state::AccountState::Initialized,
        is_native:COption::None,delegated_amount:0,close_authority:COption::None},&mut token_data).unwrap();
    svm.set_account(quote_ata,solana_account::Account{
        lamports:10_000_000,data:token_data,owner:spl_token::ID,executable:false,rent_epoch:0}).unwrap();
    let price_config=Pubkey::find_program_address(&[b"buyback-price-signer-v1"],&program).0;
    store(&mut svm,price_config,&funded_fee_router::instructions::buyback_price::BuybackPriceConfig{price_signer:price.pubkey()});
    let credit=Pubkey::find_program_address(&[funded_fee_router::MINT_SOL_CREDIT_V3_SEED,source.as_ref()],&program).0;
    let conversion_id=[8;32];
    let receipt=Pubkey::find_program_address(&[funded_fee_router::MINT_TOKEN_CONVERSION_V3_SEED,source.as_ref(),&conversion_id],&program).0;
    let pool=key("market");
    let mut accounts=funded_fee_router::accounts::ConvertTokenBudgetV3{
        authority:operator.pubkey(),mint:source,quote_mint:quote,legacy_router:router,policy,ledger,vault,
        vault_token:quote_ata,wsol_token:wsol_ata,credit,receipt,token_program:spl_token::ID,
        quote_token_program:spl_token::ID,associated_token_program:anchor_spl::associated_token::ID,
        pump_swap_program:pk("pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA"),
        system_program:anchor_lang::system_program::ID}.to_account_metas(None);
    let buy=fixture["buy"]["keys"].as_array().unwrap();
    for account in buy{accounts.push(AccountMeta{
        pubkey:pk(account["pubkey"].as_str().unwrap()),is_signer:false,is_writable:account["isWritable"].as_bool().unwrap()});}
    accounts.push(AccountMeta::new_readonly(price_config,false));
    accounts.push(AccountMeta::new_readonly(price.pubkey(),true));
    let min_out:u64=fixture["minBaseAmountOut"].as_str().unwrap().parse().unwrap();
    assert!(min_out>1);
    let ix=Instruction::new_with_bytes(program,&funded_fee_router::instruction::ConvertTokenBudgetV3{
        conversion_id,category:5,amount_in:1_000_000,min_sol_out:min_out}.data(),accounts);
    // The public pool's fee recipients need their quote-token ATAs, not synthetic DEX state.
    let mut setup=vec![];
    for (owner_index,ata_index) in [(9,10),(18,17),(buy.len()-2,buy.len()-1)]{
        let fee_owner=pk(buy[owner_index]["pubkey"].as_str().unwrap());
        let fee_ata=pk(buy[ata_index]["pubkey"].as_str().unwrap());
        assert_eq!(fee_ata,get_associated_token_address_with_program_id(&fee_owner,&quote,&spl_token::ID));
        setup.push(spl_associated_token_account::instruction::create_associated_token_account_idempotent(
            &operator.pubkey(),&fee_owner,&quote,&spl_token::ID));
    }
    send(&mut svm,&operator,&[&operator],&setup).unwrap();
    let before_pool=svm.get_account(&pool).unwrap();
    let before_policy=svm.get_account(&policy).unwrap();
    let before_ledger=svm.get_account(&ledger).unwrap();
    let before_vault=svm.get_account(&vault).map_or(0,|a|a.lamports);
    let mut wrong_price=ix.clone();let impostor=Keypair::new();svm.airdrop(&impostor.pubkey(),100_000_000).unwrap();
    *wrong_price.accounts.last_mut().unwrap()=AccountMeta::new_readonly(impostor.pubkey(),true);
    assert!(send(&mut svm,&operator,&[&operator,&impostor],&[wrong_price]).is_err());
    let mut impossible=ix.clone();
    impossible.data[49..57].copy_from_slice(&u64::MAX.to_le_bytes());
    assert!(send(&mut svm,&operator,&[&operator,&price],&[impossible]).is_err());
    assert_eq!(svm.get_account(&pool).unwrap(),before_pool);
    assert_eq!(svm.get_account(&policy).unwrap(),before_policy);
    assert_eq!(svm.get_account(&ledger).unwrap(),before_ledger);
    assert_eq!(token_amount(&svm,quote_ata),1_000_000);
    assert_eq!(svm.get_account(&vault).map_or(0,|a|a.lamports),before_vault);
    assert!(svm.get_account(&receipt).is_none());
    let compute=send(&mut svm,&operator,&[&operator,&price],&[ix.clone()]).unwrap();
    let converted=funded_fee_router::MintTokenConversionV3::try_deserialize(&mut &svm.get_account(&receipt).unwrap().data[..]).unwrap();
    let credits=funded_fee_router::MintSolCreditV3::try_deserialize(&mut &svm.get_account(&credit).unwrap().data[..]).unwrap();
    let ledger_after=funded_fee_router::MintTokenLedgerV3::try_deserialize(&mut &svm.get_account(&ledger).unwrap().data[..]).unwrap();
    let policy_after=funded_fee_router::MintAgencyPolicyV3::try_deserialize(&mut &svm.get_account(&policy).unwrap().data[..]).unwrap();
    assert_eq!(converted.spent_quote,1_000_000-token_amount(&svm,quote_ata));
    assert!(converted.spent_quote>0&&converted.received_lamports>=min_out);
    assert_eq!(credits.credited[5],converted.received_lamports);
    assert_eq!(ledger_after.withdrawn[5],converted.spent_quote);
    assert_eq!(policy_after.paid_lamports[5],converted.received_lamports);
    let reserve=svm.get_sysvar::<Rent>().minimum_balance(0);
    assert_eq!(svm.get_account(&vault).unwrap().lamports-before_vault,converted.received_lamports+reserve);
    assert!(svm.get_account(&wsol_ata).is_none_or(|a|a.lamports==0));
    let final_vault=svm.get_account(&vault).unwrap();
    assert!(send(&mut svm,&operator,&[&operator,&price],&[ix]).is_err());
    assert_eq!(svm.get_account(&vault).unwrap(),final_vault);
    println!("CONVERSION_CPI_EVIDENCE slot={} compute={} spent_quote={} received_lamports={} receipt={}",
        fixture["slot"],compute,converted.spent_quote,converted.received_lamports,receipt);
}
