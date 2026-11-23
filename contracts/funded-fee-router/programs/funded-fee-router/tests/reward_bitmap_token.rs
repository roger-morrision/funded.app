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
    verify_bitmap_expiry(false);
}

#[test]
fn successor_expires_original_bitmap_cycle_without_moving_tokens() {
    verify_bitmap_expiry(true);
}

fn verify_bitmap_expiry(rotate: bool) {
    let program_id = funded_fee_router::id();
    let mut svm = LiteSVM::new();
    svm.add_program(program_id, &support::program_bytes()).unwrap();
    set_time(&mut svm, 1_800_000_000);
    let protocol = Keypair::new();
    let owner = Keypair::new();
    let program_data = support::set_upgrade_owner(&mut svm, program_id, owner.pubkey());
    svm.airdrop(&protocol.pubkey(), 1_000_000_000).unwrap();
    let (legacy_router, _) = Pubkey::find_program_address(&[b"funded-fee-router-v1"], &program_id);
    let init_router = Instruction::new_with_bytes(program_id, &funded_fee_router::instruction::Initialize {}.data(),
        funded_fee_router::accounts::Initialize { authority:protocol.pubkey(), app_owner:owner.pubkey(), router:legacy_router,
            program:program_id, program_data, system_program:anchor_lang::system_program::ID }.to_account_metas(None));
    assert!(send(&mut svm, &protocol, &[&protocol,&owner], &[init_router]));

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

    let successor = Keypair::new();
    let current = if rotate {
        svm.airdrop(&successor.pubkey(),10_000_000).unwrap();
        let rotate_ix = Instruction::new_with_bytes(program_id,&funded_fee_router::instruction::RotateAuthority{}.data(),
            funded_fee_router::accounts::RotateAuthority{old_authority:protocol.pubkey(),new_authority:successor.pubkey(),
                app_owner:owner.pubkey(),legacy_router,program:program_id,program_data}.to_account_metas(None));
        assert!(send(&mut svm,&protocol,&[&protocol,&successor,&owner],&[rotate_ix]));
        &successor
    } else { &protocol };
    let expire = Instruction::new_with_bytes(program_id, &funded_fee_router::instruction::ExpireBitmapCycle {}.data(),
        funded_fee_router::accounts::ExpireBitmapCycle { authority:current.pubkey(), vault, reserve, cycle, legacy_router }.to_account_metas(None));
    let snapshot = |svm:&LiteSVM| [cycle,reserve,vault,vault_token,holder_token].map(|address|svm.get_account(&address).unwrap());
    let before = snapshot(&svm);
    let deadline = now + funded_fee_router::REWARD_CYCLE_EXPIRY_GRACE_SECONDS;
    set_time(&mut svm,deadline-1);
    assert!(!send(&mut svm,current,&[current],&[expire.clone()]));
    assert_eq!(snapshot(&svm),before);
    set_time(&mut svm,deadline);
    let stranger = Keypair::new();
    svm.airdrop(&stranger.pubkey(),10_000_000).unwrap();
    let retired_or_stranger = if rotate { &protocol } else { &stranger };
    let mut invalid = expire.clone();
    invalid.accounts[0].pubkey = retired_or_stranger.pubkey();
    assert!(!send(&mut svm,retired_or_stranger,&[retired_or_stranger],&[invalid]));
    assert_eq!(snapshot(&svm),before);
    for index in [1,2,3,4] {
        let mut invalid=expire.clone();
        let alternate=Pubkey::new_unique();
        svm.set_account(alternate,svm.get_account(&invalid.accounts[index].pubkey).unwrap()).unwrap();
        invalid.accounts[index].pubkey=alternate;
        assert!(!send(&mut svm,current,&[current],&[invalid]));
        assert_eq!(snapshot(&svm),before);
    }
    assert!(send(&mut svm,current,&[current],&[expire.clone()]));
    assert_eq!(outstanding(&svm,reserve),0);
    let after = snapshot(&svm);
    assert_eq!(after[2..],before[2..]);
    let mut expected = before[0].data.clone();
    assert_eq!(expected[173],1);
    expected[173]=0;
    assert_eq!(after[0].data,expected);
    assert_eq!(token_amount(&svm,vault_token),40);
    assert!(!send(&mut svm,current,&[current],&[expire]));
    assert_eq!(snapshot(&svm),after);
    let _stuck_payment = Pubkey::find_program_address(&[b"reward-payment-v1", cycle.as_ref(), stuck.as_ref()], &program_id).0;
    let stuck_token = get_associated_token_address(&stuck, &asset.pubkey());
    let stuck_ata = spl_associated_token_account::instruction::create_associated_token_account_idempotent(&protocol.pubkey(), &stuck, &asset.pubkey(), &token_program);
    let late = Instruction::new_with_bytes(program_id, &funded_fee_router::instruction::PayoutBitmapToken { amount:40, leaf_index:1, proof:vec![a] }.data(),
        funded_fee_router::accounts::PayoutBitmapToken { payer:protocol.pubkey(), vault, reserve, cycle, recipient:stuck,
            asset_mint:asset.pubkey(), vault_token_account:vault_token, recipient_token_account:stuck_token, token_program,
            system_program:anchor_lang::system_program::ID }.to_account_metas(None));
    assert!(send(&mut svm, &protocol, &[&protocol], &[stuck_ata]));
    assert!(!send(&mut svm, &protocol, &[&protocol], &[late]));
    assert_eq!(snapshot(&svm),after);
    // With the same operator, the released 40 funds the next cycle. A successor
    // can expire the old cycle, but cannot allocate from the historical vault.

    let next_id = [4u8; 32];
    let next_cycle = Pubkey::find_program_address(&[b"reward-cycle-v1", vault.as_ref(), &next_id], &program_id).0;
    let mut next = Instruction::new_with_bytes(program_id, &funded_fee_router::instruction::CreateBitmapCycleToken {
        cycle_id:next_id, merkle_root:[1; 32], asset_mint:asset.pubkey(), total_amount:40, cutoff_at:now, payout_at:now, leaf_count:1 }.data(),
        funded_fee_router::accounts::CreateBitmapCycleToken { authority:protocol.pubkey(), vault, reserve, cycle:next_cycle, token_mint:asset.pubkey(),
            vault_token_account:vault_token, legacy_router, system_program:anchor_lang::system_program::ID }.to_account_metas(None));
    next.accounts[0].pubkey = current.pubkey();
    assert_eq!(send(&mut svm,current,&[current],&[next]), !rotate);
    assert_eq!(outstanding(&svm,reserve),if rotate { 0 } else { 40 });
}

