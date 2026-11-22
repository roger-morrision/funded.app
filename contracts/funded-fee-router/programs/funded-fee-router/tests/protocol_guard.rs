// Mainnet protocol guard: pause, guardian, daily outflow cap and the reward
// cycle review delay, exercised against the compiled Mainnet bytecode.
#![cfg(feature = "mainnet-v3-program")]
use {
    anchor_lang::{prelude::{Clock, Pubkey}, solana_program::{instruction::Instruction, system_instruction}, InstructionData, ToAccountMetas},
    litesvm::LiteSVM,
    solana_keypair_lite::Keypair,
    solana_message_lite::{Message, VersionedMessage},
    solana_sha256_hasher::hashv,
    solana_signer_lite::Signer,
    solana_transaction_lite::versioned::VersionedTransaction,
};
mod support;

const DAY: i64 = 24 * 60 * 60;
const START: i64 = 1_800_000_000;

fn send(svm: &mut LiteSVM, payer: &Keypair, signers: &[&Keypair], instructions: &[Instruction]) -> bool {
    let message = Message::new_with_blockhash(instructions, Some(&payer.pubkey()), &svm.latest_blockhash());
    let transaction = VersionedTransaction::try_new(VersionedMessage::Legacy(message), signers).unwrap();
    let ok = svm.send_transaction(transaction).is_ok();
    svm.expire_blockhash();
    ok
}

fn set_time(svm: &mut LiteSVM, unix_timestamp: i64) {
    let mut clock = svm.get_sysvar::<Clock>();
    clock.unix_timestamp = unix_timestamp;
    svm.set_sysvar(&clock);
}

fn outstanding(svm: &LiteSVM, reserve: Pubkey) -> u64 {
    u64::from_le_bytes(svm.get_account(&reserve).unwrap().data[72..80].try_into().unwrap())
}

struct Fixture {
    svm: LiteSVM,
    program_id: Pubkey,
    program_data: Pubkey,
    operator: Keypair,
    owner: Keypair,
    guardian: Keypair,
    legacy_router: Pubkey,
    vault: Pubkey,
    reserve: Pubkey,
}

fn fixture() -> Fixture {
    let program_id = funded_fee_router::id();
    let mut svm = LiteSVM::new();
    svm.add_program(program_id, &support::program_bytes()).unwrap();
    set_time(&mut svm, START);
    let (operator, owner, guardian) = (Keypair::new(), Keypair::new(), Keypair::new());
    let program_data = support::set_upgrade_owner(&mut svm, program_id, owner.pubkey());
    for key in [&operator, &owner, &guardian] { svm.airdrop(&key.pubkey(), 2_000_000_000).unwrap(); }
    let (legacy_router, _) = Pubkey::find_program_address(&[b"funded-fee-router-v1"], &program_id);
    let init = Instruction::new_with_bytes(program_id, &funded_fee_router::instruction::Initialize {}.data(),
        funded_fee_router::accounts::Initialize { authority:operator.pubkey(), app_owner:owner.pubkey(), router:legacy_router,
            program:program_id, program_data, system_program:anchor_lang::system_program::ID }.to_account_metas(None));
    assert!(send(&mut svm, &operator, &[&operator, &owner], &[init]));
    assert_eq!(svm.get_account(&legacy_router).unwrap().data.len(), funded_fee_router::ROUTER_DATA_LEN);

    let coin = Pubkey::new_unique();
    let vault = Pubkey::find_program_address(&[b"reward-vault-v1", operator.pubkey().as_ref(), coin.as_ref()], &program_id).0;
    let reserve = Pubkey::find_program_address(&[b"reward-reserve-v1", vault.as_ref(), Pubkey::default().as_ref()], &program_id).0;
    let init_vault = Instruction::new_with_bytes(program_id, &funded_fee_router::instruction::InitializeRewardVault {}.data(),
        funded_fee_router::accounts::InitializeRewardVault { authority:operator.pubkey(), mint:coin, vault, legacy_router,
            system_program:anchor_lang::system_program::ID }.to_account_metas(None));
    let init_reserve = Instruction::new_with_bytes(program_id, &funded_fee_router::instruction::InitializeRewardReserve { asset_mint:Pubkey::default() }.data(),
        funded_fee_router::accounts::InitializeRewardReserve { authority:operator.pubkey(), vault, reserve, legacy_router,
            system_program:anchor_lang::system_program::ID }.to_account_metas(None));
    let fund = system_instruction::transfer(&operator.pubkey(), &vault, 100_000_000);
    assert!(send(&mut svm, &operator, &[&operator], &[init_vault, init_reserve, fund]));
    Fixture { svm, program_id, program_data, operator, owner, guardian, legacy_router, vault, reserve }
}

