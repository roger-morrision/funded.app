use super::{configure, fixture, send, set_time, DAY, START};
use anchor_lang::{
    prelude::Pubkey,
    solana_program::{instruction::{AccountMeta, Instruction}, system_instruction},
    AccountDeserialize, InstructionData, ToAccountMetas,
};
use funded_fee_router::{accounts, instruction, MintFeePolicyV3, MintWithdrawalApprovalV3, MintWithdrawalV3};
use litesvm::LiteSVM;
use solana_keypair_lite::Keypair;
use solana_message_lite::{Message, VersionedMessage};
use solana_signer_lite::Signer;
use solana_transaction_lite::versioned::VersionedTransaction;

fn ix(data: impl InstructionData, accounts: impl ToAccountMetas) -> Instruction {
    Instruction::new_with_bytes(funded_fee_router::id(), &data.data(), accounts.to_account_metas(None))
}

fn read<T: AccountDeserialize>(vm: &LiteSVM, key: Pubkey) -> T {
    T::try_deserialize(&mut vm.get_account(&key).unwrap().data.as_slice()).unwrap()
}

fn window(vm: &LiteSVM, router: Pubkey) -> (u64, u64) {
    let data = vm.get_account(&router).unwrap().data;
    let field = |offset| u64::from_le_bytes(data[offset..offset + 8].try_into().unwrap());
    (field(funded_fee_router::GUARD_WINDOW_DAY), field(funded_fee_router::GUARD_WINDOW_SPENT))
}

#[test]
fn protected_operations_cap_and_midnight_retry() {
    let mut f = fixture();
    let op = &f.operator;
    let authority = op.pubkey();
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
    let cap = 100;
    let guard = configure(&f, f.owner.pubkey(), f.guardian.pubkey(), cap);
    assert!(send(&mut f.svm, &f.owner, &[&f.owner], &[guard]));
    let init = ix(instruction::InitializeProtectedMintV3 {
        protocol_units: [2_000_000, 0, 0, 0, 0, 0], directed_units: [8_000_000, 0, 0],
    }, accounts::InitializeProtectedMintV3 { authority, creator, mint, legacy_router, router, policy, system_program });
    assert!(send(&mut f.svm, &creator_key, &[&creator_key, &coin], &[init]));

    let claim_id = [12; 32];
    let claim = pda(&[funded_fee_router::MINT_CLAIM_V3_SEED, mint.as_ref(), &claim_id]);
    let mut settle = ix(instruction::SettleMintV3 { claim_id, expected_lamports: 1_000 },
        accounts::SettleMintV3 { authority, creator, mint, legacy_router, router, policy, claim, system_program });
    let vaults: [Pubkey; 7] = std::array::from_fn(|n| pda(&[funded_fee_router::MINT_VAULT_V3_SEED, mint.as_ref(), &[n as u8]]));
    settle.accounts.extend(vaults.map(|key| AccountMeta::new(key, false)));
    let fund = system_instruction::transfer(&authority, &router, 1_000);
    assert!(send(&mut f.svm, op, &[op, &creator_key], &[fund, settle]));
    assert_eq!(read::<MintFeePolicyV3>(&f.svm, policy).paid_lamports, [800, 200, 0, 0, 0, 0, 0]);
    let initial_custody = f.svm.get_balance(&vaults[1]).unwrap();
    let initial_recipient = f.svm.get_balance(&recipient).unwrap();
    let creator_vault = f.svm.get_account(&vaults[0]).unwrap();
    let day = START.div_euclid(DAY);
    let midnight = (day + 1) * DAY;
    set_time(&mut f.svm, midnight - 1);

    let instructions = |id: u8, amount| {
        let withdrawal_id = [id; 32];
        let approval = pda(&[funded_fee_router::MINT_APPROVAL_V3_SEED, mint.as_ref(), &withdrawal_id]);
        let withdrawal = pda(&[funded_fee_router::MINT_WITHDRAWAL_V3_SEED, mint.as_ref(), &withdrawal_id]);
        let mut approve = ix(instruction::ApproveProtectedWithdrawalV3 { withdrawal_id, category: 1, beneficiary: 3, amount },
            accounts::ApproveProtectedWithdrawalV3 { authority, creator, mint, legacy_router, policy, recipient, approval, system_program });
        let mut pay = ix(instruction::DisburseProtectedMintV3 { withdrawal_id, category: 1, beneficiary: 3, amount, holder_amount: 0 },
            accounts::DisburseProtectedMintV3 { authority, creator, mint, legacy_router, policy, vault: vaults[1], recipient, approval, withdrawal, system_program });
        // Match the app's co-signed protected payout and writable Mainnet guard.
        approve.accounts[1].is_signer = true;
        pay.accounts[1].is_signer = true;
        pay.accounts[3].is_writable = true;
        (approve, pay, approval, withdrawal)
    };
    let check_balances = |vm: &LiteSVM, paid| {
        assert_eq!(vm.get_balance(&vaults[1]).unwrap(), initial_custody - paid);
        assert_eq!(vm.get_balance(&recipient).unwrap(), initial_recipient + paid);
        assert_eq!(read::<MintFeePolicyV3>(vm, policy).withdrawn_lamports, [0, paid, 0, 0, 0, 0, 0]);
        assert_eq!(vm.get_account(&vaults[0]).unwrap(), creator_vault);
    };
    for first in 1..cap {
        let mut vm = f.svm.clone();
        let mut spent = 0;
        for (id, amount) in [(1, first), (2, cap - first), (3, 1)] {
            let (approve, pay, approval, withdrawal) = instructions(id, amount);
            assert!(send(&mut vm, op, &[op, &creator_key], &[approve]));
            let record: MintWithdrawalApprovalV3 = read(&vm, approval);
            assert_eq!((record.category, record.beneficiary, record.amount, record.recipient, record.consumed),
                (1, 3, amount, recipient, false));
            if spent == cap {
                let snapshot = |vm: &LiteSVM| [legacy_router, policy, vaults[1], recipient, approval, withdrawal]
                    .map(|key| vm.get_account(&key));
                let before = snapshot(&vm);
                assert!(before[5].is_none());
                let message = Message::new_with_blockhash(std::slice::from_ref(&pay), Some(&authority), &vm.latest_blockhash());
                let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(message), &[op, &creator_key]).unwrap();
                let failure = vm.send_transaction(tx).unwrap_err();
                assert!(failure.meta.logs.iter().any(|line| line.contains("DailyOutflowCapExceeded")), "{failure:?}");
                assert_eq!(snapshot(&vm), before);
                vm.expire_blockhash();
                set_time(&mut vm, midnight);
            }
            assert!(send(&mut vm, op, &[op, &creator_key], &[pay]));
            spent += amount;
            let receipt: MintWithdrawalV3 = read(&vm, withdrawal);
            assert_eq!((receipt.withdrawal_id, receipt.mint, receipt.category, receipt.amount, receipt.recipient),
                ([id; 32], mint, 1, amount, recipient));
            assert!(read::<MintWithdrawalApprovalV3>(&vm, approval).consumed);
            check_balances(&vm, spent);
            let expected_window = if spent <= cap { (day as u64, spent) } else { (day as u64 + 1, amount) };
            assert_eq!(window(&vm, legacy_router), expected_window);
        }
    }
}
