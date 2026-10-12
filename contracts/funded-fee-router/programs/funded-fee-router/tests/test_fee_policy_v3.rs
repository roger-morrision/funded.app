use anchor_lang::{prelude::Pubkey, solana_program::{instruction::{AccountMeta, Instruction}, system_instruction},
    AccountDeserialize, InstructionData, ToAccountMetas};
use funded_fee_router::{MintClaimRecordV3, MintFeePolicyV3, MintWithdrawalV3, MINT_ROUTER_DATA_LEN};
use litesvm::LiteSVM;
use solana_keypair_lite::Keypair;
use solana_message_lite::{Message, VersionedMessage};
use solana_signer_lite::Signer;
use solana_transaction_lite::versioned::VersionedTransaction;
mod support;

fn send(svm: &mut LiteSVM, payer: &Keypair, signers: &[&Keypair], ix: Instruction) -> bool {
    let message = Message::new_with_blockhash(&[ix], Some(&payer.pubkey()), &svm.latest_blockhash());
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(message), signers).unwrap();
    svm.send_transaction(tx).is_ok()
}

fn vaults(mint: Pubkey, program: Pubkey) -> [Pubkey; 7] {
    std::array::from_fn(|index| Pubkey::find_program_address(
        &[b"mint-fee-vault-v3", mint.as_ref(), &[index as u8]], &program).0)
}

fn initialize_v3_ix(program: Pubkey, authority: Pubkey, creator: Pubkey, mint: Pubkey,
    legacy_router: Pubkey, router: Pubkey, policy: Pubkey, rates: [u32; 6]) -> Instruction {
    Instruction::new_with_bytes(program,
        &funded_fee_router::instruction::InitializeMintV3 { protocol_units: rates }.data(),
        funded_fee_router::accounts::InitializeMintV3 { authority, creator, mint, legacy_router,
            router, policy, system_program: anchor_lang::system_program::ID }.to_account_metas(None))
}

fn settle_v3_ix(program: Pubkey, authority: Pubkey, creator: Pubkey, mint: Pubkey,
    legacy_router: Pubkey, router: Pubkey, policy: Pubkey, claim_id: [u8; 32],
    destinations: [Pubkey; 7], expected_lamports: u64) -> Instruction {
    let (claim, _) = Pubkey::find_program_address(&[b"mint-fee-claim-v3", mint.as_ref(), &claim_id], &program);
    let mut metas = funded_fee_router::accounts::SettleMintV3 { authority, creator, mint,
        legacy_router, router, policy, claim, system_program: anchor_lang::system_program::ID }.to_account_metas(None);
    metas.extend(destinations.map(|pubkey| AccountMeta::new(pubkey, false)));
    Instruction::new_with_bytes(program,
        &funded_fee_router::instruction::SettleMintV3 { claim_id, expected_lamports }.data(), metas)
}

fn disburse_v3_ix(program: Pubkey, authority: Pubkey, creator: Pubkey, mint: Pubkey,
    legacy_router: Pubkey, policy: Pubkey, category: u8, vault: Pubkey, recipient: Pubkey,
    withdrawal_id: [u8; 32], amount: u64) -> Instruction {
    let (withdrawal, _) = Pubkey::find_program_address(
        &[b"mint-withdraw-v3", mint.as_ref(), &withdrawal_id], &program);
    Instruction::new_with_bytes(program,
        &funded_fee_router::instruction::DisburseMintV3 { withdrawal_id, category, amount }.data(),
        funded_fee_router::accounts::DisburseMintV3 { authority, creator, mint, legacy_router,
            policy, vault, recipient, withdrawal, system_program: anchor_lang::system_program::ID }
            .to_account_metas(None))
}

