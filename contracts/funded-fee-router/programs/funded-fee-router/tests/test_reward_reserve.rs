use {
    anchor_lang::{prelude::{Clock, Rent}, solana_program::{instruction::Instruction, program_pack::Pack, system_instruction}, Discriminator, InstructionData, ToAccountMetas},
    anchor_spl::{associated_token::{get_associated_token_address, spl_associated_token_account}, token::spl_token},
    litesvm::LiteSVM,
    solana_keypair::Keypair,
    solana_account::Account,
    solana_message::{Message, VersionedMessage},
    solana_signer::Signer,
    solana_sha256_hasher::hashv,
    solana_transaction::versioned::VersionedTransaction,
};
mod support;

fn send_with(svm: &mut LiteSVM, payer: &Keypair, signers: &[&Keypair], instructions: &[Instruction]) -> bool {
    let message = Message::new_with_blockhash(instructions, Some(&payer.pubkey()), &svm.latest_blockhash());
    let transaction = VersionedTransaction::try_new(VersionedMessage::Legacy(message), signers).unwrap();
    svm.send_transaction(transaction).is_ok()
}

fn send(svm: &mut LiteSVM, payer: &Keypair, instructions: &[Instruction]) -> bool {
    send_with(svm, payer, &[payer], instructions)
}

#[test]
fn overlapping_sol_cycles_cannot_overcommit_the_vault() {
    let program_id = funded_fee_router::id();
    let authority = Keypair::new();
    let mint = Keypair::new().pubkey();
    let mut svm = LiteSVM::new();
    svm.add_program(program_id, &support::program_bytes()).unwrap();
    let mut clock = svm.get_sysvar::<Clock>();
    clock.unix_timestamp = 1_800_000_000;
    svm.set_sysvar(&clock);
    let program_data = support::set_upgrade_owner(&mut svm, program_id, authority.pubkey());
    svm.airdrop(&authority.pubkey(), 1_000_000_000).unwrap();
    let (legacy_router, _) = anchor_lang::prelude::Pubkey::find_program_address(&[b"funded-fee-router-v1"], &program_id);
    let (vault, _) = anchor_lang::prelude::Pubkey::find_program_address(&[b"reward-vault-v1", authority.pubkey().as_ref(), mint.as_ref()], &program_id);
    let (reserve, _) = anchor_lang::prelude::Pubkey::find_program_address(&[b"reward-reserve-v1", vault.as_ref(), anchor_lang::prelude::Pubkey::default().as_ref()], &program_id);
    let initialize = Instruction::new_with_bytes(program_id, &funded_fee_router::instruction::Initialize {}.data(),
        funded_fee_router::accounts::Initialize { authority:authority.pubkey(), app_owner:authority.pubkey(), router:legacy_router,
            program:program_id, program_data, system_program:anchor_lang::system_program::ID }.to_account_metas(None));
    assert!(send(&mut svm, &authority, &[initialize]));
    let initialize_vault = Instruction::new_with_bytes(program_id, &funded_fee_router::instruction::InitializeRewardVault {}.data(),
        funded_fee_router::accounts::InitializeRewardVault { authority:authority.pubkey(), mint, vault, legacy_router,
            system_program:anchor_lang::system_program::ID }.to_account_metas(None));
    assert!(send(&mut svm, &authority, &[initialize_vault]));
    let initialize_reserve = Instruction::new_with_bytes(program_id,
        &funded_fee_router::instruction::InitializeRewardReserve { asset_mint:anchor_lang::prelude::Pubkey::default() }.data(),
        funded_fee_router::accounts::InitializeRewardReserve { authority:authority.pubkey(), vault, reserve, legacy_router,
            system_program:anchor_lang::system_program::ID }.to_account_metas(None));
    assert!(send(&mut svm, &authority, &[initialize_reserve]));
    assert!(send(&mut svm, &authority, &[system_instruction::transfer(&authority.pubkey(), &vault, 100_000_000)]));
    let recipient = Keypair::new().pubkey();
    let leaf = hashv(&[b"funded-reward-leaf-v1", &[1; 32], recipient.as_ref(),
        anchor_lang::prelude::Pubkey::default().as_ref(), &80_000_000u64.to_le_bytes(), &0u32.to_le_bytes()]).to_bytes();
    let create = |id: [u8; 32], total_amount, root: [u8; 32]| {
        let (cycle, _) = anchor_lang::prelude::Pubkey::find_program_address(&[b"reward-cycle-v1", vault.as_ref(), &id], &program_id);
        let instruction = Instruction::new_with_bytes(program_id,
            &funded_fee_router::instruction::CreateRewardCycle { cycle_id:id, merkle_root:root,
                asset_mint:anchor_lang::prelude::Pubkey::default(), total_amount, cutoff_at:1, payout_at:2, leaf_count:1 }.data(),
            funded_fee_router::accounts::CreateRewardCycle { authority:authority.pubkey(), vault, reserve, cycle, legacy_router,
                system_program:anchor_lang::system_program::ID }.to_account_metas(None));
        (cycle, instruction)
    };
    let (first, first_ix) = create([1; 32], 80_000_000, leaf);
    assert!(send(&mut svm, &authority, &[first_ix]));
    assert!(svm.get_account(&first).is_some());
    let (second, second_ix) = create([2; 32], 30_000_000, [7; 32]);
    assert!(!send(&mut svm, &authority, &[second_ix]));
    assert!(svm.get_account(&second).is_none());
    let (payment, _) = anchor_lang::prelude::Pubkey::find_program_address(&[b"reward-payment-v1", first.as_ref(), recipient.as_ref()], &program_id);
    let payout = Instruction::new_with_bytes(program_id,
        &funded_fee_router::instruction::PayoutRewardSol {amount:80_000_000,leaf_index:0,proof:vec![]}.data(),
        funded_fee_router::accounts::PayoutRewardSol {payer:authority.pubkey(),vault,reserve,cycle:first,
            recipient,payment,system_program:anchor_lang::system_program::ID}.to_account_metas(None));
    assert!(send(&mut svm, &authority, &[payout]));
    assert_eq!(svm.get_account(&recipient).unwrap().lamports, 80_000_000);
    let reserve_data = svm.get_account(&reserve).unwrap().data;
    assert_eq!(u64::from_le_bytes(reserve_data[72..80].try_into().unwrap()), 0);
}

