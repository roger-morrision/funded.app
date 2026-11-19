#![cfg(feature="mainnet-v3-program")]
use anchor_lang::solana_program::instruction::Instruction;
use litesvm::LiteSVM;
use solana_keypair_lite::Keypair;
use solana_signer_lite::Signer;
use solana_message_lite::{Message,VersionedMessage};
use solana_transaction_lite::versioned::VersionedTransaction;
use solana_sha256_hasher::hashv;
mod support;

#[test]
fn receipt_cleanup_and_bitmap_entrypoints_are_absent_from_mainnet_build(){
    let mut svm=LiteSVM::new();let id=funded_fee_router::id();svm.add_program(id,&support::program_bytes()).unwrap();
    let payer=Keypair::new();svm.airdrop(&payer.pubkey(),1_000_000_000).unwrap();
    for name in ["complete_reward_cycle","close_reward_payment","create_bitmap_cycle","create_bitmap_cycle_token","payout_bitmap_sol","payout_bitmap_token","expire_bitmap_cycle"]{
        let hash=hashv(&[format!("global:{}",name).as_bytes()]).to_bytes();
        let ix=Instruction::new_with_bytes(id,&hash[..8],vec![]);
        let message=Message::new_with_blockhash(&[ix],Some(&payer.pubkey()),&svm.latest_blockhash());
        let tx=VersionedTransaction::try_new(VersionedMessage::Legacy(message),&[&payer]).unwrap();
        let err=svm.send_transaction(tx).unwrap_err();
        assert!(format!("{:?}",err.err).contains("Custom(101)"),"{} must be unrecognized, got {:?}",name,err);
        svm.expire_blockhash();
    }
}
