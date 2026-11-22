//! Exercise native Loader-v3 finalization with the frozen ELF and synthetic signers.
#![cfg(feature = "mainnet-v3-program")]
use anchor_lang::prelude::Pubkey;
use anchor_lang::solana_program::{bpf_loader_upgradeable, instruction::{AccountMeta, Instruction}, system_program, system_instruction};
use litesvm::LiteSVM;
use solana_account::Account;
use solana_keypair_lite::Keypair;
use solana_message_lite::{Message, VersionedMessage};
use solana_rent::Rent;
use solana_signer_lite::Signer;
use solana_transaction_lite::versioned::VersionedTransaction;
mod support;

#[test]
fn fresh_loader_recycles_buffer_before_charging_payer_and_binds_deployed_bytes() {
    let mut svm = LiteSVM::new();
    let elf = support::program_bytes();
    let program = funded_fee_router::id();
    let loader = bpf_loader_upgradeable::id();
    let program_data = Pubkey::find_program_address(&[program.as_ref()], &loader).0;
    let payer = Keypair::new();
    let admin = Keypair::new();
    let seed = "reviewed-elf";
    let buffer = Pubkey::create_with_seed(&payer.pubkey(), seed, &loader).unwrap();
    let rent = Rent { lamports_per_byte: 5_080, ..svm.get_sysvar::<Rent>() };
    svm.set_sysvar(&rent);
    let buffer_rent = rent.minimum_balance(37 + elf.len());
    let program_data_rent = rent.minimum_balance(45 + elf.len());
    let program_rent = rent.minimum_balance(36);
    // Allocate the real program address in this local VM. Production creates it
    // with ExUNA's signature in the same message as DeployWithMaxDataLen.
    svm.set_account(program, Account { lamports: program_rent, data: vec![0; 36],
        owner: loader, executable: false, rent_epoch: 0 }).unwrap();
    let chunks = elf.chunks(900);
    let full_writes_fee = chunks.len() as u64 * 10_000;
    svm.airdrop(&payer.pubkey(), program_data_rent + rent.minimum_balance(0) + full_writes_fee + 50_000).unwrap();
    let init = [
        system_instruction::create_account_with_seed(&payer.pubkey(), &buffer, &payer.pubkey(),
            seed, buffer_rent, (37 + elf.len()) as u64, &loader),
        Instruction::new_with_bytes(loader, &0u32.to_le_bytes(), vec![AccountMeta::new(buffer, false),
            AccountMeta::new_readonly(admin.pubkey(), false)]),
    ];
    let message = VersionedMessage::Legacy(Message::new_with_blockhash(&init, Some(&payer.pubkey()), &svm.latest_blockhash()));
    let tx = VersionedTransaction::try_new(message, &[&payer]).unwrap();
    svm.send_transaction(tx).unwrap();
    for (i, bytes) in chunks.enumerate() {
        let mut data = 1u32.to_le_bytes().to_vec();
        data.extend_from_slice(&((i * 900) as u32).to_le_bytes());
        data.extend_from_slice(&(bytes.len() as u64).to_le_bytes());
        data.extend_from_slice(bytes);
        let ix = Instruction::new_with_bytes(loader, &data, vec![AccountMeta::new(buffer, false), AccountMeta::new_readonly(admin.pubkey(), true)]);
        let message = VersionedMessage::Legacy(Message::new_with_blockhash(&[ix], Some(&payer.pubkey()), &svm.latest_blockhash()));
        let tx = VersionedTransaction::try_new(message, &[&payer, &admin]).unwrap();
        svm.send_transaction(tx).unwrap();
    }
    let uploaded = svm.get_account(&buffer).unwrap();
    assert_eq!(uploaded.owner, loader);
    assert_eq!(uploaded.lamports, buffer_rent);
    assert_eq!(&uploaded.data[5..37], admin.pubkey().as_ref());
    assert_eq!(&uploaded.data[37..], elf.as_slice());
    let available = svm.get_account(&payer.pubkey()).unwrap().lamports;
    assert!(available < program_data_rent);
    let mut deploy = 2u32.to_le_bytes().to_vec();
    deploy.extend_from_slice(&(elf.len() as u64).to_le_bytes());
    let ix = Instruction::new_with_bytes(loader, &deploy, vec![
        AccountMeta::new(payer.pubkey(), true), AccountMeta::new(program_data, false),
        AccountMeta::new(program, false), AccountMeta::new(buffer, false),
        AccountMeta::new_readonly(anchor_lang::prelude::pubkey!("SysvarRent111111111111111111111111111111111"), false), AccountMeta::new_readonly(anchor_lang::prelude::pubkey!("SysvarC1ock11111111111111111111111111111111"), false),
        AccountMeta::new_readonly(system_program::id(), false), AccountMeta::new_readonly(admin.pubkey(), true),
    ]);
    let message = VersionedMessage::Legacy(Message::new_with_blockhash(&[ix], Some(&payer.pubkey()), &svm.latest_blockhash()));
    let tx = VersionedTransaction::try_new(message, &[&payer, &admin]).unwrap();
    let meta = svm.send_transaction(tx).unwrap();
    let account = svm.get_account(&program).unwrap();
    assert!(account.executable);
    assert_eq!(account.owner, loader);
    assert_eq!(account.lamports, program_rent);
    assert_eq!(&account.data[4..36], program_data.as_ref());
    let deployed = svm.get_account(&program_data).unwrap();
    assert_eq!(deployed.owner, loader);
    assert_eq!(deployed.data[..4], 3u32.to_le_bytes());
    assert_eq!(deployed.data[12], 1);
    assert_eq!(&deployed.data[13..45], admin.pubkey().as_ref());
    assert_eq!(&deployed.data[45..], &elf);
    assert_eq!(deployed.lamports, program_data_rent);
    assert_eq!(svm.get_account(&buffer).map_or(0, |a| a.lamports), 0);
    assert_eq!(svm.get_account(&payer.pubkey()).unwrap().lamports, available + buffer_rent - program_data_rent - meta.fee);
    println!("FRESH_LOADER bytes={} buffer_rent={buffer_rent} pd_rent={program_data_rent} program_rent={program_rent} finalization_fee={}", elf.len(), meta.fee);
}
