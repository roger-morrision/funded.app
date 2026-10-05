use {
    anchor_lang::{solana_program::{instruction::Instruction, program_option::COption, program_pack::Pack, system_instruction}, InstructionData, ToAccountMetas},
    anchor_spl::{associated_token::{get_associated_token_address, spl_associated_token_account}, token::spl_token},
    litesvm::LiteSVM,
    solana_account::Account,
    solana_keypair_lite::Keypair,
    solana_message_lite::{Message, VersionedMessage},
    solana_signer_lite::Signer,
    solana_transaction_lite::versioned::VersionedTransaction,
};

fn send(svm: &mut LiteSVM, payer: &Keypair, signers: &[&Keypair], instructions: &[Instruction]) -> bool {
    let message = Message::new_with_blockhash(instructions, Some(&payer.pubkey()), &svm.latest_blockhash());
    let transaction = VersionedTransaction::try_new(VersionedMessage::Legacy(message), signers).unwrap();
    match svm.send_transaction(transaction) {
        Ok(_) => true,
        Err(error) => { eprintln!("transaction failed: {error:?}"); false }
    }
}

#[test]
fn recovers_only_the_mint_router_native_ata() {
    let program_id = funded_fee_router::id();
    let authority = Keypair::new();
    let other = Keypair::new();
    let mint = Keypair::new();
    let mut svm = LiteSVM::new();
    svm.add_program(program_id, include_bytes!("../../../target/deploy/funded_fee_router.so")).unwrap();
    let native_mint = spl_token::state::Mint { mint_authority:COption::None, supply:0,
        decimals:9, is_initialized:true, freeze_authority:COption::None };
    let mut native_mint_data = vec![0; spl_token::state::Mint::LEN];
    spl_token::state::Mint::pack(native_mint, &mut native_mint_data).unwrap();
    svm.set_account(spl_token::native_mint::id(), Account { lamports:1_461_600,
        data:native_mint_data, owner:spl_token::ID, executable:false, rent_epoch:0 }).unwrap();
    svm.airdrop(&authority.pubkey(), 100_000_000).unwrap();
    svm.airdrop(&other.pubkey(), 10_000_000).unwrap();
    let (legacy, _) = anchor_lang::prelude::Pubkey::find_program_address(&[b"funded-fee-router-v1"], &program_id);
    let (router, _) = anchor_lang::prelude::Pubkey::find_program_address(&[b"funded-mint-router-v2", mint.pubkey().as_ref()], &program_id);
    let initialize = Instruction::new_with_bytes(program_id, &funded_fee_router::instruction::Initialize {}.data(),
        funded_fee_router::accounts::Initialize { authority: authority.pubkey(), router:legacy, system_program:anchor_lang::system_program::ID }.to_account_metas(None));
    assert!(send(&mut svm, &authority, &[&authority], &[initialize]));
    let initialize_mint = Instruction::new_with_bytes(program_id, &funded_fee_router::instruction::InitializeMint {}.data(),
        funded_fee_router::accounts::InitializeMint { payer:authority.pubkey(), mint:mint.pubkey(), legacy_router:legacy, router,
            system_program:anchor_lang::system_program::ID }.to_account_metas(None));
    assert!(send(&mut svm, &authority, &[&authority, &mint], &[initialize_mint]));

    let ata = get_associated_token_address(&router, &spl_token::native_mint::id());
    let create = spl_associated_token_account::instruction::create_associated_token_account_idempotent(
        &authority.pubkey(), &router, &spl_token::native_mint::id(), &spl_token::ID);
    assert!(send(&mut svm, &authority, &[&authority], &[create]));
    let amount = 11_780_249;
    let deposit = system_instruction::transfer(&authority.pubkey(), &ata, amount);
    let sync = spl_token::instruction::sync_native(&spl_token::ID, &ata).unwrap();
    assert!(send(&mut svm, &authority, &[&authority], &[deposit, sync]));
    let before = svm.get_account(&router).unwrap().lamports;
    let account_lamports = svm.get_account(&ata).unwrap().lamports;
    let recover = |signer| Instruction::new_with_bytes(program_id, &funded_fee_router::instruction::RecoverMintWrappedSol {}.data(),
        funded_fee_router::accounts::RecoverMintWrappedSol { authority:signer, mint:mint.pubkey(), router,
            wrapped_sol:ata, token_program:spl_token::ID }.to_account_metas(None));
    assert!(!send(&mut svm, &other, &[&other], &[recover(other.pubkey())]));
    assert_eq!(svm.get_account(&ata).unwrap().lamports, account_lamports);
    assert!(send(&mut svm, &authority, &[&authority], &[recover(authority.pubkey())]));
    assert!(svm.get_account(&ata).is_none());
    assert_eq!(svm.get_account(&router).unwrap().lamports - before, account_lamports);
}
