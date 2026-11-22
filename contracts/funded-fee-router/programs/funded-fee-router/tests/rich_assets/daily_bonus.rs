use super::{asset, config_address, configure, fixture, send};
use anchor_lang::{
    prelude::{Clock, Pubkey},
    solana_program::{instruction::{AccountMeta, Instruction}, system_instruction},
    AccountDeserialize, InstructionData, ToAccountMetas,
};
use funded_fee_router::{accounts, instruction, MintFeePolicyV3, MintWithdrawalV3, RewardReserve};
use funded_fee_router::instructions::rich_assets::RichAssetConfig;
use litesvm::LiteSVM;
use serde_json::Value;
use solana_keypair_lite::Keypair;
use solana_signer_lite::Signer;
use std::process::Command;

fn ix(data: impl InstructionData, accounts: impl ToAccountMetas) -> Instruction {
    Instruction::new_with_bytes(funded_fee_router::id(), &data.data(), accounts.to_account_metas(None))
}

fn read<T: AccountDeserialize>(svm: &LiteSVM, address: Pubkey) -> T {
    T::try_deserialize(&mut svm.get_account(&address).unwrap().data.as_slice()).unwrap()
}

fn digest(value: &Value) -> [u8; 32] {
    let hex = value.as_str().unwrap();
    assert_eq!(hex.len(), 64);
    std::array::from_fn(|n| u8::from_str_radix(&hex[2*n..2*n+2], 16).unwrap())
}