fn configure(f: &Fixture, signer: Pubkey, guardian: Pubkey, cap: u64) -> Instruction {
    Instruction::new_with_bytes(f.program_id, &funded_fee_router::instruction::ConfigureProtocolGuard { daily_cap_lamports:cap }.data(),
        funded_fee_router::accounts::ConfigureGuard { upgrade_owner:signer, guardian, legacy_router:f.legacy_router,
            program:f.program_id, program_data:f.program_data }.to_account_metas(None))
}

fn pause(f: &Fixture, signer: Pubkey, paused: bool) -> Instruction {
    Instruction::new_with_bytes(f.program_id, &funded_fee_router::instruction::SetProtocolPause { paused }.data(),
        funded_fee_router::accounts::SetProtocolPause { signer, legacy_router:f.legacy_router,
            program:f.program_id, program_data:f.program_data }.to_account_metas(None))
}

fn cycle_address(f: &Fixture, id: u8) -> Pubkey {
    Pubkey::find_program_address(&[b"reward-cycle-v1", f.vault.as_ref(), &[id; 32]], &f.program_id).0
}

fn create_cycle(f: &Fixture, id: u8, root: [u8; 32], total: u64, payout_at: i64, writable_router: bool) -> Instruction {
    let mut ix = Instruction::new_with_bytes(f.program_id, &funded_fee_router::instruction::CreateRewardCycle {
        cycle_id:[id; 32], merkle_root:root, asset_mint:Pubkey::default(), total_amount:total,
        cutoff_at:START, payout_at, leaf_count:1 }.data(),
        funded_fee_router::accounts::CreateRewardCycle { authority:f.operator.pubkey(), vault:f.vault, reserve:f.reserve,
            cycle:cycle_address(f, id), legacy_router:f.legacy_router, system_program:anchor_lang::system_program::ID }.to_account_metas(None));
    for meta in ix.accounts.iter_mut() { if meta.pubkey == f.legacy_router { meta.is_writable = writable_router; } }
    ix
}

fn leaf(cycle_id: [u8; 32], recipient: Pubkey, amount: u64) -> [u8; 32] {
    hashv(&[b"funded-reward-leaf-v1", &cycle_id, recipient.as_ref(), Pubkey::default().as_ref(),
        &amount.to_le_bytes(), &0u32.to_le_bytes()]).to_bytes()
}

#[test]
fn outflows_stay_closed_until_the_upgrade_owner_configures_the_guard() {
    let mut f = fixture();
    let ix = create_cycle(&f, 1, [1; 32], 100, START + DAY, true);
    let op = f.operator.insecure_clone();
    assert!(!send(&mut f.svm, &op, &[&op], &[ix]), "the default daily cap is zero");

    // Neither the hot operator nor the guardian may configure the guard, and
    // the guardian may not be the operator itself.
    let by_operator = configure(&f, op.pubkey(), f.guardian.pubkey(), 1_000);
    assert!(!send(&mut f.svm, &op, &[&op], &[by_operator]));
    let owner = f.owner.insecure_clone();
    let operator_as_guardian = configure(&f, owner.pubkey(), op.pubkey(), 1_000);
    assert!(!send(&mut f.svm, &owner, &[&owner], &[operator_as_guardian]));
    let ok = configure(&f, owner.pubkey(), f.guardian.pubkey(), 1_000);
    assert!(send(&mut f.svm, &owner, &[&owner], &[ok]));
}

