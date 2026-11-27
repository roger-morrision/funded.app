use super::{configure, fixture, send, set_time};
use anchor_lang::{
    prelude::Pubkey,
    solana_program::instruction::{AccountMeta, Instruction},
    solana_program::system_instruction,
    AccountDeserialize, InstructionData, ToAccountMetas,
};
use funded_fee_router::{accounts, instruction, MintWithdrawalApprovalV3};
use solana_keypair_lite::Keypair;
use solana_signer_lite::Signer;

fn ix(data: impl InstructionData, accounts: impl ToAccountMetas) -> Instruction {
    Instruction::new_with_bytes(funded_fee_router::id(), &data.data(), accounts.to_account_metas(None))
}

// The automation-record bypass for category 1 (operations) is the accepted
// residual HIGH risk from the independent review: a compromised automation
// operator key could otherwise drain an unbounded number of mints' operations
// budgets with no creator consent, bounded only by the shared daily cap. This
// test proves the fix: a category-1 disbursement approved through the
// automation record (no live creator signature) cannot be disbursed until
// AUTOMATION_WITHDRAWAL_REVIEW_DELAY_SECONDS has passed since approval, giving
// the guardian the same review window the reward-cycle delay already gives.
// A creator who actually signs is never delayed.
#[test]
fn operator_chosen_operations_withdrawal_waits_for_the_guardian_review_delay() {
    let mut f = fixture();
    let operator = f.operator.insecure_clone();
    let authority = operator.pubkey();
    let creator_key = Keypair::new();
    let creator = creator_key.pubkey();
    let coin = Keypair::new();
    let mint = coin.pubkey();
    let recipient = Pubkey::new_unique();
    f.svm.airdrop(&creator, 50_000_000).unwrap();
    f.svm.airdrop(&recipient, 2_000_000).unwrap();
    let system_program = anchor_lang::system_program::ID;
    let legacy_router = f.legacy_router;
    let pda = |seeds: &[&[u8]]| Pubkey::find_program_address(seeds, &f.program_id).0;
    let policy = pda(&[funded_fee_router::MINT_POLICY_V3_SEED, mint.as_ref()]);
    let router = pda(&[funded_fee_router::MINT_ROUTER_V3_SEED, mint.as_ref()]);
    let automation = pda(&[b"mint-automation-v3", mint.as_ref()]);
    let guard = configure(&f, f.owner.pubkey(), f.guardian.pubkey(), 100_000);
    assert!(send(&mut f.svm, &f.owner, &[&f.owner], &[guard]));
    let init = ix(instruction::InitializeProtectedMintV3 {
        protocol_units: [2_000_000, 0, 0, 0, 0, 0], directed_units: [8_000_000, 0, 0],
    }, accounts::InitializeProtectedMintV3 { authority, creator, mint, legacy_router, router, policy, system_program });
    assert!(send(&mut f.svm, &creator_key, &[&creator_key, &coin], &[init]));
    let claim_id = [201; 32];
    let claim = pda(&[funded_fee_router::MINT_CLAIM_V3_SEED, mint.as_ref(), &claim_id]);
    let mut settle = ix(instruction::SettleMintV3 { claim_id, expected_lamports: 1_000 },
        accounts::SettleMintV3 { authority, creator, mint, legacy_router, router, policy, claim, system_program });
    let vaults: [Pubkey; 7] = std::array::from_fn(|n| pda(&[funded_fee_router::MINT_VAULT_V3_SEED, mint.as_ref(), &[n as u8]]));
    settle.accounts.extend(vaults.map(|key| AccountMeta::new(key, false)));
    assert!(send(&mut f.svm, &operator, &[&operator, &creator_key],
        &[system_instruction::transfer(&authority, &router, 1_000), settle]));
    assert_eq!(funded_fee_router::MintFeePolicyV3::try_deserialize(
        &mut f.svm.get_account(&policy).unwrap().data.as_slice()).unwrap().paid_lamports, [800, 200, 0, 0, 0, 0, 0]);
    let automation_init = ix(instruction::InitializeMintAutomationV3 { recipients: [recipient; 4] },
        accounts::InitializeMintAutomationV3 { authority, creator, mint, legacy_router, policy, automation, system_program });
    assert!(send(&mut f.svm, &operator, &[&operator], &[automation_init]));

    let category = 1u8;
    let amount = 150;
    let withdrawal_id = [7; 32];
    let approval = pda(&[funded_fee_router::MINT_APPROVAL_V3_SEED, mint.as_ref(), &withdrawal_id]);
    let withdrawal = pda(&[funded_fee_router::MINT_WITHDRAWAL_V3_SEED, mint.as_ref(), &withdrawal_id]);
    let mut approve = ix(instruction::ApproveProtectedWithdrawalV3 {
        withdrawal_id, category, beneficiary: category + 2, amount,
    }, accounts::ApproveProtectedWithdrawalV3 { authority, creator, mint, legacy_router, policy, recipient, approval, system_program });
    let mut pay = ix(instruction::DisburseProtectedMintV3 {
        withdrawal_id, category, beneficiary: category + 2, amount, holder_amount: 0,
    }, accounts::DisburseProtectedMintV3 { authority, creator, mint, legacy_router, policy,
        vault: vaults[usize::from(category)], recipient, approval, withdrawal, system_program });
    // Approve through the automation record alone, exactly as a compromised
    // hot operator would: no live creator signature.
    approve.accounts[1].is_signer = false;
    approve.accounts.push(AccountMeta::new_readonly(automation, false));
    assert!(send(&mut f.svm, &operator, &[&operator], &[approve]));
    let approved_at = f.svm.get_sysvar::<anchor_lang::prelude::Clock>().unix_timestamp;
    assert_eq!(funded_fee_router::MintWithdrawalApprovalV3::try_deserialize(
        &mut f.svm.get_account(&approval).unwrap().data.as_slice()).unwrap().created_at, approved_at);

    pay.accounts[1].is_signer = false;
    pay.accounts[3].is_writable = true;
    pay.accounts.push(AccountMeta::new_readonly(automation, false));

    // Disbursing in the same instant the approval was created must fail: the
    // guardian has had no time to notice and pause.
    let tracked = [legacy_router, policy, vaults[usize::from(category)], recipient, withdrawal];
    let before = tracked.map(|key| f.svm.get_account(&key));
    assert!(!send(&mut f.svm, &operator, &[&operator], &[pay.clone()]), "disbursed before the review delay elapsed");
    assert_eq!(tracked.map(|key| f.svm.get_account(&key)), before);
    assert!(!MintWithdrawalApprovalV3::try_deserialize(
        &mut f.svm.get_account(&approval).unwrap().data.as_slice()).unwrap().consumed);

    // Still one second short of the full delay: still rejected.
    set_time(&mut f.svm, approved_at + funded_fee_router::AUTOMATION_WITHDRAWAL_REVIEW_DELAY_SECONDS - 1);
    let before = tracked.map(|key| f.svm.get_account(&key));
    assert!(!send(&mut f.svm, &operator, &[&operator], &[pay.clone()]), "disbursed one second early");
    assert_eq!(tracked.map(|key| f.svm.get_account(&key)), before);

    // Once the delay has fully elapsed, the same disbursement succeeds.
    set_time(&mut f.svm, approved_at + funded_fee_router::AUTOMATION_WITHDRAWAL_REVIEW_DELAY_SECONDS);
    assert!(send(&mut f.svm, &operator, &[&operator], &[pay]));
    assert_eq!(f.svm.get_balance(&recipient).unwrap(), 2_000_000 + amount);
    assert!(MintWithdrawalApprovalV3::try_deserialize(
        &mut f.svm.get_account(&approval).unwrap().data.as_slice()).unwrap().consumed);
}

