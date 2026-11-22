use super::{asset, config_address, configure, fixture, send, store};
use anchor_lang::{
    prelude::{Clock, Pubkey},
    solana_program::{
        instruction::{AccountMeta, Instruction},
        program_pack::Pack,
    },
    AccountDeserialize, InstructionData, ToAccountMetas,
};
use anchor_spl::{associated_token::{get_associated_token_address_with_program_id, spl_associated_token_account},
    token::spl_token, token_2022::spl_token_2022 as spl22};
use spl22::extension::{BaseStateWithExtensions, ExtensionType, StateWithExtensions, transfer_fee::TransferFeeAmount};
use funded_fee_router::instructions::rich_assets::RichAssetConfig;
use funded_fee_router::{accounts, instruction, RewardCycle, RewardPayment, RewardReserve};
use litesvm::LiteSVM;
use solana_signer_lite::Signer;
use spl_token::state::{Account as TokenAccount, AccountState, Mint};

fn put_spl<T: Pack>(svm: &mut LiteSVM, key: Pubkey, state: T) {
    let mut data = vec![0; T::LEN];
    T::pack(state, &mut data).unwrap();
    store(svm, key, spl_token::ID, data);
}

fn read<T: AccountDeserialize>(svm: &LiteSVM, key: Pubkey) -> T {
    T::try_deserialize(&mut svm.get_account(&key).unwrap().data.as_slice()).unwrap()
}

#[test]
fn committed_launched_token_pays_after_rotation() {
    committed_token_case(spl_token::ID, None, 0);
}

#[test]
fn committed_token_reward_requires_exact_spendable_extension_delivery() {
    for (extension, bps) in [
        (ExtensionType::MetadataPointer, 0),
        (ExtensionType::TransferFeeConfig, 0),
        (ExtensionType::TransferFeeConfig, 100),
    ] {
        committed_token_case(spl22::ID, Some(extension), bps);
    }
}

fn token_units(svm: &LiteSVM, address: Pubkey) -> (u64, u64) {
    let account = svm.get_account(&address).unwrap();
    let token = StateWithExtensions::<spl22::state::Account>::unpack(&account.data).unwrap();
    (token.base.amount, token.get_extension::<TransferFeeAmount>().map_or(0, |fee| u64::from(fee.withheld_amount)))
}

