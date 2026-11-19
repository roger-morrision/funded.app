#![cfg(feature="devnet-v3-program")]
use {
    anchor_lang::{prelude::{Clock, Pubkey}, solana_program::{instruction::Instruction, program_pack::Pack, system_instruction}, InstructionData, ToAccountMetas},
    anchor_spl::{associated_token::{get_associated_token_address, spl_associated_token_account}, token::spl_token},
    litesvm::LiteSVM,
    solana_keypair_lite::Keypair,
    solana_message_lite::{Message, VersionedMessage},
    solana_sha256_hasher::hashv,
    solana_signer_lite::Signer,
    solana_transaction_lite::versioned::VersionedTransaction,
};
mod support;

fn send(svm: &mut LiteSVM, payer: &Keypair, signers: &[&Keypair], instructions: &[Instruction]) -> bool {
    let message = Message::new_with_blockhash(instructions, Some(&payer.pubkey()), &svm.latest_blockhash());
    let transaction = VersionedTransaction::try_new(VersionedMessage::Legacy(message), signers).unwrap();
    let ok = svm.send_transaction(transaction).is_ok();
    svm.expire_blockhash();
    ok
}

fn outstanding(svm: &LiteSVM, reserve: Pubkey) -> u64 {
    u64::from_le_bytes(svm.get_account(&reserve).unwrap().data[72..80].try_into().unwrap())
}

fn token_amount(svm: &LiteSVM, account: Pubkey) -> u64 {
    u64::from_le_bytes(svm.get_account(&account).unwrap().data[64..72].try_into().unwrap())
}

fn set_time(svm: &mut LiteSVM, unix_timestamp: i64) {
    let mut clock = svm.get_sysvar::<Clock>();
    clock.unix_timestamp = unix_timestamp;
    svm.set_sysvar(&clock);
}

fn reward_leaf(cycle_id: [u8; 32], recipient: Pubkey, asset: Pubkey, amount: u64, index: u32) -> [u8; 32] {
    hashv(&[b"funded-reward-leaf-v1", &cycle_id, recipient.as_ref(), asset.as_ref(), &amount.to_le_bytes(), &index.to_le_bytes()]).to_bytes()
}