#[test]
fn bitmap_capacity_and_last_global_sol_leaf() {
    use anchor_lang::AccountDeserialize;
    use funded_fee_router::{accounts, instruction, reward_bitmap_state::RewardBitmapCycle};
    let id = funded_fee_router::id();
    let mut vm = LiteSVM::new();
    vm.add_program(id, &support::program_bytes()).unwrap();
    let now = 1_800_000_000;
    set_time(&mut vm, now);
    let payer = Keypair::new();
    let authority = payer.pubkey();
    vm.airdrop(&authority, 1_000_000_000).unwrap();
    let program_data = support::set_upgrade_owner(&mut vm, id, authority);
    let pda = |seeds: &[&[u8]]| Pubkey::find_program_address(seeds, &id).0;
    let legacy_router = pda(&[b"funded-fee-router-v1"]);
    let system_program = anchor_lang::system_program::ID;
    let coin = Pubkey::new_unique();
    let sol = Pubkey::default();
    let vault = pda(&[b"reward-vault-v1", authority.as_ref(), coin.as_ref()]);
    let reserve = pda(&[b"reward-reserve-v1", vault.as_ref(), sol.as_ref()]);
    let init = Instruction::new_with_bytes(id, &instruction::Initialize {}.data(), accounts::Initialize {
        authority, app_owner: authority, router: legacy_router, program: id, program_data, system_program,
    }.to_account_metas(None));
    let init_vault = Instruction::new_with_bytes(id, &instruction::InitializeRewardVault {}.data(),
        accounts::InitializeRewardVault { authority, mint: coin, vault, legacy_router, system_program }.to_account_metas(None));
    let init_reserve = Instruction::new_with_bytes(id, &instruction::InitializeRewardReserve { asset_mint: sol }.data(),
        accounts::InitializeRewardReserve { authority, vault, reserve, legacy_router, system_program }.to_account_metas(None));
    const COUNT: u32 = 65_536;
    let fund = system_instruction::transfer(&authority, &vault, u64::from(COUNT));
    assert!(send(&mut vm, &payer, &[&payer], &[init, init_vault, init_reserve, fund]));

    let cycle_id = [29; 32];
    let cycle = pda(&[b"reward-cycle-v1", vault.as_ref(), &cycle_id]);
    let holder = |i: u32| Pubkey::new_from_array(hashv(&[b"capacity-fixture", &i.to_le_bytes()]).to_bytes());
    let mut level: Vec<_> = (0..COUNT).map(|i| reward_leaf(cycle_id, holder(i), sol, 1, i)).collect();
    let mut proof = Vec::new();
    while level.len() > 1 {
        proof.push(level[level.len() - 2]); // Sibling of the last leaf/subtree at this depth.
        level = level.chunks_exact(2).map(|pair| {
            let [a, b] = [pair[0], pair[1]];
            if a < b { hashv(&[&a, &b]) } else { hashv(&[&b, &a]) }.to_bytes()
        }).collect();
    }
    assert_eq!(proof.len(), 16);
    let create = |leaf_count| Instruction::new_with_bytes(id, &instruction::CreateBitmapCycle {
        cycle_id, merkle_root: level[0], asset_mint: sol, total_amount: u64::from(COUNT),
        cutoff_at: now, payout_at: now, leaf_count,
    }.data(), accounts::CreateBitmapCycle { authority, vault, reserve, cycle, legacy_router, system_program }.to_account_metas(None));
    assert!(!send(&mut vm, &payer, &[&payer], &[create(COUNT + 1)]));
    assert!(vm.get_account(&cycle).is_none());
    assert_eq!(outstanding(&vm, reserve), 0);
    assert!(send(&mut vm, &payer, &[&payer], &[create(COUNT)]));
    let recipient = holder(COUNT - 1);
    vm.airdrop(&recipient, 2_000_000).unwrap();
    let balance = vm.get_balance(&vault).unwrap();
    let pay = Instruction::new_with_bytes(id, &instruction::PayoutBitmapSol { amount: 1, leaf_index: COUNT - 1, proof }.data(),
        accounts::PayoutBitmapSol { payer: authority, vault, reserve, cycle, recipient, system_program }.to_account_metas(None));
    assert!(send(&mut vm, &payer, &[&payer], std::slice::from_ref(&pay)));
    let snapshot = |svm: &LiteSVM| [vault, reserve, cycle, recipient].map(|key| svm.get_account(&key).unwrap());
    let paid = snapshot(&vm);
    let record = RewardBitmapCycle::try_deserialize(&mut paid[2].data.as_slice()).unwrap();
    assert_eq!(record.paid.len(), 8192);
    assert!(record.paid[..8191].iter().all(|b| *b == 0));
    assert_eq!((record.paid[8191], record.distributed_amount), (0x80, 1));
    assert_eq!(outstanding(&vm, reserve), 65_535);
    assert_eq!((balance - paid[0].lamports, paid[3].lamports), (1, 2_000_001));
    assert!(!send(&mut vm, &payer, &[&payer], &[pay]));
    assert_eq!(snapshot(&vm), paid);
}