#[test]
fn reward_cycles_need_the_review_delay_and_respect_the_daily_cap() {
    let mut f = fixture();
    let (op, owner) = (f.operator.insecure_clone(), f.owner.insecure_clone());
    let ix = configure(&f, owner.pubkey(), f.guardian.pubkey(), 1_000);
    assert!(send(&mut f.svm, &owner, &[&owner], &[ix]));

    let too_soon = create_cycle(&f, 1, [1; 32], 600, START + DAY - 1, true);
    assert!(!send(&mut f.svm, &op, &[&op], &[too_soon]), "payout inside the 24h review delay");
    let read_only = create_cycle(&f, 1, [1; 32], 600, START + DAY, false);
    assert!(!send(&mut f.svm, &op, &[&op], &[read_only]), "cap accounting needs the writable header");
    let first = create_cycle(&f, 1, [1; 32], 600, START + DAY, true);
    assert!(send(&mut f.svm, &op, &[&op], &[first]));
    let over = create_cycle(&f, 2, [1; 32], 401, START + DAY, true);
    assert!(!send(&mut f.svm, &op, &[&op], &[over]), "600 + 401 exceeds the 1,000 daily cap");
    let fill = create_cycle(&f, 2, [1; 32], 400, START + DAY, true);
    assert!(send(&mut f.svm, &op, &[&op], &[fill]));
    assert_eq!(outstanding(&f.svm, f.reserve), 1_000);

    // The window resets on the next UTC day.
    set_time(&mut f.svm, START + DAY);
    let next_day = create_cycle(&f, 3, [1; 32], 900, START + 2 * DAY, true);
    assert!(send(&mut f.svm, &op, &[&op], &[next_day]));
}

#[test]
fn guardian_pauses_and_cancels_but_only_the_upgrade_owner_unpauses() {
    let mut f = fixture();
    let (op, owner, guardian) = (f.operator.insecure_clone(), f.owner.insecure_clone(), f.guardian.insecure_clone());
    let ix = configure(&f, owner.pubkey(), guardian.pubkey(), 10_000_000);
    assert!(send(&mut f.svm, &owner, &[&owner], &[ix]));

    let recipient = Keypair::new();
    let cycle_id = [7u8; 32];
    let root = leaf(cycle_id, recipient.pubkey(), 500);
    let create = create_cycle(&f, 7, root, 500, START + DAY, true);
    assert!(send(&mut f.svm, &op, &[&op], &[create]));
    let paid = Keypair::new();
    let create = create_cycle(&f, 9, leaf([9u8; 32], paid.pubkey(), 2_000_000), 2_000_000, START + DAY, true);
    assert!(send(&mut f.svm, &op, &[&op], &[create]));

    // A stranger cannot pause; the guardian can, and that blocks the operator.
    let stranger = Keypair::new();
    f.svm.airdrop(&stranger.pubkey(), 10_000_000).unwrap();
    let ix = pause(&f, stranger.pubkey(), true);
    assert!(!send(&mut f.svm, &stranger, &[&stranger], &[ix]));
    let ix = pause(&f, guardian.pubkey(), true);
    assert!(send(&mut f.svm, &guardian, &[&guardian], &[ix]));
    let blocked = create_cycle(&f, 8, [1; 32], 10, START + DAY, true);
    assert!(!send(&mut f.svm, &op, &[&op], &[blocked]), "paused");
    let ix = pause(&f, guardian.pubkey(), false);
    assert!(!send(&mut f.svm, &guardian, &[&guardian], &[ix]), "guardian cannot unpause");
    let ix = pause(&f, owner.pubkey(), false);
    assert!(send(&mut f.svm, &owner, &[&owner], &[ix]));

    // The guardian cancels the cycle during its review window; nothing pays.
    let cycle = cycle_address(&f, 7);
    let cancel = |signer: Pubkey| Instruction::new_with_bytes(f.program_id, &funded_fee_router::instruction::CancelRewardCycle {}.data(),
        funded_fee_router::accounts::CancelRewardCycle { signer, legacy_router:f.legacy_router, program:f.program_id,
            program_data:f.program_data, reserve:f.reserve, cycle }.to_account_metas(None));
    let ix = cancel(stranger.pubkey());
    assert!(!send(&mut f.svm, &stranger, &[&stranger], &[ix]));
    let ix = cancel(op.pubkey());
    assert!(!send(&mut f.svm, &op, &[&op], &[ix]), "the hot operator cannot cancel");
    let ix = cancel(guardian.pubkey());
    assert!(send(&mut f.svm, &guardian, &[&guardian], &[ix]));
    assert_eq!(outstanding(&f.svm, f.reserve), 2_000_000, "only cycle 9 stays committed");

    set_time(&mut f.svm, START + DAY);
    let payment = Pubkey::find_program_address(&[b"reward-payment-v1", cycle.as_ref(), recipient.pubkey().as_ref()], &f.program_id).0;
    let mut payout = Instruction::new_with_bytes(f.program_id, &funded_fee_router::instruction::PayoutRewardSol { amount:500, leaf_index:0, proof:vec![] }.data(),
        funded_fee_router::accounts::PayoutRewardSol { payer:op.pubkey(), vault:f.vault, reserve:f.reserve, cycle,
            recipient:recipient.pubkey(), payment, system_program:anchor_lang::system_program::ID }.to_account_metas(None));
    payout.accounts.push(anchor_lang::solana_program::instruction::AccountMeta::new(f.legacy_router, false));
    assert!(!send(&mut f.svm, &op, &[&op], &[payout]), "a cancelled cycle never pays");

    // An uncancelled cycle pays normally once its review delay has passed.
    let cycle = cycle_address(&f, 9);
    let payment = Pubkey::find_program_address(&[b"reward-payment-v1", cycle.as_ref(), paid.pubkey().as_ref()], &f.program_id).0;
    let mut payout = Instruction::new_with_bytes(f.program_id, &funded_fee_router::instruction::PayoutRewardSol { amount:2_000_000, leaf_index:0, proof:vec![] }.data(),
        funded_fee_router::accounts::PayoutRewardSol { payer:op.pubkey(), vault:f.vault, reserve:f.reserve, cycle,
            recipient:paid.pubkey(), payment, system_program:anchor_lang::system_program::ID }.to_account_metas(None));
    payout.accounts.push(anchor_lang::solana_program::instruction::AccountMeta::new(f.legacy_router, false));
    assert!(send(&mut f.svm, &op, &[&op], &[payout]));
    assert_eq!(f.svm.get_account(&paid.pubkey()).unwrap().lamports, 2_000_000);
}