fn committed_token_case(token_program: Pubkey, extension: Option<ExtensionType>, bps: u16) {
    let (mut svm, payer, program_data) = fixture();
    let authority = payer.pubkey();
    let id = funded_fee_router::id();
    let pda = |seeds: &[&[u8]]| Pubkey::find_program_address(seeds, &id).0;
    let router = pda(&[b"funded-fee-router-v1"]);
    let system_program = anchor_lang::system_program::ID;
    let (old, old_market) = asset(&mut svm);
    let (new, new_market) = asset(&mut svm);
    let mint = Pubkey::new_from_array([21; 32]);
    let vault = pda(&[b"reward-vault-v1", authority.as_ref(), mint.as_ref()]);
    let reserve = pda(&[b"reward-reserve-v1", vault.as_ref(), mint.as_ref()]);
    let recipient = Pubkey::new_from_array([22; 32]);
    let ata = |owner: Pubkey| get_associated_token_address_with_program_id(&owner, &mint, &token_program);
    let custody = ata(vault);
    let destination = ata(recipient);
    let expected_supply = if let Some(extension) = extension {
        let size = ExtensionType::try_calculate_account_len::<spl22::state::Mint>(&[extension]).unwrap();
        store(&mut svm, mint, token_program, vec![0; size]);
        let initialize_extension = if extension == ExtensionType::TransferFeeConfig {
            spl22::extension::transfer_fee::instruction::initialize_transfer_fee_config(
                &token_program, &mint, None, None, bps, 5_000).unwrap()
        } else {
            spl22::extension::metadata_pointer::instruction::initialize(
                &token_program, &mint, None, Some(mint)).unwrap()
        };
        send(&mut svm, &payer, &[&payer], initialize_extension).unwrap();
        send(&mut svm, &payer, &[&payer], spl22::instruction::initialize_mint2(
            &token_program, &mint, &authority, None, 6).unwrap()).unwrap();
        let control_recipient = Pubkey::new_unique();
        for owner in [vault, recipient, authority, control_recipient] {
            send(&mut svm, &payer, &[&payer], spl_associated_token_account::instruction::create_associated_token_account_idempotent(
                &authority, &owner, &mint, &token_program)).unwrap();
        }
        for (account, amount) in [(custody, 500), (destination, 5), (ata(authority), 1_000)] {
            send(&mut svm, &payer, &[&payer], spl22::instruction::mint_to(
                &token_program, &mint, &account, &authority, &[], amount).unwrap()).unwrap();
        }
        send(&mut svm, &payer, &[&payer], spl22::instruction::transfer_checked(
            &token_program, &ata(authority), &mint, &ata(control_recipient), &authority, &[], 1_000, 6).unwrap()).unwrap();
        let fee = if bps == 0 { 0 } else { 10 };
        assert_eq!(token_units(&svm, ata(authority)), (0, 0));
        assert_eq!(token_units(&svm, ata(control_recipient)), (1_000 - fee, fee));
        1_505
    } else {
        put_spl(&mut svm, mint, Mint { supply: 505, decimals: 6, is_initialized: true, ..Mint::default() });
        for (key, owner, amount) in [(custody, vault, 500), (destination, recipient, 5)] {
            put_spl(&mut svm, key, TokenAccount { mint, owner, amount, state: AccountState::Initialized, ..TokenAccount::default() });
        }
        505
    };
    let ix = |data: Vec<u8>, metas| Instruction::new_with_bytes(id, &data, metas);
    for action in [
        ix(
            instruction::Initialize {}.data(),
            accounts::Initialize {
                authority,
                app_owner: authority,
                router,
                program: id,
                program_data,
                system_program,
            }
            .to_account_metas(None),
        ),
        configure(authority, program_data, old, old_market, 1, 0),
        ix(
            instruction::InitializeRewardVault {}.data(),
            accounts::InitializeRewardVault { authority, mint, vault, legacy_router: router, system_program }
                .to_account_metas(None),
        ),
        ix(
            instruction::InitializeRewardReserve { asset_mint: mint }.data(),
            accounts::InitializeRewardReserve {
                authority,
                vault,
                reserve,
                legacy_router: router,
                system_program,
            }
            .to_account_metas(None),
        ),
    ] {
        send(&mut svm, &payer, &[&payer], action).unwrap();
    }

    let cycle_id = [38; 32];
    let cycle = pda(&[b"reward-cycle-v1", vault.as_ref(), &cycle_id]);
    let mut clock = svm.get_sysvar::<Clock>();
    clock.unix_timestamp = 1_800_000_000;
    svm.set_sysvar(&clock);
    let payout_at = clock.unix_timestamp + 86_400;
    // buildRewardManifest: cycle [38;32], mint [21;32], holders [22;32]:336 and [23;32]:164.
    let root = [
        0x23, 0x83, 0xdf, 0x25, 0x27, 0x1f, 0x5a, 0x68, 0x75, 0x0a, 0x5f, 0x1c, 0x77, 0x7a, 0xa1, 0x0e, 0x17,
        0xd8, 0x61, 0x11, 0xe8, 0x7c, 0xae, 0x7c, 0x85, 0xcb, 0x4b, 0x9a, 0x66, 0xc0, 0x94, 0xd1,
    ];
    let sibling = [
        0x77, 0x9f, 0xbe, 0xe2, 0xe0, 0xe3, 0xfe, 0x35, 0xab, 0x8b, 0x00, 0x7f, 0xd8, 0x5b, 0xea, 0x40, 0x67,
        0x6a, 0x24, 0xda, 0xcf, 0x5a, 0xfa, 0xb0, 0xd9, 0xdf, 0x54, 0xbd, 0x35, 0x8d, 0x54, 0x0d,
    ];
    let commit = ix(
        instruction::CreateRewardCycleToken {
            cycle_id,
            merkle_root: root,
            asset_mint: mint,
            total_amount: 500,
            cutoff_at: clock.unix_timestamp,
            payout_at,
            leaf_count: 2,
        }
        .data(),
        accounts::CreateRewardCycleToken {
            authority,
            vault,
            reserve,
            cycle,
            token_mint: mint,
            vault_token_account: custody,
            legacy_router: router,
            system_program,
        }
        .to_account_metas(None),
    );
    send(&mut svm, &payer, &[&payer], commit).unwrap();
    let initial: RichAssetConfig = read(&svm, config_address());
    assert_eq!((initial.revision, initial.mint), (1, old));
    let committed: RewardCycle = read(&svm, cycle);
    assert_eq!((committed.merkle_root, committed.asset_mint, committed.total_amount), (root, mint, 500));
    assert_eq!(read::<RewardReserve>(&svm, reserve).outstanding, 500);
    let snapshot = |vm: &LiteSVM| {
        [vault, reserve, cycle, mint, custody, destination].map(|key| vm.get_account(&key).unwrap())
    };
    let before_rotation = snapshot(&svm);
    send(&mut svm, &payer, &[&payer], configure(authority, program_data, new, new_market, 2, 0)).unwrap();
    let active: RichAssetConfig = read(&svm, config_address());
    assert_eq!((active.revision, active.mint), (2, new));
    assert_eq!(snapshot(&svm), before_rotation);

    clock.unix_timestamp = payout_at;
    svm.set_sysvar(&clock);
    let payment = pda(&[b"reward-payment-v1", cycle.as_ref(), recipient.as_ref()]);
    let mut metas = accounts::PayoutRewardToken {
        payer: authority,
        vault,
        reserve,
        cycle,
        recipient,
        asset_mint: mint,
        vault_token_account: custody,
        recipient_token_account: destination,
        payment,
        token_program,
        system_program,
    }
    .to_account_metas(None);
    if cfg!(feature = "mainnet-v3-program") {
        metas.push(AccountMeta::new_readonly(router, false));
    }
    let pay =
        ix(instruction::PayoutRewardToken { amount: 336, leaf_index: 0, proof: vec![sibling] }.data(), metas);
    let balances = |vm: &LiteSVM| {
        [custody, destination]
            .map(|key| token_units(vm, key).0)
    };
    assert_eq!(balances(&svm), [500, 5]);
    if bps > 0 {
        let tracked = [vault, reserve, cycle, mint, custody, destination, payment];
        let before = tracked.map(|key| svm.get_account(&key));
        for _ in 0..2 {
            let error = send(&mut svm, &payer, &[&payer], pay.clone()).unwrap_err();
            assert!(error.contains("InvalidAmount"), "{error}");
            assert_eq!(tracked.map(|key| svm.get_account(&key)), before);
            assert_eq!(token_units(&svm, custody), (500, 0));
            assert_eq!(token_units(&svm, destination), (5, 0));
            assert_eq!(read::<RewardReserve>(&svm, reserve).outstanding, 500);
            assert_eq!(read::<RewardCycle>(&svm, cycle).distributed_amount, 0);
            assert!(svm.get_account(&payment).is_none());
        }
        return;
    }
    send(&mut svm, &payer, &[&payer], pay.clone()).unwrap();
    assert_eq!(balances(&svm), [164, 341]);
    assert_eq!(token_units(&svm, custody), (164, 0));
    assert_eq!(token_units(&svm, destination), (341, 0));
    let mint_account = svm.get_account(&mint).unwrap();
    assert_eq!(StateWithExtensions::<spl22::state::Mint>::unpack(&mint_account.data).unwrap().base.supply, expected_supply);
    assert_eq!(read::<RewardReserve>(&svm, reserve).outstanding, 164);
    assert_eq!(read::<RewardCycle>(&svm, cycle).distributed_amount, 336);
    let receipt: RewardPayment = read(&svm, payment);
    assert_eq!((receipt.cycle, receipt.recipient, receipt.leaf_index), (cycle, recipient, 0));
    assert_eq!((receipt.amount, receipt.received_amount), (336, 336));
    let paid = snapshot(&svm);
    let paid_receipt = svm.get_account(&payment).unwrap();
    assert!(send(&mut svm, &payer, &[&payer], pay).is_err());
    assert_eq!(snapshot(&svm), paid);
    assert_eq!(svm.get_account(&payment).unwrap(), paid_receipt);
}
