
use {
    anchor_lang::{solana_program::{instruction::{AccountMeta, Instruction}, system_instruction}, InstructionData, ToAccountMetas},
    litesvm::LiteSVM,
    solana_message::{Message, VersionedMessage},
    solana_signer::Signer,
    solana_keypair::Keypair,
    solana_account::Account,
    solana_transaction::versioned::VersionedTransaction,
};
mod support;

#[test]
fn test_initialize() {
    let program_id = funded_fee_router::id();
    let payer = Keypair::new();
    let mut svm = LiteSVM::new();
    let bytes = support::program_bytes();
    svm.add_program(program_id, &bytes).unwrap();
    let program_data = support::set_upgrade_owner(&mut svm, program_id, payer.pubkey());
    svm.airdrop(&payer.pubkey(), 1_000_000_000).unwrap();
    let attacker = Keypair::new();
    svm.airdrop(&attacker.pubkey(), 10_000_000).unwrap();
    let (router, _) = anchor_lang::prelude::Pubkey::find_program_address(&[b"funded-fee-router-v1"], &program_id);
    
    let instruction = Instruction::new_with_bytes(
        program_id,
        &funded_fee_router::instruction::Initialize {}.data(),
        funded_fee_router::accounts::Initialize {
            authority: payer.pubkey(),
            app_owner: payer.pubkey(),
            router,
            program: program_id,
            program_data,
            system_program: anchor_lang::system_program::ID,
        }.to_account_metas(None),
    );

    let attacker_instruction = Instruction::new_with_bytes(program_id,
        &funded_fee_router::instruction::Initialize {}.data(),
        funded_fee_router::accounts::Initialize { authority:attacker.pubkey(), app_owner:attacker.pubkey(),
            router, program:program_id, program_data, system_program:anchor_lang::system_program::ID }.to_account_metas(None));
    let attacker_message = Message::new_with_blockhash(&[attacker_instruction], Some(&attacker.pubkey()), &svm.latest_blockhash());
    let attacker_tx = VersionedTransaction::try_new(VersionedMessage::Legacy(attacker_message), &[&attacker]).unwrap();
    assert!(svm.send_transaction(attacker_tx).is_err());
    assert!(svm.get_account(&router).is_none());

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
    let creator = Keypair::new();
    let app_owner = Keypair::new();
    let next_authority = Keypair::new();
    let mint = Keypair::new();
    let recipient = Keypair::new().pubkey();
    let mut svm = LiteSVM::new();
    svm.add_program(program_id, &support::program_bytes()).unwrap();
    let program_data = support::set_upgrade_owner(&mut svm, program_id, app_owner.pubkey());
    svm.airdrop(&authority.pubkey(), 1_000_000_000).unwrap();
    svm.airdrop(&creator.pubkey(), 100_000_000).unwrap();
    let (legacy_router, _) = anchor_lang::prelude::Pubkey::find_program_address(&[b"funded-fee-router-v1"], &program_id);
    let (router, _) = anchor_lang::prelude::Pubkey::find_program_address(&[b"funded-mint-router-v2", mint.pubkey().as_ref()], &program_id);
    let (ledger, _) = anchor_lang::prelude::Pubkey::find_program_address(&[b"mint-fee-ledger-v1", mint.pubkey().as_ref()], &program_id);
    let claim_id = [42u8; 32];
    let (claim, _) = anchor_lang::prelude::Pubkey::find_program_address(&[b"claim", mint.pubkey().as_ref(), &claim_id], &program_id);

    let initialize = Instruction::new_with_bytes(
        program_id,
        &funded_fee_router::instruction::Initialize {}.data(),
        funded_fee_router::accounts::Initialize { authority: authority.pubkey(), app_owner: app_owner.pubkey(), router: legacy_router, program: program_id, program_data, system_program: anchor_lang::system_program::ID }.to_account_metas(None),
    );
    let msg = Message::new_with_blockhash(&[initialize], Some(&authority.pubkey()), &svm.latest_blockhash());
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&authority, &app_owner]).unwrap();
    svm.send_transaction(tx).unwrap();

    let initialize_mint = Instruction::new_with_bytes(
        program_id,
        &funded_fee_router::instruction::InitializeMint {}.data(),
        funded_fee_router::accounts::InitializeMint { payer: creator.pubkey(), mint: mint.pubkey(), legacy_router, router, ledger, system_program: anchor_lang::system_program::ID }.to_account_metas(None),
    );
    let msg = Message::new_with_blockhash(&[initialize_mint], Some(&creator.pubkey()), &svm.latest_blockhash());
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&creator, &mint]).unwrap();
    svm.send_transaction(tx).unwrap();
    let before = svm.get_account(&router).unwrap().lamports;

    let deposit = system_instruction::transfer(&authority.pubkey(), &router, 200_000_000);
    let msg = Message::new_with_blockhash(&[deposit], Some(&authority.pubkey()), &svm.latest_blockhash());
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&authority]).unwrap();
    svm.send_transaction(tx).unwrap();

    let mut metas = funded_fee_router::accounts::SettleMint { authority: authority.pubkey(), creator: creator.pubkey(), mint: mint.pubkey(), legacy_router, router, ledger, claim, system_program: anchor_lang::system_program::ID }.to_account_metas(None);
    metas.push(AccountMeta::new(recipient, false));
    let settle = Instruction::new_with_bytes(
        program_id,
        &funded_fee_router::instruction::SettleMint { claim_id, amounts: vec![100_000_000], share:0 }.data(),
        metas,
    );
    let msg = Message::new_with_blockhash(&[settle], Some(&authority.pubkey()), &svm.latest_blockhash());
    assert!(VersionedTransaction::try_new(VersionedMessage::Legacy(msg.clone()), &[&authority]).is_err());
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&authority, &creator]).unwrap();
    svm.send_transaction(tx).unwrap();
    assert_eq!(svm.get_account(&recipient).unwrap().lamports, 100_000_000);
    assert_eq!(svm.get_account(&router).unwrap().lamports, before + 100_000_000);
    let recorded = svm.get_account(&claim).unwrap();
    assert_eq!(&recorded.data[8..40], &claim_id);
    assert_eq!(&recorded.data[40..72], mint.pubkey().as_ref());
    assert_eq!(&recorded.data[72..104], recipient.as_ref());
    assert_eq!(u64::from_le_bytes(recorded.data[104..112].try_into().unwrap()), 100_000_000);
    assert_eq!(recorded.data[120], 0);

    let over_id = [44u8; 32];
    let (over_claim, _) = anchor_lang::prelude::Pubkey::find_program_address(&[b"claim", mint.pubkey().as_ref(), &over_id], &program_id);
    let mut over_metas = funded_fee_router::accounts::SettleMint { authority:authority.pubkey(), creator:creator.pubkey(),
        mint:mint.pubkey(), legacy_router, router, ledger, claim:over_claim,
        system_program:anchor_lang::system_program::ID }.to_account_metas(None);
    over_metas.push(AccountMeta::new(recipient, false));
    let over = Instruction::new_with_bytes(program_id,
        &funded_fee_router::instruction::SettleMint { claim_id:over_id, amounts:vec![61_000_000], share:0 }.data(), over_metas);
    let msg = Message::new_with_blockhash(&[over], Some(&authority.pubkey()), &svm.latest_blockhash());
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&authority, &creator]).unwrap();
    assert!(svm.send_transaction(tx).is_err());
    assert!(svm.get_account(&over_claim).is_none());

    let protocol_id = [45u8; 32];
    let (protocol_claim, _) = anchor_lang::prelude::Pubkey::find_program_address(&[b"claim", mint.pubkey().as_ref(), &protocol_id], &program_id);
    let mut protocol_metas = funded_fee_router::accounts::SettleMint { authority:authority.pubkey(), creator:creator.pubkey(),
        mint:mint.pubkey(), legacy_router, router, ledger, claim:protocol_claim,
        system_program:anchor_lang::system_program::ID }.to_account_metas(None);
    protocol_metas.push(AccountMeta::new(recipient, false));
    let protocol_settle = Instruction::new_with_bytes(program_id,
        &funded_fee_router::instruction::SettleMint { claim_id:protocol_id, amounts:vec![40_000_000], share:1 }.data(), protocol_metas);
    let msg = Message::new_with_blockhash(&[protocol_settle], Some(&authority.pubkey()), &svm.latest_blockhash());
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&authority, &creator]).unwrap();
    svm.send_transaction(tx).unwrap();
    assert_eq!(svm.get_account(&protocol_claim).unwrap().data[120], 1);

    let rotate = Instruction::new_with_bytes(program_id, &funded_fee_router::instruction::RotateAuthority {}.data(),
        funded_fee_router::accounts::RotateAuthority { old_authority:authority.pubkey(), new_authority:next_authority.pubkey(),
            app_owner:app_owner.pubkey(), legacy_router, program:program_id, program_data }.to_account_metas(None));
    let msg = Message::new_with_blockhash(&[rotate], Some(&authority.pubkey()), &svm.latest_blockhash());
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&authority, &next_authority, &app_owner]).unwrap();
    svm.send_transaction(tx).unwrap();

    let second_claim_id = [43u8; 32];
    let (second_claim, _) = anchor_lang::prelude::Pubkey::find_program_address(&[b"claim", mint.pubkey().as_ref(), &second_claim_id], &program_id);
    let mut metas = funded_fee_router::accounts::SettleMint { authority:authority.pubkey(), creator:creator.pubkey(), mint:mint.pubkey(),
        legacy_router, router, ledger, claim:second_claim, system_program:anchor_lang::system_program::ID }.to_account_metas(None);
    metas.push(AccountMeta::new(recipient, false));
    let stale_settlement = Instruction::new_with_bytes(program_id,
        &funded_fee_router::instruction::SettleMint { claim_id:second_claim_id, amounts:vec![1_000_000], share:0 }.data(), metas);
    let msg = Message::new_with_blockhash(&[stale_settlement], Some(&authority.pubkey()), &svm.latest_blockhash());
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&authority, &creator]).unwrap();
    assert!(svm.send_transaction(tx).is_err());
    assert!(svm.get_account(&second_claim).is_none());
}

