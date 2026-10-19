#![cfg(feature = "devnet-v3-program")]
use anchor_lang::{prelude::Pubkey, AccountDeserialize, AccountSerialize, InstructionData, ToAccountMetas};
use anchor_lang::solana_program::instruction::{AccountMeta, Instruction};
use funded_fee_router::{MintFeePolicyV3, MintClaimRecordV3, constants::*,
    instructions::{policy_v3, recover_qa_v3::*}};
use litesvm::LiteSVM;
use solana_account::Account;
use solana_message_lite::{Message, VersionedMessage};
use solana_transaction_lite::versioned::VersionedTransaction;
mod support;
const HISTORICAL_WITHDRAWN: [u64;7] = [258_333,0,6_458,1_938,1_291,6_459,16_146];

// Fixed historical public addresses have no test private keys. Signature
// cryptography is disabled only in this isolated VM; message signer flags and
// every program authorization/ownership/PDA check still execute in the SBF.
fn submit(svm: &mut LiteSVM, authority: Pubkey, ix: Instruction) -> bool {
    let message = Message::new_with_blockhash(&[ix], Some(&authority), &svm.latest_blockhash());
    let signatures = vec![Default::default(); message.header.num_required_signatures as usize];
    svm.send_transaction(VersionedTransaction { signatures, message:VersionedMessage::Legacy(message) }).is_ok()
}

fn fixture(mint: Pubkey, creator: Pubkey, settled: u64, rates: [u32; 6], available: u64)
    -> (LiteSVM, Pubkey, Pubkey, Pubkey, [Pubkey; 7]) {
    let program = funded_fee_router::id();
    let mut svm = LiteSVM::new().with_sigverify(false);
    svm.add_program(program, &support::program_bytes()).unwrap();
    svm.airdrop(&QA_AUTHORITY, 100_000_000).unwrap();
    let (legacy_router, global_bump) = Pubkey::find_program_address(&[SEED], &program);
    let (router, router_bump) = Pubkey::find_program_address(&[MINT_ROUTER_V3_SEED, mint.as_ref()], &program);
    let (policy, policy_bump) = Pubkey::find_program_address(&[MINT_POLICY_V3_SEED, mint.as_ref()], &program);
    let vaults = std::array::from_fn(|index| Pubkey::find_program_address(
        &[MINT_VAULT_V3_SEED, mint.as_ref(), &[index as u8]], &program).0);
    let account = |data: Vec<u8>, extra| Account { lamports:svm.minimum_balance_for_rent_exemption(data.len()) + extra,
        data, owner:program, executable:false, rent_epoch:0 };
    let global = [MAGIC.as_slice(), &[VERSION], &POLICY_HASH, QA_AUTHORITY.as_ref(), &[global_bump]].concat();
    let header = [MINT_ROUTER_V3_MAGIC.as_slice(), &[MINT_ROUTER_V3_VERSION], &POLICY_HASH,
        QA_AUTHORITY.as_ref(), mint.as_ref(), &[router_bump]].concat();
    let paid = policy_v3::category_targets(settled,rates).unwrap();
    let withdrawn = if mint == QA_MINT { HISTORICAL_WITHDRAWN } else { [0;7] };
    let policy_state = MintFeePolicyV3 { mint, creator, authority:QA_AUTHORITY, protocol_units:rates,
        settled_lamports:settled, paid_lamports:paid,
        withdrawn_lamports:withdrawn, bump:policy_bump };
    let mut policy_data = vec![]; policy_state.try_serialize(&mut policy_data).unwrap();
    let accounts = [(legacy_router,account(global,0)), (router,account(header,available)), (policy,account(policy_data,0))];
    for (key,value) in accounts { svm.set_account(key,value).unwrap(); }
    for (index,key) in vaults.iter().enumerate() {
        svm.set_account(*key,Account {lamports:svm.minimum_balance_for_rent_exemption(0)
            + paid[index].saturating_sub(withdrawn[index]),data:vec![],
            owner:anchor_lang::system_program::ID,executable:false,rent_epoch:0}).unwrap();
    }
    (svm,legacy_router,router,policy,vaults)
}

fn instruction(mint: Pubkey, creator: Pubkey, legacy_router: Pubkey, router: Pubkey,
    policy: Pubkey, vaults: [Pubkey;7], claim_id: [u8;32], amount: u64, recovery: bool) -> Instruction {
    let program = funded_fee_router::id();
    let claim = Pubkey::find_program_address(&[MINT_CLAIM_V3_SEED,mint.as_ref(),&claim_id],&program).0;
    let mut metas = funded_fee_router::accounts::SettleMintV3 { authority:QA_AUTHORITY, creator,
        mint, legacy_router, router, policy, claim, system_program:anchor_lang::system_program::ID }.to_account_metas(None);
    let data = if recovery {
        metas[1].is_signer = false;
        funded_fee_router::instruction::RecoverQaSettlementV3 { claim_id, expected_lamports:amount }.data()
    } else { funded_fee_router::instruction::SettleMintV3 { claim_id, expected_lamports:amount }.data() };
    metas.extend(vaults.map(|key| AccountMeta::new(key,false)));
    Instruction::new_with_bytes(program,&data,metas)
}

