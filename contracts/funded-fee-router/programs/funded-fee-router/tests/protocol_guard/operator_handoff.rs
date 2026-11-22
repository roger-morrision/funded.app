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
    let outstanding_recipient = Pubkey::new_unique();
    let paid_leaf = leaf([33;32], recipient, 100);
    let unpaid_leaf = hashv(&[b"funded-reward-leaf-v1", &[33;32], outstanding_recipient.as_ref(),
        Pubkey::default().as_ref(), &200u64.to_le_bytes(), &1u32.to_le_bytes()]).to_bytes();
    let mut leaves = [paid_leaf, unpaid_leaf];
    leaves.sort();
    let root = hashv(&[&leaves[0], &leaves[1]]).to_bytes();
    let mut pending = create_cycle(&f, 33, root, 300, START+DAY, true);
    pending.data = funded_fee_router::instruction::CreateRewardCycle {
        cycle_id:[33;32], merkle_root:root, asset_mint:Pubkey::default(), total_amount:300,
        cutoff_at:START, payout_at:START+DAY, leaf_count:2,
    }.data();
    let unrelated = create_cycle(&f, 35, leaf([35;32],recipient,41),41,START+DAY,true);
    assert!(send(&mut f.svm,&old,&[&old],&[unrelated]));
    assert!(send(&mut f.svm,&old,&[&old],&[pending]));
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
    assert_eq!(outstanding(&f.svm,f.reserve),941);
    let resume = pause(&f,owner.pubkey(),false);
    assert!(send(&mut f.svm,&owner,&[&owner],&[resume]));
    let old_work = create_cycle(&f,32,[1;32],1,START+2*DAY,true);
    assert!(!send(&mut f.svm,&old,&[&old],&[old_work]));
    assert!(send(&mut f.svm,&successor,&[&successor],&[pay.clone()]));
    assert_eq!(outstanding(&f.svm,f.reserve),341);
    assert_eq!(f.svm.get_account(&recipient).unwrap().lamports,1_000_600);
    assert!(!send(&mut f.svm,&successor,&[&successor],&[pay]));
    assert_eq!(f.svm.get_account(&recipient).unwrap().lamports,1_000_600);
    // The previous authority's reserve retains its own canonical PDA and liabilities.
    let mut partial = payout(&f,33,recipient,100);
    partial.accounts[0] = AccountMeta::new(successor.pubkey(), true);
    partial.accounts.last_mut().unwrap().is_writable = false;
    partial.data = funded_fee_router::instruction::PayoutRewardSol { amount:100, leaf_index:0, proof:vec![unpaid_leaf] }.data();
    assert!(send(&mut f.svm,&successor,&[&successor],&[partial]));
    assert_eq!(outstanding(&f.svm,f.reserve),241);
    let mut allocate_old = create_cycle(&f,34,[2;32],1,START+2*DAY,true);
    allocate_old.accounts[0].pubkey = successor.pubkey();
    assert!(!send(&mut f.svm,&successor,&[&successor],&[allocate_old]));

    let cycle = cycle_address(&f,33);
    let other_cycle = cycle_address(&f,35);
    let tracked = [f.vault, f.reserve, cycle, other_cycle, recipient];
    let snapshot = |vm:&LiteSVM| tracked.map(|address| vm.get_account(&address).unwrap());
    let before = snapshot(&f.svm);
    let expire = Instruction::new_with_bytes(f.program_id,&funded_fee_router::instruction::ExpireRewardCycle{}.data(),
        funded_fee_router::accounts::ExpireRewardCycle{authority:successor.pubkey(),vault:f.vault,reserve:f.reserve,
            cycle,legacy_router:f.legacy_router}.to_account_metas(None));
    let deadline = START + DAY + funded_fee_router::REWARD_CYCLE_EXPIRY_GRACE_SECONDS;
    set_time(&mut f.svm,deadline-1);
    assert!(!send(&mut f.svm,&successor,&[&successor],&[expire.clone()]));
    assert_eq!(snapshot(&f.svm),before);
    set_time(&mut f.svm,deadline);
    let stop = pause(&f, guardian.pubkey(), true);
    assert!(send(&mut f.svm,&guardian,&[&guardian],&[stop]));
    assert!(!send(&mut f.svm,&successor,&[&successor],&[expire.clone()]));
    assert_eq!(snapshot(&f.svm),before);
    let resume = pause(&f,owner.pubkey(),false);
    assert!(send(&mut f.svm,&owner,&[&owner],&[resume]));
    let mut old_attempt = expire.clone();
    old_attempt.accounts[0].pubkey = old.pubkey();
    assert!(!send(&mut f.svm,&old,&[&old],&[old_attempt]));
    assert_eq!(snapshot(&f.svm),before);
    // Well-formed account data at the wrong address must fail address binding.
    for index in [1,2,3,4] {
        let mut invalid = expire.clone();
        let alternate = Pubkey::new_unique();
        let original = f.svm.get_account(&invalid.accounts[index].pubkey).unwrap();
        f.svm.set_account(alternate,original.clone()).unwrap();
        invalid.accounts[index].pubkey = alternate;
        assert!(!send(&mut f.svm,&successor,&[&successor],&[invalid]));
        assert_eq!(snapshot(&f.svm),before);
        assert_eq!(f.svm.get_account(&alternate).unwrap(),original);
    }
    assert!(send(&mut f.svm,&successor,&[&successor],&[expire.clone()]));
    assert_eq!(outstanding(&f.svm,f.reserve),41);
    let after = snapshot(&f.svm);
    assert_eq!(after[0],before[0]);
    assert_eq!(after[3],before[3]);
    assert_eq!(after[4],before[4]);
    use anchor_lang::{AccountDeserialize, AccountSerialize};
    let mut expected = funded_fee_router::RewardCycle::try_deserialize(&mut before[2].data.as_slice()).unwrap();
    assert_eq!((expected.total_amount,expected.distributed_amount,expected.merkle_root),(300,100,root));
    assert!(expected.reserved);
    expected.reserved = false;
    let mut encoded = vec![];
    expected.try_serialize(&mut encoded).unwrap();
    assert_eq!(after[2].data,encoded);
    assert!(!send(&mut f.svm,&successor,&[&successor],&[expire]));
    assert_eq!(snapshot(&f.svm),after);
}