// A token cycle with one payable leaf (60) and one leaf that is never paid (40,
// standing in for an owner that cannot hold a token account).
#[test]
fn bitmap_token_cycle_releases_unpaid_liability_and_rejects_late_payment() {
    let program_id = funded_fee_router::id();
    let mut svm = LiteSVM::new();
    svm.add_program(program_id, &support::program_bytes()).unwrap();
    set_time(&mut svm, 1_800_000_000);
    let protocol = Keypair::new();
    let program_data = support::set_upgrade_owner(&mut svm, program_id, protocol.pubkey());
    svm.airdrop(&protocol.pubkey(), 1_000_000_000).unwrap();
    let (legacy_router, _) = Pubkey::find_program_address(&[b"funded-fee-router-v1"], &program_id);
    let init_router = Instruction::new_with_bytes(program_id, &funded_fee_router::instruction::Initialize {}.data(),
        funded_fee_router::accounts::Initialize { authority:protocol.pubkey(), app_owner:protocol.pubkey(), router:legacy_router,
            program:program_id, program_data, system_program:anchor_lang::system_program::ID }.to_account_metas(None));
    assert!(send(&mut svm, &protocol, &[&protocol], &[init_router]));

    let coin = Keypair::new();
    let asset = Keypair::new();
    let token_program = spl_token::ID;
    for mint in [&coin, &asset] {
        let rows = [
            system_instruction::create_account(&protocol.pubkey(), &mint.pubkey(), 2_000_000, spl_token::state::Mint::LEN as u64, &token_program),
            spl_token::instruction::initialize_mint2(&token_program, &mint.pubkey(), &protocol.pubkey(), None, 0).unwrap(),
        ];
        assert!(send(&mut svm, &protocol, &[&protocol, mint], &rows));
    }
    let vault = Pubkey::find_program_address(&[b"reward-vault-v1", protocol.pubkey().as_ref(), coin.pubkey().as_ref()], &program_id).0;
    let reserve = Pubkey::find_program_address(&[b"reward-reserve-v1", vault.as_ref(), asset.pubkey().as_ref()], &program_id).0;
    let vault_token = get_associated_token_address(&vault, &asset.pubkey());
    let init_vault = Instruction::new_with_bytes(program_id, &funded_fee_router::instruction::InitializeRewardVault {}.data(),
        funded_fee_router::accounts::InitializeRewardVault { authority:protocol.pubkey(), mint:coin.pubkey(), vault, legacy_router,
            system_program:anchor_lang::system_program::ID }.to_account_metas(None));
    let init_reserve = Instruction::new_with_bytes(program_id, &funded_fee_router::instruction::InitializeRewardReserve { asset_mint:asset.pubkey() }.data(),
        funded_fee_router::accounts::InitializeRewardReserve { authority:protocol.pubkey(), vault, reserve, legacy_router,
            system_program:anchor_lang::system_program::ID }.to_account_metas(None));
    assert!(send(&mut svm, &protocol, &[&protocol], &[init_vault, init_reserve]));
    let ata = spl_associated_token_account::instruction::create_associated_token_account_idempotent(&protocol.pubkey(), &vault, &asset.pubkey(), &token_program);
    let fund = spl_token::instruction::mint_to(&token_program, &asset.pubkey(), &vault_token, &protocol.pubkey(), &[], 100).unwrap();
    assert!(send(&mut svm, &protocol, &[&protocol], &[ata, fund]));

    let holder = Keypair::new();
    let stuck = Pubkey::new_unique();
    let cycle_id = [3u8; 32];
    let a = reward_leaf(cycle_id, holder.pubkey(), asset.pubkey(), 60, 0);
    let b = reward_leaf(cycle_id, stuck, asset.pubkey(), 40, 1);
    let root = if a <= b { hashv(&[&a, &b]).to_bytes() } else { hashv(&[&b, &a]).to_bytes() };
    let cycle = Pubkey::find_program_address(&[b"reward-cycle-v1", vault.as_ref(), &cycle_id], &program_id).0;
    let now = 1_800_000_000;
    let create = Instruction::new_with_bytes(program_id, &funded_fee_router::instruction::CreateBitmapCycleToken {
        cycle_id, merkle_root:root, asset_mint:asset.pubkey(), total_amount:100, cutoff_at:now, payout_at:now, leaf_count:2 }.data(),
        funded_fee_router::accounts::CreateBitmapCycleToken { authority:protocol.pubkey(), vault, reserve, cycle, token_mint:asset.pubkey(),
            vault_token_account:vault_token, legacy_router, system_program:anchor_lang::system_program::ID }.to_account_metas(None));
    assert!(send(&mut svm, &protocol, &[&protocol], &[create]));
    assert_eq!(outstanding(&svm, reserve), 100);

    let holder_token = get_associated_token_address(&holder.pubkey(), &asset.pubkey());
    let holder_ata = spl_associated_token_account::instruction::create_associated_token_account_idempotent(&protocol.pubkey(), &holder.pubkey(), &asset.pubkey(), &token_program);
    let _payment = Pubkey::find_program_address(&[b"reward-payment-v1", cycle.as_ref(), holder.pubkey().as_ref()], &program_id).0;
    let payout = Instruction::new_with_bytes(program_id, &funded_fee_router::instruction::PayoutBitmapToken { amount:60, leaf_index:0, proof:vec![b] }.data(),
        funded_fee_router::accounts::PayoutBitmapToken { payer:protocol.pubkey(), vault, reserve, cycle, recipient:holder.pubkey(),
            asset_mint:asset.pubkey(), vault_token_account:vault_token, recipient_token_account:holder_token, token_program,
            system_program:anchor_lang::system_program::ID }.to_account_metas(None));
    assert!(send(&mut svm, &protocol, &[&protocol], &[holder_ata, payout]));
    assert_eq!(outstanding(&svm, reserve), 40);

    let expire = Instruction::new_with_bytes(program_id, &funded_fee_router::instruction::ExpireBitmapCycle {}.data(),
        funded_fee_router::accounts::ExpireBitmapCycle { authority:protocol.pubkey(), vault, reserve, cycle, legacy_router }.to_account_metas(None));
    // Before the grace period ends the commitment cannot be released.
    assert!(!send(&mut svm, &protocol, &[&protocol], &[expire.clone()]));
    set_time(&mut svm, now + funded_fee_router::REWARD_CYCLE_EXPIRY_GRACE_SECONDS);
    // Only the current router authority may expire a cycle.
    let attacker = Keypair::new();
    svm.airdrop(&attacker.pubkey(), 10_000_000).unwrap();
    let mut forged = expire.clone();
    forged.accounts[0].pubkey = attacker.pubkey();
    assert!(!send(&mut svm, &attacker, &[&attacker], &[forged]));
    assert!(send(&mut svm, &protocol, &[&protocol], &[expire.clone()]));
    assert_eq!(outstanding(&svm, reserve), 0, "only the unpaid 40 is released");
    assert_eq!(token_amount(&svm, vault_token), 40, "tokens stay in the vault");
    // A second expiry fails, and so does any later payout of the expired cycle.
    assert!(!send(&mut svm, &protocol, &[&protocol], &[expire]));
    let _stuck_payment = Pubkey::find_program_address(&[b"reward-payment-v1", cycle.as_ref(), stuck.as_ref()], &program_id).0;
    let stuck_token = get_associated_token_address(&stuck, &asset.pubkey());
    let stuck_ata = spl_associated_token_account::instruction::create_associated_token_account_idempotent(&protocol.pubkey(), &stuck, &asset.pubkey(), &token_program);
    let late = Instruction::new_with_bytes(program_id, &funded_fee_router::instruction::PayoutBitmapToken { amount:40, leaf_index:1, proof:vec![a] }.data(),
        funded_fee_router::accounts::PayoutBitmapToken { payer:protocol.pubkey(), vault, reserve, cycle, recipient:stuck,
            asset_mint:asset.pubkey(), vault_token_account:vault_token, recipient_token_account:stuck_token, token_program,
            system_program:anchor_lang::system_program::ID }.to_account_metas(None));
    assert!(send(&mut svm, &protocol, &[&protocol], &[stuck_ata]));
    assert!(!send(&mut svm, &protocol, &[&protocol], &[late]));
    // The released 40 funds the next cycle.
    let next_id = [4u8; 32];
    let next_cycle = Pubkey::find_program_address(&[b"reward-cycle-v1", vault.as_ref(), &next_id], &program_id).0;
    let next = Instruction::new_with_bytes(program_id, &funded_fee_router::instruction::CreateBitmapCycleToken {
        cycle_id:next_id, merkle_root:[1; 32], asset_mint:asset.pubkey(), total_amount:40, cutoff_at:now, payout_at:now, leaf_count:1 }.data(),
        funded_fee_router::accounts::CreateBitmapCycleToken { authority:protocol.pubkey(), vault, reserve, cycle:next_cycle, token_mint:asset.pubkey(),
            vault_token_account:vault_token, legacy_router, system_program:anchor_lang::system_program::ID }.to_account_metas(None));
    assert!(send(&mut svm, &protocol, &[&protocol], &[next]));
    assert_eq!(outstanding(&svm, reserve), 40);
}
