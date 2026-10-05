use anchor_lang::{prelude::Pubkey, solana_program::{instruction::Instruction, system_instruction}, InstructionData, ToAccountMetas};
use funded_fee_router::{MAGIC, POLICY_HASH, ROUTER_DATA_LEN, VERSION};
use litesvm::LiteSVM;
use solana_keypair_lite::Keypair;
use solana_message_lite::{Message, VersionedMessage};
use solana_signer_lite::Signer;
use solana_transaction_lite::versioned::VersionedTransaction;

fn send(svm: &mut LiteSVM, payer: &Keypair, signers: &[&Keypair], instruction: Instruction) -> bool {
    let message = Message::new_with_blockhash(&[instruction], Some(&payer.pubkey()), &svm.latest_blockhash());
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(message), signers).unwrap();
    svm.send_transaction(tx).is_ok()
}

#[test]
fn prefunded_router_initialization_preserves_deposits_and_rejects_reinitialization() {
    let program = funded_fee_router::id();
    // Exercise both rent top-up and a deposit larger than required rent.
    for prefunding in [1_000_000, 10_000_000] {
        let mut svm = LiteSVM::new();
        svm.add_program(program, include_bytes!("../../../target/deploy/funded_fee_router.so")).unwrap();
        let payer = Keypair::new();
        let mint = Keypair::new();
        svm.airdrop(&payer.pubkey(), 1_000_000_000).unwrap();
        let (legacy_router, legacy_bump) = Pubkey::find_program_address(&[b"funded-fee-router-v1"], &program);
        let (router, mint_bump) = Pubkey::find_program_address(&[b"funded-mint-router-v2", mint.pubkey().as_ref()], &program);
        for address in [legacy_router, router] {
            assert!(send(&mut svm, &payer, &[&payer], system_instruction::transfer(&payer.pubkey(), &address, prefunding)));
        }
        let initialize = Instruction::new_with_bytes(program, &funded_fee_router::instruction::Initialize {}.data(),
            funded_fee_router::accounts::Initialize { authority: payer.pubkey(), router: legacy_router,
                system_program: anchor_lang::system_program::ID }.to_account_metas(None));
        assert!(send(&mut svm, &payer, &[&payer], initialize.clone()), "prefunded global router must initialize");
        let account = svm.get_account(&legacy_router).unwrap();
        assert_eq!(account.owner, program);
        assert_eq!(account.lamports, prefunding.max(svm.minimum_balance_for_rent_exemption(ROUTER_DATA_LEN)));
        assert_eq!(account.data.len(), ROUTER_DATA_LEN);
        assert_eq!(account.data[73], legacy_bump);
        let initialize_mint = Instruction::new_with_bytes(program, &funded_fee_router::instruction::InitializeMint {}.data(),
            funded_fee_router::accounts::InitializeMint { payer: payer.pubkey(), mint: mint.pubkey(), legacy_router, router,
                system_program: anchor_lang::system_program::ID }.to_account_metas(None));
        assert!(send(&mut svm, &payer, &[&payer, &mint], initialize_mint.clone()), "prefunded mint router must initialize");
        let mint_account = svm.get_account(&router).unwrap();
        assert_eq!(mint_account.owner, program);
        assert_eq!(mint_account.lamports, prefunding.max(svm.minimum_balance_for_rent_exemption(funded_fee_router::MINT_ROUTER_DATA_LEN)));
        assert_eq!(&mint_account.data[41..73], payer.pubkey().as_ref());
        assert_eq!(&mint_account.data[73..105], mint.pubkey().as_ref());
        assert_eq!(mint_account.data[105], mint_bump);
        svm.expire_blockhash();
        assert!(!send(&mut svm, &payer, &[&payer], initialize));
        assert!(!send(&mut svm, &payer, &[&payer, &mint], initialize_mint));
        assert_eq!(svm.get_account(&legacy_router).unwrap(), account);
        assert_eq!(svm.get_account(&router).unwrap(), mint_account);
    }
}

#[test]
fn header_repair_requires_stored_authority_and_preserves_balance() {
    let program = funded_fee_router::id();
    let mut svm = LiteSVM::new();
    svm.add_program(program, include_bytes!("../../../target/deploy/funded_fee_router.so")).unwrap();
    let authority = Keypair::new();
    let stranger = Keypair::new();
    svm.airdrop(&authority.pubkey(), 100_000_000).unwrap();
    svm.airdrop(&stranger.pubkey(), 100_000_000).unwrap();
    let (router, bump) = Pubkey::find_program_address(&[b"funded-fee-router-v1"], &program);
    let mut data = vec![255; ROUTER_DATA_LEN];
    data[41..73].copy_from_slice(authority.pubkey().as_ref());
    let before = solana_account::Account { lamports: 10_000_000, data, owner: program, executable: false, rent_epoch: 0 };
    svm.set_account(router, before.clone()).unwrap();
    let repair = |signer| Instruction::new_with_bytes(program, &funded_fee_router::instruction::RepairHeader {}.data(),
        funded_fee_router::accounts::RepairHeader { authority: signer, router }.to_account_metas(None));
    assert!(!send(&mut svm, &stranger, &[&stranger], repair(stranger.pubkey())));
    assert_eq!(svm.get_account(&router).unwrap(), before);
    assert!(send(&mut svm, &authority, &[&authority], repair(authority.pubkey())));
    let repaired = svm.get_account(&router).unwrap();
    assert_eq!(repaired.lamports, before.lamports);
    assert_eq!(&repaired.data[..8], MAGIC);
    assert_eq!(repaired.data[8], VERSION);
    assert_eq!(&repaired.data[9..41], &POLICY_HASH);
    assert_eq!(&repaired.data[41..73], authority.pubkey().as_ref());
    assert_eq!(repaired.data[73], bump);
}
