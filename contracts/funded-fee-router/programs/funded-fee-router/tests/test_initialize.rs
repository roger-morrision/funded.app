
use {
    anchor_lang::{solana_program::{instruction::{AccountMeta, Instruction}, system_instruction}, InstructionData, ToAccountMetas},
    litesvm::LiteSVM,
    solana_message::{Message, VersionedMessage},
    solana_signer::Signer,
    solana_keypair::Keypair,
    solana_transaction::versioned::VersionedTransaction,
};

#[test]
fn test_initialize() {
    let program_id = funded_fee_router::id();
    let payer = Keypair::new();
    let mut svm = LiteSVM::new();
    let bytes = include_bytes!("../../../target/deploy/funded_fee_router.so");
    svm.add_program(program_id, bytes).unwrap();
    svm.airdrop(&payer.pubkey(), 1_000_000_000).unwrap();
    let (router, _) = anchor_lang::prelude::Pubkey::find_program_address(&[b"funded-fee-router-v1"], &program_id);
    
    let instruction = Instruction::new_with_bytes(
        program_id,
        &funded_fee_router::instruction::Initialize {}.data(),
        funded_fee_router::accounts::Initialize {
            authority: payer.pubkey(),
            router,
            system_program: anchor_lang::system_program::ID,
        }.to_account_metas(None),
    );

    let blockhash = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[instruction], Some(&payer.pubkey()), &blockhash);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[payer]).unwrap();

    let res = svm.send_transaction(tx);
    assert!(res.is_ok());
    assert!(svm.get_account(&router).is_some());
}

#[test]
fn test_mint_router_claim() {
    let program_id = funded_fee_router::id();
    let authority = Keypair::new();
    let mint = Keypair::new();
    let recipient = Keypair::new().pubkey();
    let mut svm = LiteSVM::new();
    svm.add_program(program_id, include_bytes!("../../../target/deploy/funded_fee_router.so")).unwrap();
    svm.airdrop(&authority.pubkey(), 1_000_000_000).unwrap();
    let (legacy_router, _) = anchor_lang::prelude::Pubkey::find_program_address(&[b"funded-fee-router-v1"], &program_id);
    let (router, _) = anchor_lang::prelude::Pubkey::find_program_address(&[b"funded-mint-router-v2", mint.pubkey().as_ref()], &program_id);
    let claim_id = [42u8; 32];
    let (claim, _) = anchor_lang::prelude::Pubkey::find_program_address(&[b"claim", mint.pubkey().as_ref(), &claim_id], &program_id);

    let initialize = Instruction::new_with_bytes(
        program_id,
        &funded_fee_router::instruction::Initialize {}.data(),
        funded_fee_router::accounts::Initialize { authority: authority.pubkey(), router: legacy_router, system_program: anchor_lang::system_program::ID }.to_account_metas(None),
    );
    let msg = Message::new_with_blockhash(&[initialize], Some(&authority.pubkey()), &svm.latest_blockhash());
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&authority]).unwrap();
    svm.send_transaction(tx).unwrap();

    let initialize_mint = Instruction::new_with_bytes(
        program_id,
        &funded_fee_router::instruction::InitializeMint {}.data(),
        funded_fee_router::accounts::InitializeMint { payer: authority.pubkey(), mint: mint.pubkey(), legacy_router, router, system_program: anchor_lang::system_program::ID }.to_account_metas(None),
    );
    let msg = Message::new_with_blockhash(&[initialize_mint], Some(&authority.pubkey()), &svm.latest_blockhash());
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&authority, &mint]).unwrap();
    svm.send_transaction(tx).unwrap();
    let before = svm.get_account(&router).unwrap().lamports;

    let deposit = system_instruction::transfer(&authority.pubkey(), &router, 200_000_000);
    let msg = Message::new_with_blockhash(&[deposit], Some(&authority.pubkey()), &svm.latest_blockhash());
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&authority]).unwrap();
    svm.send_transaction(tx).unwrap();

    let mut metas = funded_fee_router::accounts::SettleMint { authority: authority.pubkey(), mint: mint.pubkey(), router, claim, system_program: anchor_lang::system_program::ID }.to_account_metas(None);
    metas.push(AccountMeta::new(recipient, false));
    let settle = Instruction::new_with_bytes(
        program_id,
        &funded_fee_router::instruction::SettleMint { claim_id, amounts: vec![100_000_000] }.data(),
        metas,
    );
    let msg = Message::new_with_blockhash(&[settle], Some(&authority.pubkey()), &svm.latest_blockhash());
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&authority]).unwrap();
    svm.send_transaction(tx).unwrap();
    assert_eq!(svm.get_account(&recipient).unwrap().lamports, 100_000_000);
    assert_eq!(svm.get_account(&router).unwrap().lamports, before + 100_000_000);
    let recorded = svm.get_account(&claim).unwrap();
    assert_eq!(&recorded.data[8..40], &claim_id);
    assert_eq!(&recorded.data[40..72], mint.pubkey().as_ref());
    assert_eq!(&recorded.data[72..104], recipient.as_ref());
    assert_eq!(u64::from_le_bytes(recorded.data[104..112].try_into().unwrap()), 100_000_000);
}
