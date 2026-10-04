use anchor_lang::{
    prelude::{Clock, Pubkey},
    solana_program::instruction::Instruction,
    AccountSerialize, InstructionData, ToAccountMetas,
};
use funded_fee_router::{RewardCycle, RewardVault};
use litesvm::LiteSVM;
use solana_account::Account;
use solana_keypair::Keypair;
use solana_message::{Message, VersionedMessage};
use solana_sha256_hasher::hashv;
use solana_signer::Signer;
use solana_transaction::versioned::VersionedTransaction;

fn send(svm: &mut LiteSVM, payer: &Keypair, instruction: Instruction) -> bool {
    let message = Message::new_with_blockhash(&[instruction], Some(&payer.pubkey()), &svm.latest_blockhash());
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(message), &[payer]).unwrap();
    svm.send_transaction(tx).is_ok()
}

fn store(svm: &mut LiteSVM, key: Pubkey, value: &impl AccountSerialize, lamports: u64) {
    let mut data = Vec::new();
    value.try_serialize(&mut data).unwrap();
    svm.set_account(key, Account { lamports, data, owner: funded_fee_router::id(), executable: false, rent_epoch: 0 }).unwrap();
}

#[test]
fn sol_reward_rejects_wrong_proof_early_payment_replay_and_self_payment() {
    let program_id = funded_fee_router::id();
    let mut svm = LiteSVM::new();
    svm.add_program(program_id, include_bytes!("../../../target/deploy/funded_fee_router.so")).unwrap();
    let payer = Keypair::new();
    svm.airdrop(&payer.pubkey(), 1_000_000_000).unwrap();
    let mint = Pubkey::new_unique();
    let recipient = Pubkey::new_unique();
    let amount = 10_000_000u64;
    let cycle_id = [31; 32];
    let (vault, vault_bump) = Pubkey::find_program_address(&[b"reward-vault-v1", payer.pubkey().as_ref(), mint.as_ref()], &program_id);
    let (cycle, cycle_bump) = Pubkey::find_program_address(&[b"reward-cycle-v1", vault.as_ref(), &cycle_id], &program_id);
    let payment = Pubkey::find_program_address(&[b"reward-payment-v1", cycle.as_ref(), recipient.as_ref()], &program_id).0;
    let root = hashv(&[b"funded-reward-leaf-v1", &cycle_id, recipient.as_ref(), Pubkey::default().as_ref(), &amount.to_le_bytes(), &0u32.to_le_bytes()]).to_bytes();
    store(&mut svm, vault, &RewardVault { authority: payer.pubkey(), mint, bump: vault_bump }, 100_000_000);
    let mut cycle_data = RewardCycle { vault, cycle_id, merkle_root: root, asset_mint: Pubkey::default(), total_amount: amount,
        distributed_amount: 0, cutoff_at: 100, payout_at: 200, leaf_count: 1, bump: cycle_bump };
    store(&mut svm, cycle, &cycle_data, 10_000_000);
    let make_instruction = |recipient, payment, value| Instruction::new_with_bytes(program_id,
        &funded_fee_router::instruction::PayoutRewardSol { amount: value, leaf_index: 0, proof: vec![] }.data(),
        funded_fee_router::accounts::PayoutRewardSol { payer: payer.pubkey(), vault, cycle, recipient, payment,
            system_program: anchor_lang::system_program::ID }.to_account_metas(None));
    let mut clock = svm.get_sysvar::<Clock>();
    clock.unix_timestamp = 199;
    svm.set_sysvar(&clock);
    assert!(!send(&mut svm, &payer, make_instruction(recipient, payment, amount)));
    assert!(svm.get_account(&payment).is_none());
    assert_eq!(svm.get_account(&vault).unwrap().lamports, 100_000_000);
    clock.unix_timestamp = 200;
    svm.set_sysvar(&clock);
    svm.expire_blockhash();
    assert!(!send(&mut svm, &payer, make_instruction(recipient, payment, amount - 1)));
    assert!(svm.get_account(&payment).is_none());
    assert!(send(&mut svm, &payer, make_instruction(recipient, payment, amount)));
    assert_eq!(svm.get_account(&recipient).unwrap().lamports, amount);
    assert_eq!(svm.get_account(&vault).unwrap().lamports, 100_000_000 - amount);
    svm.expire_blockhash();
    assert!(!send(&mut svm, &payer, make_instruction(recipient, payment, amount)));
    assert_eq!(svm.get_account(&recipient).unwrap().lamports, amount);
    // Even an operator-committed root cannot count an internal self-transfer as paid.
    cycle_data.merkle_root = hashv(&[b"funded-reward-leaf-v1", &cycle_id, vault.as_ref(), Pubkey::default().as_ref(), &amount.to_le_bytes(), &0u32.to_le_bytes()]).to_bytes();
    store(&mut svm, cycle, &cycle_data, 10_000_000);
    let self_payment = Pubkey::find_program_address(&[b"reward-payment-v1", cycle.as_ref(), vault.as_ref()], &program_id).0;
    assert!(!send(&mut svm, &payer, make_instruction(vault, self_payment, amount)));
    assert!(svm.get_account(&self_payment).is_none());
    assert_eq!(svm.get_account(&vault).unwrap().lamports, 100_000_000 - amount);
}