fn payout(f: &Fixture, id: u8, recipient: Pubkey, amount: u64) -> Instruction {
    let cycle = cycle_address(f, id);
    let payment = Pubkey::find_program_address(&[b"reward-payment-v1", cycle.as_ref(), recipient.as_ref()], &f.program_id).0;
    let mut ix = Instruction::new_with_bytes(f.program_id,
        &funded_fee_router::instruction::PayoutRewardSol { amount, leaf_index:0, proof:vec![] }.data(),
        funded_fee_router::accounts::PayoutRewardSol { payer:f.operator.pubkey(), vault:f.vault, reserve:f.reserve,
            cycle, recipient, payment, system_program:anchor_lang::system_program::ID }.to_account_metas(None));
    ix.accounts.push(anchor_lang::solana_program::instruction::AccountMeta::new(f.legacy_router, false));
    ix
}

fn assert_rejected_without_payout(f: &mut Fixture, ix: Instruction) {
    let op = f.operator.insecure_clone();
    // Ignore only the transaction fee payer: every custody, liability, receipt,
    // recipient and guard account must be byte-for-byte unchanged on failure.
    let before: Vec<_> = ix.accounts.iter().filter(|meta| meta.pubkey != op.pubkey())
        .map(|meta| (meta.pubkey, f.svm.get_account(&meta.pubkey))).collect();
    assert!(!send(&mut f.svm, &op, &[&op], &[ix]));
    for (key, account) in before { assert_eq!(f.svm.get_account(&key), account, "changed account {key}"); }
}