#[test]
fn approved_collection_leaves_unrelated_surplus_and_requires_both_signers() {
    let mint = Pubkey::new_unique(); let creator = Pubkey::new_unique();
    let rates = [800_000,200_000,60_000,40_000,400_000,500_000];
    let (mut svm,legacy,router,policy,vaults) = fixture(mint,creator,0,rates,804_105);
    let rent = svm.minimum_balance_for_rent_exemption(MINT_ROUTER_DATA_LEN);
    let claim_id = [31u8;32];
    for amount in [0,804_106] {
        assert!(!submit(&mut svm,QA_AUTHORITY,instruction(mint,creator,legacy,router,policy,vaults,claim_id,amount,false)));
        assert_eq!(svm.get_account(&router).unwrap().lamports,rent+804_105);
    }
    let mut missing_creator = instruction(mint,creator,legacy,router,policy,vaults,claim_id,204_105,false);
    missing_creator.accounts[1].is_signer = false;
    assert!(!submit(&mut svm,QA_AUTHORITY,missing_creator));
    assert!(!submit(&mut svm,QA_AUTHORITY,instruction(mint,Pubkey::new_unique(),legacy,router,policy,vaults,claim_id,204_105,false)));
    svm.expire_blockhash();
    assert!(submit(&mut svm,QA_AUTHORITY,instruction(mint,creator,legacy,router,policy,vaults,claim_id,204_105,false)));
    assert_eq!(svm.get_account(&router).unwrap().lamports,rent+600_000);
    let claim = Pubkey::find_program_address(&[MINT_CLAIM_V3_SEED,mint.as_ref(),&claim_id],&funded_fee_router::id()).0;
    let receipt = svm.get_account(&claim).unwrap();
    let receipt = MintClaimRecordV3::try_deserialize(&mut &receipt.data[..]).unwrap();
    assert_eq!(receipt.total_lamports,204_105);
    assert_eq!(receipt.category_lamports,[163_284,16_328,4_082,1_225,816,8_164,10_206]);
    svm.expire_blockhash();
    assert!(!submit(&mut svm,QA_AUTHORITY,instruction(mint,creator,legacy,router,policy,vaults,claim_id,204_105,false)));
    assert_eq!(svm.get_account(&router).unwrap().lamports,rent+600_000);
}

#[test]
fn approved_followup_is_exact_preserves_withdrawals_and_rejects_replay() {
    let (mut svm,legacy,router,policy,vaults)=fixture(QA_MINT,QA_CREATOR,
        QA_FOLLOWUP_PRIOR_SETTLED,QA_RATES,QA_FOLLOWUP_AMOUNT);
    for (claim,amount) in [(QA_CLAIM,QA_FOLLOWUP_AMOUNT),(QA_FOLLOWUP_CLAIM,QA_AMOUNT),
        (QA_FOLLOWUP_CLAIM,QA_FOLLOWUP_AMOUNT+1)] {
        assert!(!submit(&mut svm,QA_AUTHORITY,instruction(QA_MINT,QA_CREATOR,legacy,router,policy,vaults,claim,amount,true)));
    }
    svm.expire_blockhash();
    assert!(submit(&mut svm,QA_AUTHORITY,instruction(QA_MINT,QA_CREATOR,legacy,router,policy,vaults,
        QA_FOLLOWUP_CLAIM,QA_FOLLOWUP_AMOUNT,true)));
    let after=svm.get_account(&policy).unwrap();
    let after=MintFeePolicyV3::try_deserialize(&mut &after.data[..]).unwrap();
    assert_eq!(after.settled_lamports,QA_FOLLOWUP_PRIOR_SETTLED+QA_FOLLOWUP_AMOUNT);
    assert_eq!(after.withdrawn_lamports,HISTORICAL_WITHDRAWN);
    assert_eq!(after.protocol_units,QA_RATES);
    assert_eq!(after.paid_lamports,policy_v3::category_targets(after.settled_lamports,QA_RATES).unwrap());
    assert_eq!(svm.get_account(&router).unwrap().lamports,svm.minimum_balance_for_rent_exemption(MINT_ROUTER_DATA_LEN));
    svm.expire_blockhash();
    assert!(!submit(&mut svm,QA_AUTHORITY,instruction(QA_MINT,QA_CREATOR,legacy,router,policy,vaults,
        QA_FOLLOWUP_CLAIM,QA_FOLLOWUP_AMOUNT,true)));
}