#[test]
fn v3_settlement_enforces_configured_vaults_exact_rates_and_replay_protection() {
    let program = funded_fee_router::id();
    let mut svm = LiteSVM::new();
    svm.add_program(program, &support::program_bytes()).unwrap();
    let authority = Keypair::new();
    let next_authority = Keypair::new();
    let app_owner = Keypair::new();
    let creator = Keypair::new();
    let mint = Keypair::new();
    svm.airdrop(&authority.pubkey(), 150_000_000_000).unwrap();
    svm.airdrop(&next_authority.pubkey(), 1_000_000_000).unwrap();
    svm.airdrop(&creator.pubkey(), 1_000_000_000).unwrap();
    let program_data = support::set_upgrade_owner(&mut svm, program, app_owner.pubkey());
    let (legacy_router, _) = Pubkey::find_program_address(&[b"funded-fee-router-v1"], &program);
    let (router, _) = Pubkey::find_program_address(&[b"funded-mint-router-v3", mint.pubkey().as_ref()], &program);
    let (policy, _) = Pubkey::find_program_address(&[b"mint-fee-policy-v3", mint.pubkey().as_ref()], &program);
    let global_init = Instruction::new_with_bytes(program, &funded_fee_router::instruction::Initialize {}.data(),
        funded_fee_router::accounts::Initialize { authority: authority.pubkey(), app_owner: app_owner.pubkey(),
            router: legacy_router, program, program_data, system_program: anchor_lang::system_program::ID }.to_account_metas(None));
    assert!(send(&mut svm, &authority, &[&authority, &app_owner], global_init));

    // Gross-fee units from the configurable protocol 20%.
    let rates = [1_000_000, 200_000, 60_000, 40_000, 200_000, 500_000];
    let bad_rates = [1_000_000, 200_000, 60_000, 40_000, 200_000, 499_999];
    assert!(!send(&mut svm, &authority, &[&authority, &creator, &mint], initialize_v3_ix(program,
        authority.pubkey(), creator.pubkey(), mint.pubkey(), legacy_router, router, policy, bad_rates)));
    assert!(svm.get_account(&policy).is_none());
    svm.expire_blockhash();
    assert!(send(&mut svm, &authority, &[&authority, &creator, &mint], initialize_v3_ix(program,
        authority.pubkey(), creator.pubkey(), mint.pubkey(), legacy_router, router, policy, rates)));
    let policy_account = svm.get_account(&policy).unwrap();
    let saved = MintFeePolicyV3::try_deserialize(&mut &policy_account.data[..]).unwrap();
    assert_eq!(saved.protocol_units, rates);
    assert_eq!(saved.creator, creator.pubkey());

    let rent = svm.minimum_balance_for_rent_exemption(MINT_ROUTER_DATA_LEN);
    let amount = 100_000_000_000u64;
    assert!(send(&mut svm, &authority, &[&authority], system_instruction::transfer(&authority.pubkey(), &router, amount)));
    let mut destinations = vaults(mint.pubkey(), program);
    let original = destinations;
    destinations[6] = Keypair::new().pubkey();
    let claim_id = [7u8; 32];
    assert!(!send(&mut svm, &authority, &[&authority, &creator], settle_v3_ix(program,
        authority.pubkey(), creator.pubkey(), mint.pubkey(), legacy_router, router, policy, claim_id, destinations, amount)));
    assert!(!send(&mut svm, &authority, &[&authority, &creator], settle_v3_ix(program,
        authority.pubkey(), creator.pubkey(), Keypair::new().pubkey(), legacy_router, router, policy, claim_id, original, amount)));
    assert_eq!(svm.get_account(&router).unwrap().lamports, rent + amount);
    svm.expire_blockhash();
    assert!(!send(&mut svm, &authority, &[&authority, &creator], settle_v3_ix(program,
        authority.pubkey(), creator.pubkey(), mint.pubkey(), legacy_router, router, policy,
        claim_id, original, amount - 1)));
    assert_eq!(svm.get_account(&router).unwrap().lamports, rent + amount);
    svm.expire_blockhash();
    assert!(send(&mut svm, &authority, &[&authority, &creator], settle_v3_ix(program,
        authority.pubkey(), creator.pubkey(), mint.pubkey(), legacy_router, router, policy, claim_id, original, amount)));
    let expected = [80_000_000_000u64, 10_000_000_000, 2_000_000_000, 600_000_000,
        400_000_000, 2_000_000_000, 5_000_000_000];
    for (address, balance) in original.iter().zip(expected) {
        assert_eq!(svm.get_account(address).unwrap().lamports, balance);
    }
    assert_eq!(svm.get_account(&router).unwrap().lamports, rent);
    let (claim, _) = Pubkey::find_program_address(&[b"mint-fee-claim-v3", mint.pubkey().as_ref(), &claim_id], &program);
    let receipt = svm.get_account(&claim).unwrap();
    let receipt = MintClaimRecordV3::try_deserialize(&mut &receipt.data[..]).unwrap();
    assert_eq!(receipt.total_lamports, amount);
    assert_eq!(receipt.category_lamports, expected);

    let creator_before = svm.get_account(&creator.pubkey()).unwrap().lamports;
    let payout_id = [11u8; 32];
    assert!(!send(&mut svm, &authority, &[&authority, &creator], disburse_v3_ix(program,
        authority.pubkey(), creator.pubkey(), mint.pubkey(), legacy_router, policy,
        0, original[0], authority.pubkey(), payout_id, 3_000_000_000)));
    assert!(!send(&mut svm, &authority, &[&authority, &creator], disburse_v3_ix(program,
        authority.pubkey(), creator.pubkey(), mint.pubkey(), legacy_router, policy,
        6, original[6], creator.pubkey(), payout_id, 3_000_000_000)));
    assert!(!send(&mut svm, &authority, &[&authority, &creator], disburse_v3_ix(program,
        authority.pubkey(), creator.pubkey(), mint.pubkey(), legacy_router, policy,
        0, original[1], creator.pubkey(), payout_id, 3_000_000_000)));
    assert_eq!(svm.get_account(&original[0]).unwrap().lamports, expected[0]);
    svm.expire_blockhash();
    assert!(send(&mut svm, &authority, &[&authority, &creator], disburse_v3_ix(program,
        authority.pubkey(), creator.pubkey(), mint.pubkey(), legacy_router, policy,
        0, original[0], creator.pubkey(), payout_id, 3_000_000_000)));
    assert_eq!(svm.get_account(&original[0]).unwrap().lamports, expected[0] - 3_000_000_000);
    assert_eq!(svm.get_account(&creator.pubkey()).unwrap().lamports, creator_before + 3_000_000_000);
    let (payout, _) = Pubkey::find_program_address(
        &[b"mint-withdraw-v3", mint.pubkey().as_ref(), &payout_id], &program);
    let payout_account = svm.get_account(&payout).unwrap();
    let payout_record = MintWithdrawalV3::try_deserialize(&mut &payout_account.data[..]).unwrap();
    assert_eq!(payout_record.category, 0);
    assert_eq!(payout_record.recipient, creator.pubkey());
    assert_eq!(payout_record.amount, 3_000_000_000);
    svm.expire_blockhash();
    assert!(!send(&mut svm, &authority, &[&authority, &creator], disburse_v3_ix(program,
        authority.pubkey(), creator.pubkey(), mint.pubkey(), legacy_router, policy,
        0, original[0], creator.pubkey(), payout_id, 1)));
    assert_eq!(svm.get_account(&original[0]).unwrap().lamports, expected[0] - 3_000_000_000);

    // An operations/referral payout cannot be directed to another category
    // vault. Community funds cannot go straight to an arbitrary wallet.
    let recipient = Keypair::new();
    svm.airdrop(&recipient.pubkey(), 1_000_000).unwrap();
    svm.expire_blockhash();
    assert!(!send(&mut svm, &authority, &[&authority, &creator], disburse_v3_ix(program,
        authority.pubkey(), creator.pubkey(), mint.pubkey(), legacy_router, policy,
        1, original[1], original[6], [12u8; 32], 1_000_000)));
    assert!(!send(&mut svm, &authority, &[&authority, &creator], disburse_v3_ix(program,
        authority.pubkey(), creator.pubkey(), mint.pubkey(), legacy_router, policy,
        5, original[5], recipient.pubkey(), [12u8; 32], 1_000_000)));
    assert_eq!(svm.get_account(&original[6]).unwrap().lamports, expected[6]);

    // The consumed claim cannot sweep a later deposit. Global authority
    // rotation must not strand the immutable v3 policy or mint router.
    assert!(send(&mut svm, &authority, &[&authority], system_instruction::transfer(&authority.pubkey(), &router, 1)));
    svm.expire_blockhash();
    assert!(!send(&mut svm, &authority, &[&authority, &creator], settle_v3_ix(program,
        authority.pubkey(), creator.pubkey(), mint.pubkey(), legacy_router, router, policy, claim_id, original, 1)));
    assert_eq!(svm.get_account(&router).unwrap().lamports, rent + 1);
    let rotate = Instruction::new_with_bytes(program, &funded_fee_router::instruction::RotateAuthority {}.data(),
        funded_fee_router::accounts::RotateAuthority { old_authority:authority.pubkey(),
            new_authority:next_authority.pubkey(), app_owner:app_owner.pubkey(), legacy_router,
            program, program_data }.to_account_metas(None));
    svm.expire_blockhash();
    assert!(send(&mut svm, &authority, &[&authority, &next_authority, &app_owner], rotate));
    svm.expire_blockhash();
    assert!(!send(&mut svm, &authority, &[&authority, &creator], settle_v3_ix(program,
        authority.pubkey(), creator.pubkey(), mint.pubkey(), legacy_router, router, policy, [8u8; 32], original, 1)));
    svm.expire_blockhash();
    assert!(send(&mut svm, &next_authority, &[&next_authority, &creator], settle_v3_ix(program,
        next_authority.pubkey(), creator.pubkey(), mint.pubkey(), legacy_router, router, policy, [8u8; 32], original, 1)));
    // Cumulative rounding accounts exactly for one-lamport dust.
    let final_policy = svm.get_account(&policy).unwrap();
    let final_policy = MintFeePolicyV3::try_deserialize(&mut &final_policy.data[..]).unwrap();
    assert_eq!(final_policy.settled_lamports, amount + 1);
    assert_eq!(final_policy.paid_lamports.iter().sum::<u64>(), amount + 1);
    assert_eq!(final_policy.paid_lamports[6], expected[6] + 1);
    assert_eq!(svm.get_account(&router).unwrap().lamports, rent);

    // The global authority rotation applies to disbursements as well.
    svm.expire_blockhash();
    assert!(!send(&mut svm, &authority, &[&authority, &creator], disburse_v3_ix(program,
        authority.pubkey(), creator.pubkey(), mint.pubkey(), legacy_router, policy,
        2, original[2], recipient.pubkey(), [13u8; 32], 1_000_000)));
    let recipient_before = svm.get_account(&recipient.pubkey()).unwrap().lamports;
    svm.expire_blockhash();
    assert!(send(&mut svm, &next_authority, &[&next_authority, &creator], disburse_v3_ix(program,
        next_authority.pubkey(), creator.pubkey(), mint.pubkey(), legacy_router, policy,
        2, original[2], recipient.pubkey(), [13u8; 32], 1_000_000)));
    assert_eq!(svm.get_account(&recipient.pubkey()).unwrap().lamports, recipient_before + 1_000_000);
    assert_eq!(svm.get_account(&original[2]).unwrap().lamports, expected[2] - 1_000_000);

    let (reward_vault, _) = Pubkey::find_program_address(
        &[b"reward-vault-v1", next_authority.pubkey().as_ref(), mint.pubkey().as_ref()], &program);
    let initialize_reward = Instruction::new_with_bytes(program,
        &funded_fee_router::instruction::InitializeRewardVault {}.data(),
        funded_fee_router::accounts::InitializeRewardVault { authority:next_authority.pubkey(),
            mint:mint.pubkey(), vault:reward_vault, legacy_router,
            system_program:anchor_lang::system_program::ID }.to_account_metas(None));
    svm.expire_blockhash();
    assert!(send(&mut svm, &next_authority, &[&next_authority], initialize_reward));
    let reward_before = svm.get_account(&reward_vault).unwrap().lamports;
    svm.expire_blockhash();
    assert!(send(&mut svm, &next_authority, &[&next_authority, &creator], disburse_v3_ix(program,
        next_authority.pubkey(), creator.pubkey(), mint.pubkey(), legacy_router, policy,
        5, original[5], reward_vault, [14u8; 32], 1_000_000_000)));
    assert_eq!(svm.get_account(&reward_vault).unwrap().lamports, reward_before + 1_000_000_000);
    assert_eq!(svm.get_account(&original[5]).unwrap().lamports, expected[5] - 1_000_000_000);

    // A new mint may choose a different split of only the protocol 20%,
    // including a zero buyback allocation, without changing creator 80%.
    let second_mint = Keypair::new();
    let (second_router, _) = Pubkey::find_program_address(&[b"funded-mint-router-v3", second_mint.pubkey().as_ref()], &program);
    let (second_policy, _) = Pubkey::find_program_address(&[b"mint-fee-policy-v3", second_mint.pubkey().as_ref()], &program);
    let alternate_rates = [1_500_000, 200_000, 60_000, 40_000, 200_000, 0];
    svm.airdrop(&next_authority.pubkey(), 20_000_000_000).unwrap();
    svm.expire_blockhash();
    assert!(send(&mut svm, &next_authority, &[&next_authority, &creator, &second_mint], initialize_v3_ix(program,
        next_authority.pubkey(), creator.pubkey(), second_mint.pubkey(), legacy_router,
        second_router, second_policy, alternate_rates)));
    svm.expire_blockhash();
    assert!(send(&mut svm, &next_authority, &[&next_authority], system_instruction::transfer(
        &next_authority.pubkey(), &second_router, 10_000_000_000)));
    svm.expire_blockhash();
    assert!(send(&mut svm, &next_authority, &[&next_authority, &creator], settle_v3_ix(program,
        next_authority.pubkey(), creator.pubkey(), second_mint.pubkey(), legacy_router,
        second_router, second_policy, [9u8; 32], vaults(second_mint.pubkey(), program), 10_000_000_000)));
    let second = svm.get_account(&second_policy).unwrap();
    let second = MintFeePolicyV3::try_deserialize(&mut &second.data[..]).unwrap();
    assert_eq!(second.protocol_units, alternate_rates);
    assert_eq!(second.paid_lamports, [8_000_000_000, 1_500_000_000, 200_000_000,
        60_000_000, 40_000_000, 200_000_000, 0]);
}