#[test]
fn existing_mint_ledger_migration_requires_creator_and_upgrade_owner() {
    let program_id = funded_fee_router::id();
    let authority = Keypair::new();
    let creator = Keypair::new();
    let app_owner = Keypair::new();
    let attacker = Keypair::new();
    let mint = Keypair::new().pubkey();
    let mut svm = LiteSVM::new();
    svm.add_program(program_id, &support::program_bytes()).unwrap();
    let program_data = support::set_upgrade_owner(&mut svm, program_id, app_owner.pubkey());
    svm.airdrop(&authority.pubkey(), 1_000_000_000).unwrap();
    svm.airdrop(&attacker.pubkey(), 10_000_000).unwrap();
    let (legacy_router, _) = anchor_lang::prelude::Pubkey::find_program_address(&[b"funded-fee-router-v1"], &program_id);
    let (router, bump) = anchor_lang::prelude::Pubkey::find_program_address(&[b"funded-mint-router-v2", mint.as_ref()], &program_id);
    let (ledger, _) = anchor_lang::prelude::Pubkey::find_program_address(&[b"mint-fee-ledger-v1", mint.as_ref()], &program_id);
    let initialize = Instruction::new_with_bytes(program_id, &funded_fee_router::instruction::Initialize {}.data(),
        funded_fee_router::accounts::Initialize { authority:authority.pubkey(),app_owner:app_owner.pubkey(),router:legacy_router,
            program:program_id,program_data,system_program:anchor_lang::system_program::ID }.to_account_metas(None));
    let msg = Message::new_with_blockhash(&[initialize], Some(&authority.pubkey()), &svm.latest_blockhash());
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&authority,&app_owner]).unwrap();
    svm.send_transaction(tx).unwrap();
    let mut data = vec![0u8; 106];
    data[0..8].copy_from_slice(b"FUNDMNT2");
    data[8] = 2;
    data[9..41].copy_from_slice(&funded_fee_router::POLICY_HASH);
    data[41..73].copy_from_slice(authority.pubkey().as_ref());
    data[73..105].copy_from_slice(mint.as_ref());
    data[105] = bump;
    let router_rent = anchor_lang::prelude::Rent::default().minimum_balance(106);
    svm.set_account(router, Account {lamports:router_rent,data,
        owner:program_id,executable:false,rent_epoch:0}).unwrap();
    let migrate = Instruction::new_with_bytes(program_id, &funded_fee_router::instruction::MigrateMintFeeLedger {}.data(),
        funded_fee_router::accounts::MigrateMintFeeLedger {authority:authority.pubkey(),creator:creator.pubkey(),
            app_owner:app_owner.pubkey(),mint,legacy_router,router,ledger,program:program_id,program_data,
            system_program:anchor_lang::system_program::ID}.to_account_metas(None));
    let mut unauthorized = migrate.clone();
    unauthorized.accounts[2].pubkey = attacker.pubkey();
    let msg = Message::new_with_blockhash(&[unauthorized], Some(&authority.pubkey()), &svm.latest_blockhash());
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&authority,&creator,&attacker]).unwrap();
    assert!(svm.send_transaction(tx).is_err());
    assert!(svm.get_account(&ledger).is_none());
    let msg = Message::new_with_blockhash(&[migrate.clone()], Some(&authority.pubkey()), &svm.latest_blockhash());
    assert!(VersionedTransaction::try_new(VersionedMessage::Legacy(msg.clone()), &[&authority,&app_owner]).is_err());
    let mut funded_router = svm.get_account(&router).unwrap();
    funded_router.lamports += 1;
    svm.set_account(router, funded_router).unwrap();
    let funded_tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg.clone()), &[&authority,&creator,&app_owner]).unwrap();
    assert!(svm.send_transaction(funded_tx).is_err());
    assert!(svm.get_account(&ledger).is_none());
    let mut empty_router = svm.get_account(&router).unwrap();
    empty_router.lamports = router_rent;
    svm.set_account(router, empty_router).unwrap();
    svm.expire_blockhash();
    let valid_msg = Message::new_with_blockhash(&[migrate], Some(&authority.pubkey()), &svm.latest_blockhash());
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(valid_msg), &[&authority,&creator,&app_owner]).unwrap();
    svm.send_transaction(tx).unwrap();
    let ledger_data = svm.get_account(&ledger).unwrap().data;
    assert_eq!(&ledger_data[8..40], mint.as_ref());
    assert_eq!(&ledger_data[40..72], creator.pubkey().as_ref());
}

