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

fn send(svm: &mut LiteSVM, payer: &Keypair, signers: &[&Keypair], instructions: &[Instruction]) -> bool {
    let message = Message::new_with_blockhash(instructions, Some(&payer.pubkey()), &svm.latest_blockhash());
    let transaction = VersionedTransaction::try_new(VersionedMessage::Legacy(message), signers).unwrap();
    match svm.send_transaction(transaction) {
        Ok(_) => true,
        Err(error) => { eprintln!("transaction failed: {error:?}"); false }
    }
}

fn token_amount(svm: &LiteSVM, account: Pubkey) -> u64 {
    let data = svm.get_account(&account).unwrap().data;
    u64::from_le_bytes(data[64..72].try_into().unwrap())
}

fn leaf(drop: Pubkey, recipient: Pubkey, amount: u64, index: u32) -> [u8; 32] {
    hashv(&[b"funded-community-leaf-v1", drop.as_ref(), recipient.as_ref(), &amount.to_le_bytes(), &index.to_le_bytes()]).to_bytes()
}

#[test]
fn community_claim_duplicate_ineligible_expiry_and_owner_closeout() {
    let program_id = funded_fee_router::id();
    let mut svm = LiteSVM::new();
    svm.add_program(program_id, include_bytes!("../../../target/deploy/funded_fee_router.so")).unwrap();
    let mut initial_clock = svm.get_sysvar::<Clock>();
    initial_clock.unix_timestamp = 1_800_000_000;
    svm.set_sysvar(&initial_clock);
    let creator = Keypair::new();
    let protocol = Keypair::new();
    let mint = Keypair::new();
    let eligibility = Keypair::new();
    let eligible_a = Keypair::new();
    let eligible_b = Keypair::new();
    let ineligible = Keypair::new();
    svm.airdrop(&creator.pubkey(), 1_000_000_000).unwrap();
    svm.airdrop(&protocol.pubkey(), 100_000_000).unwrap();
    let token_program = spl_token::ID;
    for token_mint in [&mint, &eligibility] {
        let instructions = [
            system_instruction::create_account(&creator.pubkey(), &token_mint.pubkey(), 2_000_000, spl_token::state::Mint::LEN as u64, &token_program),
            spl_token::instruction::initialize_mint2(&token_program, &token_mint.pubkey(), &creator.pubkey(), None, 0).unwrap(),
        ];
        assert!(send(&mut svm, &creator, &[&creator, token_mint], &instructions));
    }
    let source = get_associated_token_address(&creator.pubkey(), &mint.pubkey());
    let source_create = spl_associated_token_account::instruction::create_associated_token_account(&creator.pubkey(), &creator.pubkey(), &mint.pubkey(), &token_program);
    assert!(send(&mut svm, &creator, &[&creator], &[source_create]));
    assert!(send(&mut svm, &creator, &[&creator], &[spl_token::instruction::mint_to(&token_program, &mint.pubkey(), &source, &creator.pubkey(), &[], 100).unwrap()]));

    let (drop, _) = Pubkey::find_program_address(&[b"community-drop-v1", protocol.pubkey().as_ref(), mint.pubkey().as_ref()], &program_id);
    let vault = get_associated_token_address(&drop, &mint.pubkey());
    let payment_a = Pubkey::find_program_address(&[b"community-pay-v1", drop.as_ref(), eligible_a.pubkey().as_ref()], &program_id).0;
    let payment_b = Pubkey::find_program_address(&[b"community-pay-v1", drop.as_ref(), eligible_b.pubkey().as_ref()], &program_id).0;
    let root_a = leaf(drop, eligible_a.pubkey(), 40, 0);
    let root_b = leaf(drop, eligible_b.pubkey(), 60, 1);
    let root = if root_a <= root_b { hashv(&[&root_a, &root_b]).to_bytes() } else { hashv(&[&root_b, &root_a]).to_bytes() };
    let migration_at = svm.get_sysvar::<Clock>().unix_timestamp;
    let initialize = Instruction::new_with_bytes(program_id, &funded_fee_router::instruction::InitializeCommunityDrop {
        merkle_root:root, snapshot_hash:[9; 32], migration_signature:[7; 64], migration_slot:1234, snapshot_slot:1234,
        migration_at, total_amount:100, leaf_count:2,
    }.data(), funded_fee_router::accounts::InitializeCommunityDrop {
        protocol_authority:protocol.pubkey(), creator:creator.pubkey(), app_owner:protocol.pubkey(), mint:mint.pubkey(), eligibility_mint:eligibility.pubkey(),
        drop, creator_token_account:source, vault_token_account:vault, token_program,
        associated_token_program:spl_associated_token_account::program::ID, system_program:anchor_lang::system_program::ID,
    }.to_account_metas(None));
    let mut wrong_owner_initialize = initialize.clone();
    wrong_owner_initialize.accounts[2].pubkey = creator.pubkey();
    assert!(!send(&mut svm, &creator, &[&creator, &protocol], &[wrong_owner_initialize]));
    assert!(svm.get_account(&drop).is_none());
    assert!(send(&mut svm, &creator, &[&creator, &protocol], &[initialize]));
    assert_eq!(token_amount(&svm, source), 0);
    assert_eq!(token_amount(&svm, vault), 100);

    let recipient_a_token = get_associated_token_address(&eligible_a.pubkey(), &mint.pubkey());
    let recipient_b_token = get_associated_token_address(&eligible_b.pubkey(), &mint.pubkey());
    let ineligible_token = get_associated_token_address(&ineligible.pubkey(), &mint.pubkey());
    for recipient in [&eligible_a, &eligible_b, &ineligible] {
        let create = spl_associated_token_account::instruction::create_associated_token_account(&creator.pubkey(), &recipient.pubkey(), &mint.pubkey(), &token_program);
        assert!(send(&mut svm, &creator, &[&creator], &[create]));
    }
    let claim_a = Instruction::new_with_bytes(program_id, &funded_fee_router::instruction::ClaimCommunityDrop { amount:40, leaf_index:0, proof:vec![root_b] }.data(),
        funded_fee_router::accounts::ClaimCommunityDrop { payer:creator.pubkey(), drop, recipient:eligible_a.pubkey(), mint:mint.pubkey(), vault_token_account:vault,
            recipient_token_account:recipient_a_token, payment:payment_a, token_program, system_program:anchor_lang::system_program::ID }.to_account_metas(None));
    assert!(send(&mut svm, &creator, &[&creator], &[claim_a.clone()]));
    assert_eq!(token_amount(&svm, recipient_a_token), 40);
    assert_eq!(token_amount(&svm, vault), 60);
    assert!(!send(&mut svm, &creator, &[&creator], &[system_instruction::transfer(&creator.pubkey(), &protocol.pubkey(), 1), claim_a]));
    assert_eq!(token_amount(&svm, recipient_a_token), 40);
    assert_eq!(token_amount(&svm, vault), 60);

    let invalid_payment = Pubkey::find_program_address(&[b"community-pay-v1", drop.as_ref(), ineligible.pubkey().as_ref()], &program_id).0;
    let invalid_claim = Instruction::new_with_bytes(program_id, &funded_fee_router::instruction::ClaimCommunityDrop { amount:60, leaf_index:1, proof:vec![root_a] }.data(),
        funded_fee_router::accounts::ClaimCommunityDrop { payer:creator.pubkey(), drop, recipient:ineligible.pubkey(), mint:mint.pubkey(), vault_token_account:vault,
            recipient_token_account:ineligible_token, payment:invalid_payment, token_program, system_program:anchor_lang::system_program::ID }.to_account_metas(None));
    assert!(!send(&mut svm, &creator, &[&creator], &[invalid_claim]));
    assert!(svm.get_account(&invalid_payment).is_none());
    assert_eq!(token_amount(&svm, ineligible_token), 0);
    assert_eq!(token_amount(&svm, vault), 60);

    let mut clock = svm.get_sysvar::<Clock>();
    clock.unix_timestamp = migration_at + 90 * 24 * 60 * 60;
    svm.set_sysvar(&clock);
    let claim_b = Instruction::new_with_bytes(program_id, &funded_fee_router::instruction::ClaimCommunityDrop { amount:60, leaf_index:1, proof:vec![root_a] }.data(),
        funded_fee_router::accounts::ClaimCommunityDrop { payer:creator.pubkey(), drop, recipient:eligible_b.pubkey(), mint:mint.pubkey(), vault_token_account:vault,
            recipient_token_account:recipient_b_token, payment:payment_b, token_program, system_program:anchor_lang::system_program::ID }.to_account_metas(None));
    assert!(!send(&mut svm, &creator, &[&creator], &[claim_b]));
    assert!(svm.get_account(&payment_b).is_none());
    assert_eq!(token_amount(&svm, recipient_b_token), 0);
    assert_eq!(token_amount(&svm, vault), 60);

    let app_owner = protocol.pubkey();
    let owner_token = get_associated_token_address(&app_owner, &mint.pubkey());
    let create_owner = spl_associated_token_account::instruction::create_associated_token_account(&creator.pubkey(), &app_owner, &mint.pubkey(), &token_program);
    assert!(send(&mut svm, &creator, &[&creator], &[create_owner]));
    let wrong_destination = Instruction::new_with_bytes(program_id, &funded_fee_router::instruction::CloseCommunityDrop {}.data(),
        funded_fee_router::accounts::CloseCommunityDrop { caller:creator.pubkey(), drop, mint:mint.pubkey(), vault_token_account:vault,
            remainder_token_account:source, token_program }.to_account_metas(None));
    assert!(!send(&mut svm, &creator, &[&creator], &[wrong_destination]));
    assert_eq!(token_amount(&svm, vault), 60);
    let close = Instruction::new_with_bytes(program_id, &funded_fee_router::instruction::CloseCommunityDrop {}.data(),
        funded_fee_router::accounts::CloseCommunityDrop { caller:creator.pubkey(), drop, mint:mint.pubkey(), vault_token_account:vault,
            remainder_token_account:owner_token, token_program }.to_account_metas(None));
    assert!(send(&mut svm, &creator, &[&creator], &[close.clone()]));
    assert_eq!(token_amount(&svm, vault), 0);
    assert_eq!(token_amount(&svm, owner_token), 60);
    assert_eq!(token_amount(&svm, recipient_a_token), 40);
    assert!(!send(&mut svm, &creator, &[&creator], &[system_instruction::transfer(&creator.pubkey(), &protocol.pubkey(), 2), close]));
}