#[test]
fn mature_payout_requires_the_real_writable_unpaused_guard() {
    let mut f = fixture();
    let (op, owner, guardian) = (f.operator.insecure_clone(), f.owner.insecure_clone(), f.guardian.insecure_clone());
    let recipient = Pubkey::new_unique();
    f.svm.airdrop(&recipient, 1_000_000).unwrap();
    let configure = configure(&f, owner.pubkey(), guardian.pubkey(), 1_000);
    let create = create_cycle(&f, 1, leaf([1;32], recipient, 600), 600, START + DAY, true);
    assert!(send(&mut f.svm, &owner, &[&owner], &[configure]));
    assert!(send(&mut f.svm, &op, &[&op], &[create]));
    set_time(&mut f.svm, START + DAY);
    let valid = payout(&f, 1, recipient, 600);
    let mut missing = valid.clone(); missing.accounts.pop();
    assert_rejected_without_payout(&mut f, missing);
    let mut read_only = valid.clone(); read_only.accounts.last_mut().unwrap().is_writable = false;
    assert_rejected_without_payout(&mut f, read_only);
    let fake = Pubkey::new_unique();
    f.svm.set_account(fake, f.svm.get_account(&f.legacy_router).unwrap()).unwrap();
    let mut forged = valid.clone(); forged.accounts.last_mut().unwrap().pubkey = fake;
    assert_rejected_without_payout(&mut f, forged);
    let pause_ix = pause(&f, guardian.pubkey(), true);
    assert!(send(&mut f.svm, &guardian, &[&guardian], &[pause_ix]));
    assert_rejected_without_payout(&mut f, valid.clone());
    let unpause = pause(&f, owner.pubkey(), false);
    assert!(send(&mut f.svm, &owner, &[&owner], &[unpause]));
    assert!(send(&mut f.svm, &op, &[&op], &[valid.clone()]));
    assert_eq!(f.svm.get_account(&recipient).unwrap().lamports, 1_000_600);
    assert_eq!(outstanding(&f.svm, f.reserve), 0);
    assert_rejected_without_payout(&mut f, valid);
}

#[test]
fn queued_cycles_cannot_bypass_the_actual_payout_days_cap() {
    let mut f = fixture();
    let (op, owner) = (f.operator.insecure_clone(), f.owner.insecure_clone());
    let recipient = Pubkey::new_unique();
    f.svm.airdrop(&recipient, 1_000_000).unwrap();
    let config = configure(&f, owner.pubkey(), f.guardian.pubkey(), 1_000);
    assert!(send(&mut f.svm, &owner, &[&owner], &[config]));
    for id in 1..=2 {
        set_time(&mut f.svm, START + (id as i64 - 1) * DAY);
        let ix = create_cycle(&f, id, leaf([id;32], recipient, 600), 600, START + 2 * DAY, true);
        assert!(send(&mut f.svm, &op, &[&op], &[ix]));
    }
    set_time(&mut f.svm, START + 2 * DAY);
    let first = payout(&f, 1, recipient, 600);
    assert!(send(&mut f.svm, &op, &[&op], &[first]));
    let second = payout(&f, 2, recipient, 600);
    assert_rejected_without_payout(&mut f, second.clone());
    assert_eq!(outstanding(&f.svm, f.reserve), 600);
    set_time(&mut f.svm, START + 3 * DAY);
    assert!(send(&mut f.svm, &op, &[&op], &[second]));
    assert_eq!(outstanding(&f.svm, f.reserve), 0);
    assert_eq!(f.svm.get_account(&recipient).unwrap().lamports, 1_001_200);
}