#[test]
fn ranked_bonus_pays_from_original_cohort_after_rotation() {
    let (mut svm, payer, program_data) = fixture();
    let id = funded_fee_router::id();
    let authority = payer.pubkey();
    let system_program = anchor_lang::system_program::ID;
    let pda = |seeds: &[&[u8]]| Pubkey::find_program_address(seeds, &id).0;
    let legacy_router = pda(&[b"funded-fee-router-v1"]);
    let (old, old_market) = asset(&mut svm);
    let (new, new_market) = asset(&mut svm);
    let coin = Keypair::new();
    let mint = coin.pubkey();
    let mint_router = pda(&[b"funded-mint-router-v3", mint.as_ref()]);
    let policy = pda(&[b"mint-fee-policy-v3", mint.as_ref()]);
    let vault = pda(&[b"reward-vault-v1", authority.as_ref(), mint.as_ref()]);
    let sol = Pubkey::default();
    let reserve = pda(&[b"reward-reserve-v1", vault.as_ref(), sol.as_ref()]);
    let winner = Keypair::new().pubkey();
    let runner_up = Keypair::new().pubkey();
    for key in [winner, runner_up] { svm.airdrop(&key, 2_000_000).unwrap(); }

    let output = Command::new("node")
        .arg(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/rich_assets/daily_bonus_manifest.mjs"))
        .args([mint, authority, winner, runner_up].map(|key| key.to_string()))
        .output().expect("run the app bonus manifest fixture with Node");
    assert!(output.status.success(), "{}", String::from_utf8_lossy(&output.stderr));
    let manifest: Value = serde_json::from_slice(&output.stdout).unwrap();
    let cutoff_at = manifest["cutoff"].as_i64().unwrap();
    let mut clock = svm.get_sysvar::<Clock>();
    clock.unix_timestamp = cutoff_at;
    svm.set_sysvar(&clock);

    let init = ix(instruction::Initialize {}, accounts::Initialize {
        authority, app_owner: authority, router: legacy_router, program: id, program_data, system_program,
    });
    send(&mut svm, &payer, &[&payer], init).unwrap();
    send(&mut svm, &payer, &[&payer], configure(authority, program_data, old, old_market, 1, 0)).unwrap();
    let init_policy = ix(instruction::InitializeProtectedMintV3 {
        protocol_units: [0, 0, 0, 0, 2_000_000, 0], directed_units: [8_000_000, 0, 0],
    }, accounts::InitializeProtectedMintV3 {
        authority, creator: authority, mint, legacy_router, router: mint_router, policy, system_program,
    });
    send(&mut svm, &payer, &[&payer, &coin], init_policy).unwrap();
    let init_vault = ix(instruction::InitializeRewardVault {},
        accounts::InitializeRewardVault { authority, mint, vault, legacy_router, system_program });
    let init_reserve = ix(instruction::InitializeRewardReserve { asset_mint: sol },
        accounts::InitializeRewardReserve { authority, vault, reserve, legacy_router, system_program });
    for instruction in [init_vault, init_reserve, system_instruction::transfer(&authority, &mint_router, 3_000)] {
        send(&mut svm, &payer, &[&payer], instruction).unwrap();
    }
    let claim_id = [41; 32];
    let claim = pda(&[b"mint-fee-claim-v3", mint.as_ref(), &claim_id]);
    let mut settle = ix(instruction::SettleMintV3 { claim_id, expected_lamports: 3_000 },
        accounts::SettleMintV3 { authority, creator: authority, mint, legacy_router, router: mint_router, policy, claim, system_program });
    let categories: [Pubkey; 7] = std::array::from_fn(|n| pda(&[b"mint-fee-vault-v3", mint.as_ref(), &[n as u8]]));
    settle.accounts.extend(categories.map(|key| AccountMeta::new(key, false)));
    send(&mut svm, &payer, &[&payer], settle).unwrap();
    assert_eq!(read::<MintFeePolicyV3>(&svm, policy).paid_lamports, [2400, 0, 0, 0, 0, 600, 0]);
    let creator_vault = svm.get_account(&categories[0]).unwrap();
    let category_balance = svm.get_balance(&categories[5]).unwrap();
    let vault_rent = svm.get_balance(&vault).unwrap();
    let withdrawal_id = [42; 32];
    let withdrawal = pda(&[b"mint-withdraw-v3", mint.as_ref(), &withdrawal_id]);
    let fund = ix(instruction::DisburseProtectedMintV3 { withdrawal_id, category: 5, beneficiary: 7, amount: 600, holder_amount: 0 },
        accounts::DisburseProtectedMintV3 { authority, creator: authority, mint, legacy_router, policy, vault: categories[5],
            recipient: vault, approval: pda(&[b"mint-approval-v3", mint.as_ref(), &withdrawal_id]), withdrawal, system_program });
    send(&mut svm, &payer, &[&payer], fund).unwrap();
    let record: MintWithdrawalV3 = read(&svm, withdrawal);
    assert_eq!((record.mint, record.category, record.recipient, record.amount), (mint, 5, vault, 600));
    assert_eq!(category_balance - svm.get_balance(&categories[5]).unwrap(), 600);
    assert_eq!(svm.get_balance(&vault).unwrap(), vault_rent + 600);

    let cycle_id = digest(&manifest["cycleId"]);
    let merkle_root = digest(&manifest["root"]);
    let cycle = pda(&[b"reward-cycle-v1", vault.as_ref(), &cycle_id]);
    let payout_at = cutoff_at + 86_400;
    #[cfg(feature = "mainnet-v3-program")]
    let commit = ix(instruction::CreateRewardCycle { cycle_id, merkle_root, asset_mint: sol, total_amount: 260, cutoff_at, payout_at, leaf_count: 3 },
        accounts::CreateRewardCycle { authority, vault, reserve, cycle, legacy_router, system_program });
    #[cfg(not(feature = "mainnet-v3-program"))]
    let commit = ix(instruction::CreateBitmapCycle { cycle_id, merkle_root, asset_mint: sol, total_amount: 260, cutoff_at, payout_at, leaf_count: 3 },
        accounts::CreateBitmapCycle { authority, vault, reserve, cycle, legacy_router, system_program });
    send(&mut svm, &payer, &[&payer], commit).unwrap();
    let active: RichAssetConfig = read(&svm, config_address());
    assert_eq!((active.mint, active.revision), (old, 1));
    assert_eq!(read::<RewardReserve>(&svm, reserve).outstanding, 260);
    let snapshot = |vm: &LiteSVM| [vault, reserve, cycle, winner, runner_up, policy, categories[5], withdrawal]
        .map(|key| vm.get_account(&key).unwrap());
    let committed = snapshot(&svm);
    send(&mut svm, &payer, &[&payer], configure(authority, program_data, new, new_market, 2, 0)).unwrap();
    let active: RichAssetConfig = read(&svm, config_address());
    assert_eq!((active.mint, active.revision), (new, 2));
    assert_eq!(snapshot(&svm), committed);
    clock.unix_timestamp = payout_at;
    svm.set_sysvar(&clock);

    let leaf_index = u32::try_from(manifest["leafIndex"].as_u64().unwrap()).unwrap();
    let proof: Vec<_> = manifest["proof"].as_array().unwrap().iter().map(digest).collect();
    let pay = |recipient: Pubkey| {
        #[cfg(feature = "mainnet-v3-program")]
        {
            let payment = pda(&[b"reward-payment-v1", cycle.as_ref(), recipient.as_ref()]);
            let mut pay = ix(instruction::PayoutRewardSol { amount: 100, leaf_index, proof: proof.clone() },
                accounts::PayoutRewardSol { payer: authority, vault, reserve, cycle, recipient, payment, system_program });
            pay.accounts.push(AccountMeta::new_readonly(legacy_router, false));
            pay
        }
        #[cfg(not(feature = "mainnet-v3-program"))]
        { ix(instruction::PayoutBitmapSol { amount: 100, leaf_index, proof: proof.clone() },
            accounts::PayoutBitmapSol { payer: authority, vault, reserve, cycle, recipient, system_program }) }
    };
    send(&mut svm, &payer, &[&payer], pay(winner)).unwrap();
    let paid = snapshot(&svm);
    assert_eq!(paid[0].lamports, vault_rent + 500);
    assert_eq!(paid[3].lamports - committed[3].lamports, 100);
    assert_eq!(paid[4..], committed[4..]);
    assert_eq!(svm.get_account(&categories[0]).unwrap(), creator_vault);
    assert_eq!(read::<RewardReserve>(&svm, reserve).outstanding, 160);
    #[cfg(feature = "mainnet-v3-program")]
    {
        let payment = pda(&[b"reward-payment-v1", cycle.as_ref(), winner.as_ref()]);
        let receipt: funded_fee_router::RewardPayment = read(&svm, payment);
        assert_eq!((receipt.recipient, receipt.cycle, receipt.received_amount, receipt.leaf_index), (winner, cycle, 100, leaf_index));
        assert_eq!(read::<funded_fee_router::RewardCycle>(&svm, cycle).distributed_amount, 100);
    }
    #[cfg(not(feature = "mainnet-v3-program"))]
    {
        let state: funded_fee_router::reward_bitmap_state::RewardBitmapCycle = read(&svm, cycle);
        assert_eq!(state.distributed_amount, 100);
        assert_eq!(state.paid, vec![1u8 << leaf_index]);
    }
    assert!(send(&mut svm, &payer, &[&payer], pay(winner)).is_err());
    assert_eq!(snapshot(&svm), paid);
}