#[test]
fn token_2022_reward_rejects_withheld_fee_and_rolls_back_obligation() {
    use anchor_lang::solana_program::system_instruction;
    use anchor_spl::{associated_token::{get_associated_token_address_with_program_id, spl_associated_token_account}, token_2022::spl_token_2022};
    use spl_token_2022::extension::{ExtensionType, transfer_fee::instruction::initialize_transfer_fee_config};
    for fee_bps in [0, 100] {
        let program_id = funded_fee_router::id();
        let mut svm = LiteSVM::new();
        svm.add_program(program_id, include_bytes!("../../../target/deploy/funded_fee_router.so")).unwrap();
        let payer = Keypair::new();
        let mint = Keypair::new();
        let recipient = Pubkey::new_unique();
        svm.airdrop(&payer.pubkey(), 1_000_000_000).unwrap();
        let token_program = spl_token_2022::ID;
        let mint_size = ExtensionType::try_calculate_account_len::<spl_token_2022::state::Mint>(&[ExtensionType::TransferFeeConfig]).unwrap();
        let instructions = [
            system_instruction::create_account(&payer.pubkey(), &mint.pubkey(), 10_000_000, mint_size as u64, &token_program),
            initialize_transfer_fee_config(&token_program, &mint.pubkey(), None, None, fee_bps, 100).unwrap(),
            spl_token_2022::instruction::initialize_mint2(&token_program, &mint.pubkey(), &payer.pubkey(), None, 0).unwrap(),
        ];
        let msg = Message::new_with_blockhash(&instructions, Some(&payer.pubkey()), &svm.latest_blockhash());
        let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&payer, &mint]).unwrap();
        svm.send_transaction(tx).unwrap();
        let (vault, bump) = Pubkey::find_program_address(&[b"reward-vault-v1", payer.pubkey().as_ref(), mint.pubkey().as_ref()], &program_id);
        store(&mut svm, vault, &RewardVault { authority: payer.pubkey(), mint: mint.pubkey(), bump }, 100_000_000);
        for owner in [vault, recipient] {
            assert!(send(&mut svm, &payer, spl_associated_token_account::instruction::create_associated_token_account(&payer.pubkey(), &owner, &mint.pubkey(), &token_program)));
        }
        let source = get_associated_token_address_with_program_id(&vault, &mint.pubkey(), &token_program);
        let destination = get_associated_token_address_with_program_id(&recipient, &mint.pubkey(), &token_program);
        assert!(send(&mut svm, &payer, spl_token_2022::instruction::mint_to(&token_program, &mint.pubkey(), &source, &payer.pubkey(), &[], 100).unwrap()));
        let cycle_id = [41; 32];
        let amount = 100u64;
        let (cycle, bump) = Pubkey::find_program_address(&[b"reward-cycle-v1", vault.as_ref(), &cycle_id], &program_id);
        let root = hashv(&[b"funded-reward-leaf-v1", &cycle_id, recipient.as_ref(), mint.pubkey().as_ref(), &amount.to_le_bytes(), &0u32.to_le_bytes()]).to_bytes();
        store(&mut svm, cycle, &RewardCycle { vault, cycle_id, merkle_root: root, asset_mint: mint.pubkey(), total_amount: amount,
            distributed_amount: 0, cutoff_at: 1, payout_at: 2, leaf_count: 1, bump }, 10_000_000);
        let mut clock = svm.get_sysvar::<Clock>();
        clock.unix_timestamp = 200;
        svm.set_sysvar(&clock);
        let payment = Pubkey::find_program_address(&[b"reward-payment-v1", cycle.as_ref(), recipient.as_ref()], &program_id).0;
        let payout = Instruction::new_with_bytes(program_id,
            &funded_fee_router::instruction::PayoutRewardToken { amount, leaf_index: 0, proof: vec![] }.data(),
            funded_fee_router::accounts::PayoutRewardToken { payer: payer.pubkey(), vault, cycle, recipient,
                asset_mint: mint.pubkey(), vault_token_account: source, recipient_token_account: destination,
                payment, token_program, system_program: anchor_lang::system_program::ID }.to_account_metas(None));
        let cycle_before = svm.get_account(&cycle).unwrap().data;
        let success = send(&mut svm, &payer, payout);
        let token_amount = |key| u64::from_le_bytes(svm.get_account(&key).unwrap().data[64..72].try_into().unwrap());
        if fee_bps == 0 {
            assert!(success);
            assert_eq!(token_amount(source), 0);
            assert_eq!(token_amount(destination), 100);
            assert!(svm.get_account(&payment).is_some());
        } else {
            assert!(!success);
            assert_eq!(token_amount(source), 100);
            assert_eq!(token_amount(destination), 0);
            assert!(svm.get_account(&payment).is_none());
            assert_eq!(svm.get_account(&cycle).unwrap().data, cycle_before);
        }
    }
}