#[test]
fn recovery_claim_cannot_use_the_other_approved_prior_state() {
    for (prior,claim,amount) in [(QA_PRIOR_SETTLED,QA_FOLLOWUP_CLAIM,QA_FOLLOWUP_AMOUNT),
        (QA_FOLLOWUP_PRIOR_SETTLED,QA_CLAIM,QA_AMOUNT)] {
        let (mut svm,legacy,router,policy,vaults)=fixture(QA_MINT,QA_CREATOR,prior,QA_RATES,amount);
        assert!(!submit(&mut svm,QA_AUTHORITY,instruction(QA_MINT,QA_CREATOR,legacy,router,policy,vaults,claim,amount,true)));
    }
}

#[test]
fn recovery_rejects_any_change_to_the_approved_record() {
    for case in 0..10 {
        let mut rates = QA_RATES; if case == 7 { rates = [800_000,200_000,60_000,40_000,400_000,500_000]; }
        let (mut svm,legacy,router,policy,mut vaults) = fixture(QA_MINT,QA_CREATOR,
            if case == 8 { QA_PRIOR_SETTLED+1 } else { QA_PRIOR_SETTLED },rates,QA_AMOUNT);
        if case == 6 { vaults[6] = Pubkey::new_unique(); }
        let mut ix = instruction(if case == 2 { Pubkey::new_unique() } else { QA_MINT },
            if case == 3 { Pubkey::new_unique() } else { QA_CREATOR },legacy,router,policy,vaults,
            if case == 0 { [0u8;32] } else { QA_CLAIM },if case == 1 { QA_AMOUNT+1 } else { QA_AMOUNT },true);
        let payer = if case == 4 { let other=Pubkey::new_unique(); svm.airdrop(&other,100_000_000).unwrap();
            ix.accounts[0].pubkey=other; other } else { QA_AUTHORITY };
        if case == 5 { ix.accounts[0].is_signer=false; }
        if case == 9 { ix.accounts[6].pubkey=Pubkey::new_unique(); }
        // A separate fee payer is needed to test absence of the authority signer.
        let payer = if case == 5 { let other=Pubkey::new_unique(); svm.airdrop(&other,100_000_000).unwrap(); other } else {payer};
        assert!(!submit(&mut svm,payer,ix),"tamper case {case}");
        assert_eq!(svm.get_account(&router).unwrap().lamports,
            svm.minimum_balance_for_rent_exemption(MINT_ROUTER_DATA_LEN)+QA_AMOUNT);
        let claim=Pubkey::find_program_address(&[MINT_CLAIM_V3_SEED,QA_MINT.as_ref(),&QA_CLAIM],&funded_fee_router::id()).0;
        assert!(svm.get_account(&claim).is_none());
    }
}

#[test]
fn recovery_preserves_policy_and_allocates_once_to_existing_category_vaults() {
    let (mut svm,legacy,router,policy,vaults) = fixture(QA_MINT,QA_CREATOR,QA_PRIOR_SETTLED,QA_RATES,QA_AMOUNT);
    let ix = instruction(QA_MINT,QA_CREATOR,legacy,router,policy,vaults,QA_CLAIM,QA_AMOUNT,true);
    assert!(submit(&mut svm,QA_AUTHORITY,ix.clone()));
    assert_eq!(svm.get_account(&router).unwrap().lamports,svm.minimum_balance_for_rent_exemption(MINT_ROUTER_DATA_LEN));
    let saved=svm.get_account(&policy).unwrap();
    let saved=MintFeePolicyV3::try_deserialize(&mut &saved.data[..]).unwrap();
    assert_eq!(saved.creator,QA_CREATOR); assert_eq!(saved.authority,QA_AUTHORITY);
    assert_eq!(saved.protocol_units,QA_RATES); assert_eq!(saved.withdrawn_lamports,HISTORICAL_WITHDRAWN);
    assert_eq!(saved.settled_lamports,QA_PRIOR_SETTLED+QA_AMOUNT);
    let expected=policy_v3::category_targets(QA_PRIOR_SETTLED+QA_AMOUNT,QA_RATES).unwrap();
    for (index,vault) in vaults.iter().enumerate() {
        assert_eq!(svm.get_account(vault).unwrap().lamports,
            svm.minimum_balance_for_rent_exemption(0)+expected[index]-HISTORICAL_WITHDRAWN[index]);
    }
    svm.expire_blockhash(); assert!(!submit(&mut svm,QA_AUTHORITY,ix));
}