#[test]
fn token_rewards_obey_pause_and_preserve_custody_on_rejection() {
    use anchor_lang::solana_program::{program_pack::Pack, program_option::COption, instruction::AccountMeta};
    use anchor_spl::{associated_token::get_associated_token_address, token::spl_token};
    use std::str::FromStr;
    let mut f = fixture();
    let (op, owner, guardian) = (f.operator.insecure_clone(), f.owner.insecure_clone(), f.guardian.insecure_clone());
    let config = configure(&f, owner.pubkey(), guardian.pubkey(), 1_000);
    assert!(send(&mut f.svm, &owner, &[&owner], &[config]));
    // Public Mainnet mint metadata observed on 2026-11-22. Accounts and balances
    // below are synthetic LiteSVM fixtures, not Mainnet transaction evidence.
    let mint = Pubkey::from_str("Bv1a7cEj5aRnJQhMw4kRQqAFesMSd5LwcDnUzq52BMmr").unwrap();
    let mut mint_data = vec![0; spl_token::state::Mint::LEN];
    spl_token::state::Mint::pack(spl_token::state::Mint { mint_authority:COption::None,
        supply:850_759_134_614_662, decimals:6, is_initialized:true, freeze_authority:COption::None }, &mut mint_data).unwrap();
    f.svm.set_account(mint, solana_account::Account { lamports:2_000_000, data:mint_data,
        owner:spl_token::ID, executable:false, rent_epoch:0 }).unwrap();
    let recipient = Pubkey::new_unique();
    let vault_token = get_associated_token_address(&f.vault, &mint);
    let recipient_token = get_associated_token_address(&recipient, &mint);
    for (address, token_owner, amount) in [(vault_token, f.vault, 1_000), (recipient_token, recipient, 0)] {
        let mut data = vec![0; spl_token::state::Account::LEN];
        spl_token::state::Account::pack(spl_token::state::Account { mint, owner:token_owner, amount,
            delegate:COption::None, state:spl_token::state::AccountState::Initialized, is_native:COption::None,
            delegated_amount:0, close_authority:COption::None }, &mut data).unwrap();
        f.svm.set_account(address, solana_account::Account { lamports:3_000_000, data,
            owner:spl_token::ID, executable:false, rent_epoch:0 }).unwrap();
    }
    let reserve = Pubkey::find_program_address(&[b"reward-reserve-v1", f.vault.as_ref(), mint.as_ref()], &f.program_id).0;
    let init = Instruction::new_with_bytes(f.program_id,
        &funded_fee_router::instruction::InitializeRewardReserve { asset_mint:mint }.data(),
        funded_fee_router::accounts::InitializeRewardReserve { authority:op.pubkey(), vault:f.vault, reserve,
            legacy_router:f.legacy_router, system_program:anchor_lang::system_program::ID }.to_account_metas(None));
    assert!(send(&mut f.svm, &op, &[&op], &[init]));
    let cycle = cycle_address(&f, 20);
    let root = hashv(&[b"funded-reward-leaf-v1", &[20;32], recipient.as_ref(), mint.as_ref(),
        &600u64.to_le_bytes(), &0u32.to_le_bytes()]).to_bytes();
    let create = Instruction::new_with_bytes(f.program_id,
        &funded_fee_router::instruction::CreateRewardCycleToken { cycle_id:[20;32], merkle_root:root,
            asset_mint:mint, total_amount:600, cutoff_at:START, payout_at:START+DAY, leaf_count:1 }.data(),
        funded_fee_router::accounts::CreateRewardCycleToken { authority:op.pubkey(), vault:f.vault, reserve,
            cycle, token_mint:mint, vault_token_account:vault_token, legacy_router:f.legacy_router,
            system_program:anchor_lang::system_program::ID }.to_account_metas(None));
    assert!(send(&mut f.svm, &op, &[&op], &[create]));
    set_time(&mut f.svm, START+DAY);
    let payment = Pubkey::find_program_address(&[b"reward-payment-v1", cycle.as_ref(), recipient.as_ref()], &f.program_id).0;
    let mut pay = Instruction::new_with_bytes(f.program_id,
        &funded_fee_router::instruction::PayoutRewardToken { amount:600, leaf_index:0, proof:vec![] }.data(),
        funded_fee_router::accounts::PayoutRewardToken { payer:op.pubkey(), vault:f.vault, reserve, cycle,
            recipient, asset_mint:mint, vault_token_account:vault_token, recipient_token_account:recipient_token,
            payment, token_program:spl_token::ID, system_program:anchor_lang::system_program::ID }.to_account_metas(None));
    assert_rejected_without_payout(&mut f, pay.clone());
    pay.accounts.push(AccountMeta::new_readonly(f.legacy_router, false));
    let pause_ix = pause(&f, guardian.pubkey(), true);
    assert!(send(&mut f.svm, &guardian, &[&guardian], &[pause_ix]));
    assert_rejected_without_payout(&mut f, pay.clone());
    let unpause = pause(&f, owner.pubkey(), false);
    assert!(send(&mut f.svm, &owner, &[&owner], &[unpause]));
    assert!(send(&mut f.svm, &op, &[&op], &[pay.clone()]));
    let balance = |key| spl_token::state::Account::unpack(&f.svm.get_account(&key).unwrap().data).unwrap().amount;
    assert_eq!(balance(vault_token), 400);
    assert_eq!(balance(recipient_token), 600);
    assert_eq!(outstanding(&f.svm, reserve), 0);
    assert_rejected_without_payout(&mut f, pay);
}