#[test]
fn legacy_settlement_rejects_empty_self_and_invalid_destinations() {
    use anchor_lang::prelude::Pubkey;
    use solana_account::Account;
    use funded_fee_router::{MAGIC, VERSION, POLICY_HASH, ROUTER_DATA_LEN, SEED};
    let program_id = funded_fee_router::id();
    let authority = Keypair::new();
    let recipient = Pubkey::new_unique();
    let mut svm = LiteSVM::new();
    svm.add_program(program_id, include_bytes!("../../../target/deploy/funded_fee_router.so")).unwrap();
    svm.airdrop(&authority.pubkey(), 1_000_000_000).unwrap();
    let (router, bump) = Pubkey::find_program_address(&[SEED], &program_id);
    let mut data = vec![0; ROUTER_DATA_LEN];
    data[..8].copy_from_slice(MAGIC);
    data[8] = VERSION;
    data[9..41].copy_from_slice(&POLICY_HASH);
    data[41..73].copy_from_slice(authority.pubkey().as_ref());
    data[73] = bump;
    svm.set_account(router, Account { lamports: 200_000_000, data, owner: program_id, executable: false, rent_epoch: 0 }).unwrap();
    for (index, destinations, amounts) in [
        (0, vec![], vec![]),
        (1, vec![AccountMeta::new(router, false)], vec![1_000_000]),
        (3, vec![AccountMeta::new_readonly(recipient, false)], vec![1_000_000]),
        (4, vec![AccountMeta::new(recipient, false)], vec![0]),
        (5, vec![AccountMeta::new(recipient, false)], vec![200_000_000]),
    ] {
        let claim_id = [index; 32];
        let claim = Pubkey::find_program_address(&[b"claim", &claim_id], &program_id).0;
        let mut metas = funded_fee_router::accounts::Settle { authority: authority.pubkey(), router, claim,
            system_program: anchor_lang::system_program::ID }.to_account_metas(None);
        metas.extend(destinations);
        let instruction = Instruction::new_with_bytes(program_id, &funded_fee_router::instruction::Settle { claim_id, amounts }.data(), metas);
        let message = Message::new_with_blockhash(&[instruction], Some(&authority.pubkey()), &svm.latest_blockhash());
        let transaction = VersionedTransaction::try_new(VersionedMessage::Legacy(message), &[&authority]).unwrap();
        assert!(svm.send_transaction(transaction).is_err(), "invalid settlement {index} accepted");
        assert!(svm.get_account(&claim).is_none());
        assert_eq!(svm.get_account(&router).unwrap().lamports, 200_000_000);
    }
    // Legacy callers may legitimately pay the authority; preserve that supported path.
    let claim_id = [9; 32];
    let claim = Pubkey::find_program_address(&[b"claim", &claim_id], &program_id).0;
    let mut metas = funded_fee_router::accounts::Settle { authority: authority.pubkey(), router, claim,
        system_program: anchor_lang::system_program::ID }.to_account_metas(None);
    metas.push(AccountMeta::new(authority.pubkey(), false));
    let instruction = Instruction::new_with_bytes(program_id,
        &funded_fee_router::instruction::Settle { claim_id, amounts: vec![1_000_000] }.data(), metas);
    let message = Message::new_with_blockhash(&[instruction], Some(&authority.pubkey()), &svm.latest_blockhash());
    let transaction = VersionedTransaction::try_new(VersionedMessage::Legacy(message), &[&authority]).unwrap();
    svm.send_transaction(transaction).unwrap();
    assert!(svm.get_account(&claim).is_some());
    assert_eq!(svm.get_account(&router).unwrap().lamports, 199_000_000);
}
