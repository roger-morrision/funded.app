use super::{asset, config_address, configure, fixture, send};
use anchor_lang::{
    prelude::{Clock, Pubkey}, solana_program::{instruction::Instruction, system_instruction},
    AccountDeserialize, InstructionData, ToAccountMetas,
};
use funded_fee_router::{accounts, instruction, RewardCycle, RewardPayment, RewardReserve};
use funded_fee_router::instructions::rich_assets::RichAssetConfig;
use litesvm::LiteSVM;
use solana_sha256_hasher::hashv;
use solana_signer_lite::Signer;

fn read<T: AccountDeserialize>(svm: &LiteSVM, address: Pubkey) -> T {
    T::try_deserialize(&mut svm.get_account(&address).unwrap().data.as_slice()).unwrap()
}

#[test]
fn committed_holder_reward_pays_after_rotation() {
    let (mut svm, payer, program_data) = fixture();
    let id = funded_fee_router::id();
    let authority = payer.pubkey();
    let system_program = anchor_lang::system_program::ID;
    let pda = |seeds: &[&[u8]]| Pubkey::find_program_address(seeds, &id).0;
    let router = pda(&[b"funded-fee-router-v1"]);
    let (old, old_market) = asset(&mut svm);
    let (new, new_market) = asset(&mut svm);
    let init = Instruction::new_with_bytes(id, &instruction::Initialize {}.data(), accounts::Initialize {
        authority, app_owner: authority, router, program: id, program_data, system_program,
    }.to_account_metas(None));
    send(&mut svm, &payer, &[&payer], init).unwrap();
    send(&mut svm, &payer, &[&payer], configure(authority, program_data, old, old_market, 1, 0)).unwrap();

    let cohort = Pubkey::new_from_array([21; 32]);
    let sol = Pubkey::default();
    let vault = pda(&[b"reward-vault-v1", authority.as_ref(), cohort.as_ref()]);
    let reserve = pda(&[b"reward-reserve-v1", vault.as_ref(), sol.as_ref()]);
    let init_vault = Instruction::new_with_bytes(id, &instruction::InitializeRewardVault {}.data(),
        accounts::InitializeRewardVault { authority, mint: cohort, vault, legacy_router: router, system_program }.to_account_metas(None));
    let init_reserve = Instruction::new_with_bytes(id, &instruction::InitializeRewardReserve { asset_mint: sol }.data(),
        accounts::InitializeRewardReserve { authority, vault, reserve, legacy_router: router, system_program }.to_account_metas(None));
    let amount = 336u64;
    let remaining = 164u64;
    let total = amount + remaining;
    for ix in [init_vault, init_reserve, system_instruction::transfer(&authority, &vault, total)] {
        send(&mut svm, &payer, &[&payer], ix).unwrap();
    }

    let cycle_id = [37; 32];
    let cycle = pda(&[b"reward-cycle-v1", vault.as_ref(), &cycle_id]);
    let recipient = Pubkey::new_from_array([22; 32]);
    svm.airdrop(&recipient, 2_000_000).unwrap();
    let sibling = hashv(&[b"funded-reward-leaf-v1", &cycle_id, &[23; 32], sol.as_ref(),
        &remaining.to_le_bytes(), &1u32.to_le_bytes()]).to_bytes();
    // buildRewardManifest in reward-merkle.js, with holders [22; 32] and [23; 32] in that order.
    let root = [
        0x22, 0x3c, 0x1b, 0x96, 0x8d, 0x5b, 0x03, 0x51, 0x0c, 0x45, 0xa3, 0x55, 0xe0, 0xda, 0xb7, 0xab,
        0x9a, 0x3b, 0xf4, 0x0a, 0x9d, 0xe5, 0xbf, 0xf3, 0x9d, 0xbd, 0x69, 0xc4, 0x24, 0x74, 0xd6, 0x5f,
    ];
    let mut clock = svm.get_sysvar::<Clock>();
    clock.unix_timestamp = 1_800_000_000;
    svm.set_sysvar(&clock);
    let payout_at = clock.unix_timestamp + 86_400;
    let commit = Instruction::new_with_bytes(id, &instruction::CreateRewardCycle {
        cycle_id, merkle_root: root, asset_mint: sol, total_amount: total,
        cutoff_at: clock.unix_timestamp, payout_at, leaf_count: 2,
    }.data(), accounts::CreateRewardCycle { authority, vault, reserve, cycle, legacy_router: router, system_program }.to_account_metas(None));
    send(&mut svm, &payer, &[&payer], commit).unwrap();
    assert_eq!(read::<RichAssetConfig>(&svm, config_address()).mint, old);
    assert_eq!(read::<RewardCycle>(&svm, cycle).merkle_root, root);
    assert_eq!(read::<RewardReserve>(&svm, reserve).outstanding, total);
    let snapshot = |vm: &LiteSVM| [vault, reserve, cycle, recipient].map(|key| vm.get_account(&key).unwrap());
    let committed = snapshot(&svm);
    send(&mut svm, &payer, &[&payer], configure(authority, program_data, new, new_market, 2, 0)).unwrap();
    let active: RichAssetConfig = read(&svm, config_address());
    assert_eq!((active.mint, active.revision), (new, 2));
    assert_eq!(snapshot(&svm), committed);

    clock.unix_timestamp = payout_at;
    svm.set_sysvar(&clock);
    let payment = pda(&[b"reward-payment-v1", cycle.as_ref(), recipient.as_ref()]);
    let mut metas = accounts::PayoutRewardSol { payer: authority, vault, reserve, cycle, recipient, payment, system_program }.to_account_metas(None);
    if cfg!(feature = "mainnet-v3-program") {
        metas.push(anchor_lang::solana_program::instruction::AccountMeta::new_readonly(router, false));
    }
    let pay = Instruction::new_with_bytes(id, &instruction::PayoutRewardSol { amount, leaf_index: 0, proof: vec![sibling] }.data(), metas);
    send(&mut svm, &payer, &[&payer], pay.clone()).unwrap();
    let paid = snapshot(&svm);
    assert_eq!(committed[0].lamports - paid[0].lamports, amount);
    assert_eq!(paid[3].lamports - committed[3].lamports, amount);
    assert_eq!(read::<RewardReserve>(&svm, reserve).outstanding, remaining);
    assert_eq!(read::<RewardCycle>(&svm, cycle).distributed_amount, amount);
    let receipt: RewardPayment = read(&svm, payment);
    assert_eq!((receipt.cycle, receipt.recipient, receipt.leaf_index), (cycle, recipient, 0));
    assert_eq!((receipt.amount, receipt.received_amount), (amount, amount));
    let paid_receipt = svm.get_account(&payment).unwrap();
    assert!(send(&mut svm, &payer, &[&payer], pay).is_err());
    assert_eq!(snapshot(&svm), paid);
    assert_eq!(svm.get_account(&payment).unwrap(), paid_receipt);
}