// The exact same withdrawal, approved and disbursed with the creator's own
// live signature (the normal manual path), is never delayed.
#[test]
fn creator_signed_operations_withdrawal_is_never_delayed() {
    let mut f = fixture();
    let operator = f.operator.insecure_clone();
    let authority = operator.pubkey();
    let creator_key = Keypair::new();
    let creator = creator_key.pubkey();
    let coin = Keypair::new();
    let mint = coin.pubkey();
    let recipient = Pubkey::new_unique();
    f.svm.airdrop(&creator, 50_000_000).unwrap();
    f.svm.airdrop(&recipient, 2_000_000).unwrap();
    let system_program = anchor_lang::system_program::ID;
    let legacy_router = f.legacy_router;
    let pda = |seeds: &[&[u8]]| Pubkey::find_program_address(seeds, &f.program_id).0;
    let policy = pda(&[funded_fee_router::MINT_POLICY_V3_SEED, mint.as_ref()]);
    let router = pda(&[funded_fee_router::MINT_ROUTER_V3_SEED, mint.as_ref()]);
    let guard = configure(&f, f.owner.pubkey(), f.guardian.pubkey(), 100_000);
    assert!(send(&mut f.svm, &f.owner, &[&f.owner], &[guard]));
    let init = ix(instruction::InitializeProtectedMintV3 {
        protocol_units: [2_000_000, 0, 0, 0, 0, 0], directed_units: [8_000_000, 0, 0],
    }, accounts::InitializeProtectedMintV3 { authority, creator, mint, legacy_router, router, policy, system_program });
    assert!(send(&mut f.svm, &creator_key, &[&creator_key, &coin], &[init]));
    let claim_id = [202; 32];
    let claim = pda(&[funded_fee_router::MINT_CLAIM_V3_SEED, mint.as_ref(), &claim_id]);
    let mut settle = ix(instruction::SettleMintV3 { claim_id, expected_lamports: 1_000 },
        accounts::SettleMintV3 { authority, creator, mint, legacy_router, router, policy, claim, system_program });
    let vaults: [Pubkey; 7] = std::array::from_fn(|n| pda(&[funded_fee_router::MINT_VAULT_V3_SEED, mint.as_ref(), &[n as u8]]));
    settle.accounts.extend(vaults.map(|key| AccountMeta::new(key, false)));
    assert!(send(&mut f.svm, &operator, &[&operator, &creator_key],
        &[system_instruction::transfer(&authority, &router, 1_000), settle]));

    let category = 1u8;
    let amount = 150;
    let withdrawal_id = [8; 32];
    let approval = pda(&[funded_fee_router::MINT_APPROVAL_V3_SEED, mint.as_ref(), &withdrawal_id]);
    let withdrawal = pda(&[funded_fee_router::MINT_WITHDRAWAL_V3_SEED, mint.as_ref(), &withdrawal_id]);
    let mut approve = ix(instruction::ApproveProtectedWithdrawalV3 {
        withdrawal_id, category, beneficiary: category + 2, amount,
    }, accounts::ApproveProtectedWithdrawalV3 { authority, creator, mint, legacy_router, policy, recipient, approval, system_program });
    let mut pay = ix(instruction::DisburseProtectedMintV3 {
        withdrawal_id, category, beneficiary: category + 2, amount, holder_amount: 0,
    }, accounts::DisburseProtectedMintV3 { authority, creator, mint, legacy_router, policy,
        vault: vaults[usize::from(category)], recipient, approval, withdrawal, system_program });
    approve.accounts[1].is_signer = true;
    pay.accounts[1].is_signer = true;
    pay.accounts[3].is_writable = true;
    assert!(send(&mut f.svm, &operator, &[&operator, &creator_key], &[approve]));
    // No time advance at all: the creator's own signature needs no review delay.
    assert!(send(&mut f.svm, &operator, &[&operator, &creator_key], &[pay]));
    assert_eq!(f.svm.get_balance(&recipient).unwrap(), 2_000_000 + amount);
}
