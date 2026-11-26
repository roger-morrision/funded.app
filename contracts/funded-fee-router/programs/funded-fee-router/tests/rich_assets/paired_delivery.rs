//! Paired budgets carry spendable units from settlement to disbursement.
use super::{fixture, send, store};
use anchor_lang::{prelude::Pubkey, AccountDeserialize, AccountSerialize, InstructionData, ToAccountMetas,
    solana_program::{instruction::{Instruction, AccountMeta}, system_program}};
use anchor_spl::{associated_token::{get_associated_token_address_with_program_id as ata, spl_associated_token_account},
    token::spl_token, token_2022::spl_token_2022 as spl22};
use spl22::extension::{BaseStateWithExtensions, ExtensionType, StateWithExtensions, transfer_fee::TransferFeeAmount};
use funded_fee_router::{accounts, instruction, MintAgencyPolicyV3, MintTokenLedgerV3};
use solana_signer_lite::Signer;
use litesvm::LiteSVM;

fn state(svm: &LiteSVM, key: Pubkey) -> (u64, u64) {
    let account = svm.get_account(&key).unwrap();
    let token = StateWithExtensions::<spl22::state::Account>::unpack(&account.data).unwrap();
    let withheld = token.get_extension::<TransferFeeAmount>().map_or(0, |e| u64::from(e.withheld_amount));
    (token.base.amount, withheld)
}