#[test]
fn overlapping_token_cycles_cannot_overcommit_the_vault() {
    let program_id = funded_fee_router::id();
    let authority = Keypair::new();
    let launch_mint = Keypair::new().pubkey();
    let asset_mint = Keypair::new();
    let mut svm = LiteSVM::new();
    svm.add_program(program_id, &support::program_bytes()).unwrap();
    let mut clock = svm.get_sysvar::<Clock>();
    clock.unix_timestamp = 1_800_000_000;
    svm.set_sysvar(&clock);
    let program_data = support::set_upgrade_owner(&mut svm, program_id, authority.pubkey());
    svm.airdrop(&authority.pubkey(), 1_000_000_000).unwrap();
    let (legacy_router, _) = anchor_lang::prelude::Pubkey::find_program_address(&[b"funded-fee-router-v1"], &program_id);
    let (vault, _) = anchor_lang::prelude::Pubkey::find_program_address(&[b"reward-vault-v1", authority.pubkey().as_ref(), launch_mint.as_ref()], &program_id);
    let (reserve, _) = anchor_lang::prelude::Pubkey::find_program_address(&[b"reward-reserve-v1", vault.as_ref(), asset_mint.pubkey().as_ref()], &program_id);
    let initialize = Instruction::new_with_bytes(program_id, &funded_fee_router::instruction::Initialize {}.data(),
        funded_fee_router::accounts::Initialize { authority:authority.pubkey(), app_owner:authority.pubkey(), router:legacy_router,
            program:program_id, program_data, system_program:anchor_lang::system_program::ID }.to_account_metas(None));
    assert!(send(&mut svm, &authority, &[initialize]));
    let initialize_vault = Instruction::new_with_bytes(program_id, &funded_fee_router::instruction::InitializeRewardVault {}.data(),
        funded_fee_router::accounts::InitializeRewardVault { authority:authority.pubkey(), mint:launch_mint, vault, legacy_router,
            system_program:anchor_lang::system_program::ID }.to_account_metas(None));
    assert!(send(&mut svm, &authority, &[initialize_vault]));
    let initialize_reserve = Instruction::new_with_bytes(program_id,
        &funded_fee_router::instruction::InitializeRewardReserve { asset_mint:asset_mint.pubkey() }.data(),
        funded_fee_router::accounts::InitializeRewardReserve { authority:authority.pubkey(), vault, reserve, legacy_router,
            system_program:anchor_lang::system_program::ID }.to_account_metas(None));
    assert!(send(&mut svm, &authority, &[initialize_reserve]));
    let create_mint = [system_instruction::create_account(&authority.pubkey(), &asset_mint.pubkey(), 2_000_000,
        spl_token::state::Mint::LEN as u64, &spl_token::ID),
        spl_token::instruction::initialize_mint2(&spl_token::ID, &asset_mint.pubkey(), &authority.pubkey(), None, 0).unwrap()];
    assert!(send_with(&mut svm, &authority, &[&authority, &asset_mint], &create_mint));
    let source = get_associated_token_address(&authority.pubkey(), &asset_mint.pubkey());
    let vault_token = get_associated_token_address(&vault, &asset_mint.pubkey());
    for owner in [authority.pubkey(), vault] {
        let create = spl_associated_token_account::instruction::create_associated_token_account(&authority.pubkey(), &owner,
            &asset_mint.pubkey(), &spl_token::ID);
        assert!(send(&mut svm, &authority, &[create]));
    }
    assert!(send(&mut svm, &authority, &[spl_token::instruction::mint_to(&spl_token::ID, &asset_mint.pubkey(),
        &source, &authority.pubkey(), &[], 100).unwrap()]));
    assert!(send(&mut svm, &authority, &[spl_token::instruction::transfer(&spl_token::ID, &source,
        &vault_token, &authority.pubkey(), &[], 100).unwrap()]));
    let recipient = Keypair::new().pubkey();
    let leaf = hashv(&[b"funded-reward-leaf-v1", &[3; 32], recipient.as_ref(),
        asset_mint.pubkey().as_ref(), &80u64.to_le_bytes(), &0u32.to_le_bytes()]).to_bytes();
    let create = |id: [u8; 32], root, total_amount, vault_token_account| {
        let (cycle, _) = anchor_lang::prelude::Pubkey::find_program_address(&[b"reward-cycle-v1", vault.as_ref(), &id], &program_id);
        let instruction = Instruction::new_with_bytes(program_id,
            &funded_fee_router::instruction::CreateRewardCycleToken { cycle_id:id, merkle_root:root,
                asset_mint:asset_mint.pubkey(), total_amount, cutoff_at:1, payout_at:2, leaf_count:1 }.data(),
            funded_fee_router::accounts::CreateRewardCycleToken { authority:authority.pubkey(), vault, reserve, cycle,
                token_mint:asset_mint.pubkey(), vault_token_account, legacy_router,
                system_program:anchor_lang::system_program::ID }.to_account_metas(None));
        (cycle, instruction)
    };
    let (first, first_ix) = create([3; 32], leaf, 80, vault_token);
    assert!(send(&mut svm, &authority, &[first_ix]));
    let (second, second_ix) = create([4; 32], [7; 32], 30, vault_token);
    assert!(!send(&mut svm, &authority, &[second_ix]));
    assert!(svm.get_account(&second).is_none());

    // A second token account owned by the same vault PDA must not be usable
    // as collateral for the canonical reward pool.
    let alternate = Keypair::new();
    let create_alternate = [system_instruction::create_account(&authority.pubkey(), &alternate.pubkey(),
        Rent::default().minimum_balance(spl_token::state::Account::LEN), spl_token::state::Account::LEN as u64, &spl_token::ID),
        spl_token::instruction::initialize_account3(&spl_token::ID, &alternate.pubkey(), &asset_mint.pubkey(), &vault).unwrap()];
    assert!(send_with(&mut svm, &authority, &[&authority, &alternate], &create_alternate));
    assert!(send(&mut svm, &authority, &[spl_token::instruction::mint_to(&spl_token::ID, &asset_mint.pubkey(),
        &source, &authority.pubkey(), &[], 200).unwrap(),
        spl_token::instruction::transfer(&spl_token::ID, &source, &alternate.pubkey(), &authority.pubkey(), &[], 200).unwrap()]));
    let (third, alternate_ix) = create([5; 32], [7; 32], 90, alternate.pubkey());
    assert!(!send(&mut svm, &authority, &[alternate_ix]));
    assert!(svm.get_account(&third).is_none());

    let recipient_token = get_associated_token_address(&recipient, &asset_mint.pubkey());
    assert!(send(&mut svm, &authority, &[spl_associated_token_account::instruction::create_associated_token_account(
        &authority.pubkey(), &recipient, &asset_mint.pubkey(), &spl_token::ID)]));
    let alternate_recipient = Keypair::new();
    let create_alternate_recipient = [system_instruction::create_account(&authority.pubkey(), &alternate_recipient.pubkey(),
        Rent::default().minimum_balance(spl_token::state::Account::LEN), spl_token::state::Account::LEN as u64, &spl_token::ID),
        spl_token::instruction::initialize_account3(&spl_token::ID, &alternate_recipient.pubkey(), &asset_mint.pubkey(), &recipient).unwrap()];
    assert!(send_with(&mut svm, &authority, &[&authority, &alternate_recipient], &create_alternate_recipient));
    let (payment, _) = anchor_lang::prelude::Pubkey::find_program_address(&[b"reward-payment-v1", first.as_ref(), recipient.as_ref()], &program_id);
    let payout = |destination| Instruction::new_with_bytes(program_id,
        &funded_fee_router::instruction::PayoutRewardToken { amount:80, leaf_index:0, proof:vec![] }.data(),
        funded_fee_router::accounts::PayoutRewardToken { payer:authority.pubkey(), vault, reserve, cycle:first,
            recipient, asset_mint:asset_mint.pubkey(), vault_token_account:vault_token,
            recipient_token_account:destination, payment, token_program:spl_token::ID,
            system_program:anchor_lang::system_program::ID }.to_account_metas(None));
    assert!(!send(&mut svm, &authority, &[payout(alternate_recipient.pubkey())]));
    assert!(svm.get_account(&payment).is_none());
    let valid_payout = payout(recipient_token);
    let message = Message::new_with_blockhash(&[valid_payout], Some(&authority.pubkey()), &svm.latest_blockhash());
    let transaction = VersionedTransaction::try_new(VersionedMessage::Legacy(message), &[&authority]).unwrap();
    let result = svm.send_transaction(transaction);
    assert!(result.is_ok(), "{result:?}");
    let received = spl_token::state::Account::unpack(&svm.get_account(&recipient_token).unwrap().data).unwrap().amount;
    assert_eq!(received, 80);
}

