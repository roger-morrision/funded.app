use super::*;
use anchor_lang::solana_program::instruction::AccountMeta;

#[test]
fn paused_operator_handoff_preserves_guard_and_committed_rewards() {
    let mut f = fixture();
    let old = f.operator.insecure_clone();
    let owner = f.owner.insecure_clone();
    let guardian = f.guardian.insecure_clone();
    let successor = Keypair::new();
    f.svm.airdrop(&successor.pubkey(), 10_000_000).unwrap();
    let recipient = Pubkey::new_unique();
    f.svm.airdrop(&recipient, 1_000_000).unwrap();

    let guard = configure(&f, owner.pubkey(), guardian.pubkey(), 1_000);
    assert!(send(&mut f.svm, &owner, &[&owner], &[guard]));
    let create = create_cycle(&f, 31, leaf([31;32],recipient,600),600,START+DAY,true);
    assert!(send(&mut f.svm, &old, &[&old], &[create]));
    let pause_ix = pause(&f,guardian.pubkey(),true);
    assert!(send(&mut f.svm, &guardian, &[&guardian], &[pause_ix]));
    let before = f.svm.get_account(&f.legacy_router).unwrap().data;
    let rotate = Instruction::new_with_bytes(f.program_id, &funded_fee_router::instruction::RotateAuthority{}.data(),
        funded_fee_router::accounts::RotateAuthority{old_authority:old.pubkey(),new_authority:successor.pubkey(),
            app_owner:owner.pubkey(),legacy_router:f.legacy_router,program:f.program_id,program_data:f.program_data}.to_account_metas(None));
    // Each signer is required by the contract, independently of the fee payer.
    for (index,other_signers) in [(0,vec![&owner,&successor]),(1,vec![&owner,&old]),(2,vec![&successor,&old])] {
        let mut incomplete = rotate.clone();
        incomplete.accounts[index].is_signer = false;
        assert!(!send(&mut f.svm, other_signers[0], &other_signers, &[incomplete]));
        assert_eq!(f.svm.get_account(&f.legacy_router).unwrap().data,before);
    }
    assert!(send(&mut f.svm, &old, &[&old,&owner,&successor], &[rotate]));
    let mut expected = before;
    expected[41..73].copy_from_slice(successor.pubkey().as_ref());
    assert_eq!(f.svm.get_account(&f.legacy_router).unwrap().data,expected);
    set_time(&mut f.svm,START+DAY);
    let mut pay = payout(&f,31,recipient,600);
    pay.accounts[0] = AccountMeta::new(successor.pubkey(),true);
    pay.accounts.last_mut().unwrap().is_writable = false;
    assert!(!send(&mut f.svm,&successor,&[&successor],&[pay.clone()]));
    assert_eq!(outstanding(&f.svm,f.reserve),600);
    let resume = pause(&f,owner.pubkey(),false);
    assert!(send(&mut f.svm,&owner,&[&owner],&[resume]));
    let old_work = create_cycle(&f,32,[1;32],1,START+2*DAY,true);
    assert!(!send(&mut f.svm,&old,&[&old],&[old_work]));
    assert!(send(&mut f.svm,&successor,&[&successor],&[pay.clone()]));
    assert_eq!(outstanding(&f.svm,f.reserve),0);
    assert_eq!(f.svm.get_account(&recipient).unwrap().lamports,1_000_600);
    assert!(!send(&mut f.svm,&successor,&[&successor],&[pay]));
    assert_eq!(f.svm.get_account(&recipient).unwrap().lamports,1_000_600);
}
