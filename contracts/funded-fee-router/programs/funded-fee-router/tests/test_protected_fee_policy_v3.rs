use anchor_lang::{prelude::Pubkey, solana_program::{instruction::{AccountMeta, Instruction},
    system_instruction}, AccountDeserialize, InstructionData, ToAccountMetas};
use funded_fee_router::{MintFeePolicyV3, MintWithdrawalApprovalV3};
use litesvm::LiteSVM;
use solana_keypair_lite::Keypair;
use solana_message_lite::{Message, VersionedMessage};
use solana_signer_lite::Signer;
use solana_transaction_lite::versioned::VersionedTransaction;
mod support;

fn send(svm: &mut LiteSVM, payer: &Keypair, signers: &[&Keypair], ix: Instruction) -> bool {
    let message = Message::new_with_blockhash(&[ix], Some(&payer.pubkey()), &svm.latest_blockhash());
    let Ok(tx) = VersionedTransaction::try_new(VersionedMessage::Legacy(message), signers) else {
        return false;
    };
    let result = svm.send_transaction(tx).is_ok();
    svm.expire_blockhash();
    result
}

#[test]
fn protected_fees_enforce_immutable_shares_and_onchain_approvals() {
    let program = funded_fee_router::id();
    let mut svm = LiteSVM::new();
    svm.add_program(program, &support::program_bytes()).unwrap();
    let authority = Keypair::new();
    let owner = Keypair::new();
    let creator = Keypair::new();
    let mint = Keypair::new();
    let operations = Keypair::new();
    let wrong = Keypair::new();
    for wallet in [&authority, &creator, &operations, &wrong] {
        svm.airdrop(&wallet.pubkey(), 150_000_000_000).unwrap();
    }
    let program_data = support::set_upgrade_owner(&mut svm, program, owner.pubkey());
    let legacy = Pubkey::find_program_address(&[b"funded-fee-router-v1"], &program).0;
    let router = Pubkey::find_program_address(&[b"funded-mint-router-v3", mint.pubkey().as_ref()], &program).0;
    let policy = Pubkey::find_program_address(&[b"mint-fee-policy-v3", mint.pubkey().as_ref()], &program).0;
    let vaults: [Pubkey; 7] = std::array::from_fn(|index| Pubkey::find_program_address(
        &[b"mint-fee-vault-v3", mint.pubkey().as_ref(), &[index as u8]], &program).0);
    let global = Instruction::new_with_bytes(program, &funded_fee_router::instruction::Initialize {}.data(),
        funded_fee_router::accounts::Initialize { authority:authority.pubkey(), app_owner:owner.pubkey(),
            router:legacy, program, program_data, system_program:anchor_lang::system_program::ID }.to_account_metas(None));
    assert!(send(&mut svm, &authority, &[&authority, &owner], global));
    let rates = [1_000_000, 200_000, 60_000, 40_000, 200_000, 500_000];
    let shares = [6_000_000, 1_000_000, 1_000_000];
    let init = Instruction::new_with_bytes(program,
        &funded_fee_router::instruction::InitializeProtectedMintV3 {
            protocol_units:rates, directed_units:shares }.data(),
        funded_fee_router::accounts::InitializeProtectedMintV3 { authority:authority.pubkey(),
            creator:creator.pubkey(), mint:mint.pubkey(), legacy_router:legacy, router, policy,
            system_program:anchor_lang::system_program::ID }.to_account_metas(None));
    assert!(send(&mut svm, &creator, &[&creator, &mint], init));
    let saved = svm.get_account(&policy).unwrap();
    assert_eq!(saved.data.len(), 293);
    assert_eq!(&saved.data[249..257], b"FNDPROT1");
    assert_eq!(MintFeePolicyV3::try_deserialize(&mut &saved.data[..]).unwrap().protocol_units, rates);

    let collected = 10_000_000_000u64;
    assert!(send(&mut svm, &authority, &[&authority],
        system_instruction::transfer(&authority.pubkey(), &router, collected)));
    let claim_id = [1u8; 32];
    let claim = Pubkey::find_program_address(
        &[b"mint-fee-claim-v3", mint.pubkey().as_ref(), &claim_id], &program).0;
    let mut metas = funded_fee_router::accounts::SettleMintV3 { authority:authority.pubkey(),
        creator:creator.pubkey(), mint:mint.pubkey(), legacy_router:legacy, router, policy, claim,
        system_program:anchor_lang::system_program::ID }.to_account_metas(None);
    metas.extend(vaults.map(|key| AccountMeta::new(key, false)));
    let settle = Instruction::new_with_bytes(program,
        &funded_fee_router::instruction::SettleMintV3 { claim_id, expected_lamports:collected }.data(), metas);
    assert!(send(&mut svm, &authority, &[&authority, &creator], settle));

    let creator_id = [2u8; 32];
    let creator_receipt = Pubkey::find_program_address(
        &[b"mint-withdraw-v3", mint.pubkey().as_ref(), &creator_id], &program).0;
    let creator_approval = Pubkey::find_program_address(
        &[b"mint-approval-v3", mint.pubkey().as_ref(), &creator_id], &program).0;
    let old_route = Instruction::new_with_bytes(program,
        &funded_fee_router::instruction::DisburseMintV3 {
            withdrawal_id:creator_id, category:0, amount:1_000_000_000 }.data(),
        funded_fee_router::accounts::DisburseMintV3 { authority:authority.pubkey(),
            creator:creator.pubkey(), mint:mint.pubkey(), legacy_router:legacy, policy,
            vault:vaults[0], recipient:creator.pubkey(), withdrawal:creator_receipt,
            system_program:anchor_lang::system_program::ID }.to_account_metas(None));
    assert!(!send(&mut svm, &authority, &[&authority, &creator], old_route));
    let direct = |amount| Instruction::new_with_bytes(program,
        &funded_fee_router::instruction::DisburseProtectedMintV3 {
            withdrawal_id:creator_id, category:0, beneficiary:0, amount, holder_amount:0 }.data(),
        funded_fee_router::accounts::DisburseProtectedMintV3 { authority:authority.pubkey(),
            creator:creator.pubkey(), mint:mint.pubkey(), legacy_router:legacy, policy,
            vault:vaults[0], recipient:creator.pubkey(), approval:creator_approval,
            withdrawal:creator_receipt, system_program:anchor_lang::system_program::ID }
            .to_account_metas(None));
    assert!(!send(&mut svm, &authority, &[&authority, &creator], direct(6_000_000_001)));
    let creator_before = svm.get_account(&creator.pubkey()).unwrap().lamports;
    assert!(send(&mut svm, &authority, &[&authority, &creator], direct(6_000_000_000)));
    assert_eq!(svm.get_account(&creator.pubkey()).unwrap().lamports,
        creator_before + 6_000_000_000);

    let reward = Pubkey::find_program_address(&[b"reward-vault-v1",
        authority.pubkey().as_ref(), mint.pubkey().as_ref()], &program).0;
    let reward_init = Instruction::new_with_bytes(program,
        &funded_fee_router::instruction::InitializeRewardVault {}.data(),
        funded_fee_router::accounts::InitializeRewardVault { authority:authority.pubkey(),
            mint:mint.pubkey(), vault:reward, legacy_router:legacy,
            system_program:anchor_lang::system_program::ID }.to_account_metas(None));
    assert!(send(&mut svm, &authority, &[&authority], reward_init));
    let reward_id = [4u8; 32];
    let reward_receipt = Pubkey::find_program_address(
        &[b"mint-withdraw-v3", mint.pubkey().as_ref(), &reward_id], &program).0;
    let reward_approval = Pubkey::find_program_address(
        &[b"mint-approval-v3", mint.pubkey().as_ref(), &reward_id], &program).0;
    let reward_release = |holder_amount| Instruction::new_with_bytes(program,
        &funded_fee_router::instruction::DisburseProtectedMintV3 {
            withdrawal_id:reward_id, category:0, beneficiary:1,
            amount:2_000_000_000, holder_amount }.data(),
        funded_fee_router::accounts::DisburseProtectedMintV3 { authority:authority.pubkey(),
            creator:creator.pubkey(), mint:mint.pubkey(), legacy_router:legacy, policy,
            vault:vaults[0], recipient:reward, approval:reward_approval,
            withdrawal:reward_receipt, system_program:anchor_lang::system_program::ID }
            .to_account_metas(None));
    assert!(!send(&mut svm, &authority, &[&authority, &creator],
        reward_release(2_000_000_000)));
    let reward_before = svm.get_account(&reward).unwrap().lamports;
    assert!(send(&mut svm, &authority, &[&authority, &creator],
        reward_release(1_000_000_000)));
    assert_eq!(svm.get_account(&reward).unwrap().lamports,
        reward_before + 2_000_000_000);
    let policy_after_reward = svm.get_account(&policy).unwrap();
    for (index, expected) in [6_000_000_000u64, 1_000_000_000, 1_000_000_000].iter().enumerate() {
        let offset = 269 + index * 8;
        assert_eq!(u64::from_le_bytes(policy_after_reward.data[offset..offset + 8]
            .try_into().unwrap()), *expected);
    }

    let ops_id = [3u8; 32];
    let ops_receipt = Pubkey::find_program_address(
        &[b"mint-withdraw-v3", mint.pubkey().as_ref(), &ops_id], &program).0;
    let ops_approval = Pubkey::find_program_address(
        &[b"mint-approval-v3", mint.pubkey().as_ref(), &ops_id], &program).0;
    let ops = |recipient| Instruction::new_with_bytes(program,
        &funded_fee_router::instruction::DisburseProtectedMintV3 {
            withdrawal_id:ops_id, category:1, beneficiary:3, amount:100_000_000,
            holder_amount:0 }.data(),
        funded_fee_router::accounts::DisburseProtectedMintV3 { authority:authority.pubkey(),
            creator:creator.pubkey(), mint:mint.pubkey(), legacy_router:legacy, policy,
            vault:vaults[1], recipient, approval:ops_approval, withdrawal:ops_receipt,
            system_program:anchor_lang::system_program::ID }.to_account_metas(None));
    assert!(!send(&mut svm, &authority, &[&authority, &creator], ops(operations.pubkey())));
    let approve = Instruction::new_with_bytes(program,
        &funded_fee_router::instruction::ApproveProtectedWithdrawalV3 {
            withdrawal_id:ops_id, category:1, beneficiary:3, amount:100_000_000 }.data(),
        funded_fee_router::accounts::ApproveProtectedWithdrawalV3 { authority:authority.pubkey(),
            creator:creator.pubkey(), mint:mint.pubkey(), legacy_router:legacy, policy,
            recipient:operations.pubkey(), approval:ops_approval,
            system_program:anchor_lang::system_program::ID }.to_account_metas(None));
    assert!(!send(&mut svm, &authority, &[&authority], approve.clone()));
    assert!(send(&mut svm, &authority, &[&authority, &creator], approve));
    assert!(!send(&mut svm, &authority, &[&authority, &creator], ops(wrong.pubkey())));
    let before = svm.get_account(&operations.pubkey()).unwrap().lamports;
    assert!(send(&mut svm, &authority, &[&authority, &creator], ops(operations.pubkey())));
    assert_eq!(svm.get_account(&operations.pubkey()).unwrap().lamports, before + 100_000_000);
    let approval = svm.get_account(&ops_approval).unwrap();
    assert!(MintWithdrawalApprovalV3::try_deserialize(&mut &approval.data[..]).unwrap().consumed);
    assert!(!send(&mut svm, &authority, &[&authority, &creator], ops(operations.pubkey())));
}
