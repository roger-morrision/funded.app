use anchor_lang::solana_program::bpf_loader_upgradeable;
use anchor_lang::prelude::Pubkey;
use litesvm::LiteSVM;
use solana_account::Account;

pub fn program_bytes() -> Vec<u8> {
    let default_path = concat!(env!("CARGO_MANIFEST_DIR"), "/../../target/deploy/funded_fee_router.so");
    let path = std::env::var("FUNDED_ROUTER_TEST_SO").unwrap_or_else(|_| default_path.to_string());
    std::fs::read(path).expect("load the SBF program under test")
}

pub fn set_upgrade_owner(svm: &mut LiteSVM, program_id: Pubkey, owner: Pubkey) -> Pubkey {
    let mut program = svm.get_account(&program_id).expect("program must be loaded first");
    let program_data_address = if program.data.len() >= 36 && program.data[0..4] == 2u32.to_le_bytes() {
        Pubkey::new_from_array(program.data[4..36].try_into().unwrap())
    } else {
        Pubkey::new_unique()
    };
    program.data = [2u32.to_le_bytes().as_slice(), program_data_address.as_ref()].concat();
    program.owner = bpf_loader_upgradeable::id();
    program.executable = true;
    svm.set_account(program_id, program).unwrap();

    let mut program_data = svm.get_account(&program_data_address).unwrap_or(Account {
        lamports: 1_000_000, data: vec![0; 45], owner: bpf_loader_upgradeable::id(),
        executable: false, rent_epoch: 0,
    });
    if program_data.data.len() >= 13 && program_data.data[0..4] == 3u32.to_le_bytes() && program_data.data[12] == 0 {
        program_data.data.splice(13..13, [0u8; 32]);
    }
    if program_data.data.len() < 45 { program_data.data.resize(45, 0); }
    program_data.data[0..4].copy_from_slice(&3u32.to_le_bytes());
    program_data.data[12] = 1;
    program_data.data[13..45].copy_from_slice(owner.as_ref());
    program_data.owner = bpf_loader_upgradeable::id();
    program_data.executable = false;
    svm.set_account(program_data_address, program_data).unwrap();
    program_data_address
}