fn promotion(f: &mut Fixture, amount: u64) -> Instruction {
    use anchor_lang::AccountSerialize;
    let mint = Pubkey::new_unique();
    let recipient = Pubkey::new_unique();
    f.svm.airdrop(&recipient, 1_000_000).unwrap();
    let (policy, bump) = Pubkey::find_program_address(&[b"mint-agency-policy-v3", mint.as_ref()], &f.program_id);
    let vault = Pubkey::find_program_address(&[b"mint-fee-vault-v3", mint.as_ref(), &[7]], &f.program_id).0;
    let receipt = Pubkey::find_program_address(&[b"agency-promotion-v3", mint.as_ref(), &1u64.to_le_bytes()], &f.program_id).0;
    // Synthetic already-settled policy: no network state or real funds.
    let mut paid = [0;8]; paid[7] = 2_000;
    let state = funded_fee_router::MintAgencyPolicyV3 { mint, creator:Pubkey::new_unique(), authority:f.operator.pubkey(),
        protocol_units:[800_000,100_000,0,0,400_000,500_000,200_000], settled_lamports:100_000,
        paid_lamports:paid, withdrawn_lamports:[0;8], directed_units:[4_000_000,4_000_000,0],
        directed_released:[0;3], selected_agents:1, agent_spent:[0;3], completed_agents:0,
        last_promotion_at:0, promotion_sequence:0, promotion_recipient:recipient, config_revision:0, bump };
    let mut data = Vec::new(); state.try_serialize(&mut data).unwrap();
    f.svm.set_account(policy, solana_account::Account { lamports:10_000_000, data,
        owner:f.program_id, executable:false, rent_epoch:0 }).unwrap();
    f.svm.airdrop(&vault, 1_000_000).unwrap();
    let mut ix = Instruction::new_with_bytes(f.program_id,
        &funded_fee_router::instruction::BillAgencyPromotionV3 { post_id:1, delivery_hash:[1;32],
            sequence:0, amount, posted_at:START }.data(),
        funded_fee_router::accounts::BillAgencyPromotionV3 { authority:f.operator.pubkey(), mint, legacy_router:f.legacy_router,
            policy, vault, recipient, receipt, system_program:anchor_lang::system_program::ID }.to_account_metas(None));
    ix.accounts[2].is_writable = true;
    ix
}

#[test]
fn agency_promotion_uses_the_shared_sol_cap_and_rolls_back_failed_billing() {
    let mut f = fixture();
    let (op, owner, guardian) = (f.operator.insecure_clone(), f.owner.insecure_clone(), f.guardian.insecure_clone());
    let config = configure(&f, owner.pubkey(), guardian.pubkey(), 1_000);
    assert!(send(&mut f.svm, &owner, &[&owner], &[config]));
    let first = promotion(&mut f, 600);
    let mut read_only = first.clone(); read_only.accounts[2].is_writable = false;
    assert_rejected_without_payout(&mut f, read_only);
    let pause_ix = pause(&f, guardian.pubkey(), true);
    assert!(send(&mut f.svm, &guardian, &[&guardian], &[pause_ix]));
    assert_rejected_without_payout(&mut f, first.clone());
    let unpause = pause(&f, owner.pubkey(), false);
    assert!(send(&mut f.svm, &owner, &[&owner], &[unpause]));
    assert!(send(&mut f.svm, &op, &[&op], &[first.clone()]));
    assert_eq!(f.svm.get_account(&first.accounts[5].pubkey).unwrap().lamports, 1_000_600);
    assert_rejected_without_payout(&mut f, first);
    let second = promotion(&mut f, 500);
    assert_rejected_without_payout(&mut f, second.clone());
    set_time(&mut f.svm, START + DAY);
    assert!(send(&mut f.svm, &op, &[&op], &[second.clone()]));
    assert_eq!(f.svm.get_account(&second.accounts[5].pubkey).unwrap().lamports, 1_000_500);
}