#[test]
fn legacy_sol_cycle_migration_reserves_only_its_unpaid_amount() {
    let program_id = funded_fee_router::id();
    let authority = Keypair::new();
    let launch_mint = Keypair::new().pubkey();
    let mut svm = LiteSVM::new();
    svm.add_program(program_id, &support::program_bytes()).unwrap();
    let program_data = support::set_upgrade_owner(&mut svm, program_id, authority.pubkey());
    svm.airdrop(&authority.pubkey(), 1_000_000_000).unwrap();
    let (legacy_router, _) = anchor_lang::prelude::Pubkey::find_program_address(&[b"funded-fee-router-v1"], &program_id);
    let (vault, _) = anchor_lang::prelude::Pubkey::find_program_address(&[b"reward-vault-v1", authority.pubkey().as_ref(), launch_mint.as_ref()], &program_id);
    let (reserve, _) = anchor_lang::prelude::Pubkey::find_program_address(&[b"reward-reserve-v1", vault.as_ref(), anchor_lang::prelude::Pubkey::default().as_ref()], &program_id);
    let initialize = Instruction::new_with_bytes(program_id, &funded_fee_router::instruction::Initialize {}.data(),
        funded_fee_router::accounts::Initialize { authority:authority.pubkey(), app_owner:authority.pubkey(), router:legacy_router,
            program:program_id, program_data, system_program:anchor_lang::system_program::ID }.to_account_metas(None));
    assert!(send(&mut svm, &authority, &[initialize]));
    let initialize_vault = Instruction::new_with_bytes(program_id, &funded_fee_router::instruction::InitializeRewardVault {}.data(),
        funded_fee_router::accounts::InitializeRewardVault { authority:authority.pubkey(), mint:launch_mint, vault, legacy_router,
            system_program:anchor_lang::system_program::ID }.to_account_metas(None));
    assert!(send(&mut svm, &authority, &[initialize_vault]));
    let initialize_reserve = Instruction::new_with_bytes(program_id,
        &funded_fee_router::instruction::InitializeRewardReserve { asset_mint:anchor_lang::prelude::Pubkey::default() }.data(),
        funded_fee_router::accounts::InitializeRewardReserve { authority:authority.pubkey(), vault, reserve, legacy_router,
            system_program:anchor_lang::system_program::ID }.to_account_metas(None));
    assert!(send(&mut svm, &authority, &[initialize_reserve]));
    assert!(send(&mut svm, &authority, &[system_instruction::transfer(&authority.pubkey(), &vault, 100_000_000)]));
    let cycle_id = [5u8; 32];
    let (cycle, bump) = anchor_lang::prelude::Pubkey::find_program_address(&[b"reward-cycle-v1", vault.as_ref(), &cycle_id], &program_id);
    let mut old = vec![0u8; 173];
    old[0..8].copy_from_slice(funded_fee_router::RewardCycle::DISCRIMINATOR);
    old[8..40].copy_from_slice(vault.as_ref());
    old[40..72].copy_from_slice(&cycle_id);
    old[72..104].copy_from_slice(&[7; 32]);
    old[136..144].copy_from_slice(&80_000_000u64.to_le_bytes());
    old[144..152].copy_from_slice(&20_000_000u64.to_le_bytes());
    old[152..160].copy_from_slice(&1i64.to_le_bytes());
    old[160..168].copy_from_slice(&2i64.to_le_bytes());
    old[168..172].copy_from_slice(&1u32.to_le_bytes());
    old[172] = bump;
    svm.set_account(cycle, Account {lamports:Rent::default().minimum_balance(173),data:old,
        owner:program_id,executable:false,rent_epoch:0}).unwrap();
    let migrate = Instruction::new_with_bytes(program_id,
        &funded_fee_router::instruction::MigrateRewardCycleSol {cycle_id}.data(),
        funded_fee_router::accounts::MigrateRewardCycleSol {authority:authority.pubkey(),vault,reserve,cycle,
            legacy_router,system_program:anchor_lang::system_program::ID}.to_account_metas(None));
    assert!(send(&mut svm, &authority, &[migrate.clone()]));
    let cycle_data = svm.get_account(&cycle).unwrap().data;
    assert_eq!(cycle_data.len(), 174);
    assert_eq!(cycle_data[173], 1);
    let reserve_data = svm.get_account(&reserve).unwrap().data;
    assert_eq!(u64::from_le_bytes(reserve_data[72..80].try_into().unwrap()), 60_000_000);
    svm.expire_blockhash();
    assert!(!send(&mut svm, &authority, &[migrate]));
}
