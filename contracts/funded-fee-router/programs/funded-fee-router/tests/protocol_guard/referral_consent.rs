use super::{configure, fixture, send};
use anchor_lang::{
    prelude::Pubkey,
    solana_program::{instruction::{AccountMeta, Instruction}, system_instruction},
    AccountDeserialize, InstructionData, ToAccountMetas,
};
use funded_fee_router::{accounts, instruction, MintFeePolicyV3, MintWithdrawalApprovalV3};
use solana_keypair_lite::Keypair;
use solana_signer_lite::Signer;

fn ix(data: impl InstructionData, accounts: impl ToAccountMetas) -> Instruction {
    Instruction::new_with_bytes(funded_fee_router::id(), &data.data(), accounts.to_account_metas(None))
}

// An authentic automation PDA chosen by the actual hot operator is the attack
// setup. A wrong-authority or fabricated-account test would miss this boundary.
#[test]
fn operator_chosen_referrals_require_creator_consent_at_approval_and_payment() {
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
    let guard = configure(&f, f.owner.pubkey(), f.guardian.pubkey(), 100);
    assert!(send(&mut f.svm, &f.owner, &[&f.owner], &[guard]));
    let init = ix(instruction::InitializeProtectedMintV3 {
        protocol_units: [500_000, 500_000, 500_000, 500_000, 0, 0],
        directed_units: [8_000_000, 0, 0],
    }, accounts::InitializeProtectedMintV3 { authority, creator, mint, legacy_router, router, policy, system_program });
    assert!(send(&mut f.svm, &creator_key, &[&creator_key, &coin], &[init]));
    let claim_id = [151; 32];
    let claim = pda(&[funded_fee_router::MINT_CLAIM_V3_SEED, mint.as_ref(), &claim_id]);
    let mut settle = ix(instruction::SettleMintV3 { claim_id, expected_lamports: 5_000 },
        accounts::SettleMintV3 { authority, creator, mint, legacy_router, router, policy, claim, system_program });
    let vaults: [Pubkey; 7] = std::array::from_fn(|n| pda(&[funded_fee_router::MINT_VAULT_V3_SEED, mint.as_ref(), &[n as u8]]));
    settle.accounts.extend(vaults.map(|key| AccountMeta::new(key, false)));
    assert!(send(&mut f.svm, &operator, &[&operator, &creator_key],
        &[system_instruction::transfer(&authority, &router, 5_000), settle]));
    let automation_init = ix(instruction::InitializeMintAutomationV3 { recipients: [recipient; 4] },
        accounts::InitializeMintAutomationV3 { authority, creator, mint, legacy_router, policy, automation, system_program });
    assert!(send(&mut f.svm, &operator, &[&operator], &[automation_init]));

    for category in 2..=4u8 {
        let amount = 250; // Larger than the operations cap; earned referrals are not operations spending.
        let withdrawal_id = [category + 151; 32];
        let approval = pda(&[funded_fee_router::MINT_APPROVAL_V3_SEED, mint.as_ref(), &withdrawal_id]);
        let withdrawal = pda(&[funded_fee_router::MINT_WITHDRAWAL_V3_SEED, mint.as_ref(), &withdrawal_id]);
        let mut approve = ix(instruction::ApproveProtectedWithdrawalV3 {
            withdrawal_id, category, beneficiary: category + 2, amount,
        }, accounts::ApproveProtectedWithdrawalV3 { authority, creator, mint, legacy_router, policy, recipient, approval, system_program });
        let mut pay = ix(instruction::DisburseProtectedMintV3 {
            withdrawal_id, category, beneficiary: category + 2, amount, holder_amount: 0,
        }, accounts::DisburseProtectedMintV3 { authority, creator, mint, legacy_router, policy,
            vault: vaults[usize::from(category)], recipient, approval, withdrawal, system_program });
        for instruction in [&mut approve, &mut pay] {
            instruction.accounts[1].is_signer = false;
            instruction.accounts.push(AccountMeta::new_readonly(automation, false));
        }
        let tracked = [legacy_router, policy, vaults[usize::from(category)], recipient, approval, withdrawal];
        let before = tracked.map(|key| f.svm.get_account(&key));
        let approved_by_operator = send(&mut f.svm, &operator, &[&operator], &[approve.clone()]);
        let paid_by_operator = approved_by_operator && send(&mut f.svm, &operator, &[&operator], &[pay.clone()]);
        assert!(!paid_by_operator, "hot operator redirected category {category} without creator consent");
        assert!(!approved_by_operator, "hot operator created category {category} approval without creator consent");
        assert_eq!(tracked.map(|key| f.svm.get_account(&key)), before);

        approve.accounts[1].is_signer = true;
        assert!(send(&mut f.svm, &operator, &[&operator, &creator_key], &[approve]));
        let before = tracked.map(|key| f.svm.get_account(&key));
        assert!(!send(&mut f.svm, &operator, &[&operator], &[pay.clone()]));
        assert_eq!(tracked.map(|key| f.svm.get_account(&key)), before);
        let saved = f.svm.get_account(&approval).unwrap();
        assert!(!MintWithdrawalApprovalV3::try_deserialize(&mut saved.data.as_slice()).unwrap().consumed);

        let recipient_before = f.svm.get_balance(&recipient).unwrap();
        let vault_before = f.svm.get_balance(&vaults[usize::from(category)]).unwrap();
        pay.accounts[1].is_signer = true;
        assert!(send(&mut f.svm, &operator, &[&operator, &creator_key], &[pay.clone()]));
        assert_eq!(f.svm.get_balance(&recipient).unwrap(), recipient_before + amount);
        assert_eq!(f.svm.get_balance(&vaults[usize::from(category)]).unwrap(), vault_before - amount);
        let before = tracked.map(|key| f.svm.get_account(&key));
        assert!(!send(&mut f.svm, &operator, &[&operator, &creator_key], &[pay]));
        assert_eq!(tracked.map(|key| f.svm.get_account(&key)), before);
    }
    let saved = f.svm.get_account(&policy).unwrap();
    assert_eq!(MintFeePolicyV3::try_deserialize(&mut saved.data.as_slice()).unwrap().withdrawn_lamports,
        [0, 0, 250, 250, 250, 0, 0]);
}