#[test]
fn paired_settlement_and_withdrawal_require_spendable_delivery() {
    for (token, extension, bps) in [
        (spl_token::ID, None, 0),
        (spl22::ID, Some(ExtensionType::MetadataPointer), 0),
        (spl22::ID, Some(ExtensionType::TransferFeeConfig), 0),
        (spl22::ID, Some(ExtensionType::TransferFeeConfig), 100),
    ] {
        let (mut svm, owner, program_data) = fixture();
        let op = owner.pubkey();
        let program = funded_fee_router::id();
        let pda = |seeds: &[&[u8]]| Pubkey::find_program_address(seeds, &program);
        let run = |svm: &mut LiteSVM, ix| send(svm, &owner, &[&owner], ix);
        let source = Pubkey::new_unique();
        let quote = if token == spl_token::ID {
            anchor_lang::prelude::pubkey!("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v")
        } else { Pubkey::new_unique() };
        let size = ExtensionType::try_calculate_account_len::<spl22::state::Mint>(&extension.into_iter().collect::<Vec<_>>()).unwrap();
        store(&mut svm, quote, token, vec![0; size]);
        if extension == Some(ExtensionType::TransferFeeConfig) {
            run(&mut svm, spl22::extension::transfer_fee::instruction::initialize_transfer_fee_config(
                &token, &quote, None, None, bps, 5_000).unwrap()).unwrap();
        } else if extension == Some(ExtensionType::MetadataPointer) {
            run(&mut svm, spl22::extension::metadata_pointer::instruction::initialize(
                &token, &quote, None, Some(quote)).unwrap()).unwrap();
        }
        run(&mut svm, spl22::instruction::initialize_mint2(&token,&quote,&op,None,6).unwrap()).unwrap();

        let header = pda(&[funded_fee_router::SEED]).0;
        run(&mut svm, Instruction::new_with_bytes(program,&instruction::Initialize{}.data(),
            accounts::Initialize{authority:op,app_owner:op,router:header,program,program_data,system_program:system_program::ID}.to_account_metas(None))).unwrap();
        let (policy,bump) = pda(&[b"mint-agency-policy-v3",source.as_ref()]);
        let mut data=vec![];
        MintAgencyPolicyV3{mint:source,creator:op,authority:op,protocol_units:[2_000_000,0,0,0,0,0,0],settled_lamports:0,
            paid_lamports:[0;8],withdrawn_lamports:[0;8],directed_units:[8_000_000,0,0],directed_released:[0;3],
            selected_agents:0,agent_spent:[0;3],completed_agents:0,last_promotion_at:0,promotion_sequence:0,
            promotion_recipient:Pubkey::default(),config_revision:1,bump,remainder:[0;8],credit_base:[0;8],
            directed_ceiling:[0;3],directed_remainder:[0;3],directed_pool_base:0,
            agent_ceiling:[0;3],agent_remainder:[0;3],agent_pool_base:0}.try_serialize(&mut data).unwrap();
        store(&mut svm,policy,program,data);
        let (ledger,ledger_bump)=pda(&[funded_fee_router::MINT_TOKEN_LEDGER_V3_SEED,source.as_ref(),quote.as_ref()]);
        let router=pda(&[funded_fee_router::MINT_ROUTER_V3_SEED,source.as_ref()]).0;
        let vaults: Vec<_>=(0..8u8).map(|i| pda(&[funded_fee_router::MINT_VAULT_V3_SEED,source.as_ref(),&[i]]).0).collect();
        for wallet in vaults.iter().chain([&router,&op]) {
            run(&mut svm, spl_associated_token_account::instruction::create_associated_token_account_idempotent(&op,wallet,&quote,&token)).unwrap();
        }
        let account = |wallet| ata(&wallet,&quote,&token);
        let router_token=account(router);
        let payout_token=account(op);
        let category_token=account(vaults[0]);
        for (key,amount) in [(router_token,10_000),(payout_token,10_000),(category_token,5_000)] {
            run(&mut svm,spl22::instruction::mint_to(&token,&quote,&key,&op,&[],amount).unwrap()).unwrap();
        }
        // Direct token-program transfer independently measures the selected fee schedule.
        run(&mut svm,spl22::instruction::transfer_checked(&token,&payout_token,&quote,&category_token,&op,&[],1_000,6).unwrap()).unwrap();
        let expected_fee = if bps==0 {0} else {10};
        assert_eq!(state(&svm,payout_token),(9_000,0));
        assert_eq!(state(&svm,category_token),(6_000-expected_fee,expected_fee));

        // Prior settled custody supports an independent withdrawal even if a new settlement rejects.
        let mut ledger_bytes=vec![];
        let mut paid=[0;8]; paid[0]=4_000; paid[1]=1_000;
        MintTokenLedgerV3{mint:source,quote_mint:quote,settled:5_000,paid,withdrawn:[0;8],released:[0;3],bump:ledger_bump,
            remainder:[0;8],directed_ceiling:[0;3],directed_remainder:[0;3],directed_pool_base:0}
            .try_serialize(&mut ledger_bytes).unwrap();
        store(&mut svm,ledger,program,ledger_bytes);
        let claim_id=[11;32];
        let claim=pda(&[funded_fee_router::MINT_TOKEN_CLAIM_V3_SEED,source.as_ref(),quote.as_ref(),&claim_id]).0;
        let mut settle_accounts=accounts::SettleMintTokenV3{authority:op,mint:source,quote_mint:quote,legacy_router:header,policy,ledger,
            router,router_token,claim,token_program:token,system_program:system_program::ID}.to_account_metas(None);
        settle_accounts.extend(vaults.iter().map(|v|AccountMeta::new(account(*v),false)));
        let settle=Instruction::new_with_bytes(program,&instruction::SettleMintTokenV3{claim_id,expected_amount:10_000}.data(),settle_accounts);
        let withdrawal_id=[12;32];
        let approval=pda(&[funded_fee_router::MINT_TOKEN_APPROVAL_V3_SEED,source.as_ref(),quote.as_ref(),&withdrawal_id]).0;
        let withdrawal=pda(&[funded_fee_router::MINT_TOKEN_WITHDRAWAL_V3_SEED,source.as_ref(),quote.as_ref(),&withdrawal_id]).0;
        let withdraw=Instruction::new_with_bytes(program,&instruction::DisburseProtectedMintTokenV3{
            withdrawal_id,category:0,beneficiary:0,amount:1_000,holder_amount:0}.data(),
            accounts::DisburseProtectedMintTokenV3{authority:op,creator:op,mint:source,quote_mint:quote,legacy_router:header,policy,ledger,
                vault:vaults[0],vault_token:category_token,recipient_owner:op,recipient_token:payout_token,approval,withdrawal,
                token_program:token,system_program:system_program::ID}.to_account_metas(None));
        let tracked:Vec<_>=vaults.iter().map(|v|account(*v)).chain([router_token,payout_token,ledger,claim,withdrawal]).collect();
        let snapshot = |svm:&LiteSVM| tracked.iter().map(|key|svm.get_account(key)).collect::<Vec<_>>();
        if expected_fee>0 {
            let before=snapshot(&svm);
            for ix in [settle,withdraw] {
                let error=run(&mut svm,ix).unwrap_err();
                assert!(error.contains("MintClaimAmountMismatchV3"),"{error}");
                assert_eq!(snapshot(&svm),before);
            }
        } else {
            run(&mut svm,settle.clone()).unwrap();
            assert_eq!(state(&svm,router_token),(0,0));
            assert_eq!(state(&svm,category_token),(14_000,0));
            assert_eq!(state(&svm,account(vaults[1])),(2_000,0));
            run(&mut svm,withdraw.clone()).unwrap();
            assert_eq!(state(&svm,category_token),(13_000,0));
            assert_eq!(state(&svm,payout_token),(10_000,0));
            let l=MintTokenLedgerV3::try_deserialize(&mut svm.get_account(&ledger).unwrap().data.as_slice()).unwrap();
            assert_eq!((l.settled,l.paid[0],l.withdrawn[0]),(15_000,12_000,1_000));
            let after=snapshot(&svm);
            for ix in [settle,withdraw] { assert!(run(&mut svm,ix).is_err()); assert_eq!(snapshot(&svm),after); }
        }
        println!("PAIRED_DELIVERY token={token} extension={extension:?} fee_bps={bps} control_debit=1000 control_credit={} withheld={expected_fee}",1000-expected_fee);
    }
}
