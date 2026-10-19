//! Two explicitly approved, fixed lost-creator Devnet collections. This module is
//! excluded from the default program. It cannot withdraw or change recipients.
use anchor_lang::prelude::*;
use crate::{constants::*, error::ErrorCode, state::{MintClaimRecordV3, MintFeePolicyV3}};
use super::policy_v3::settle_collection;

pub const QA_MINT: Pubkey = pubkey!("HdGmAbwR1ng3VTQkQ6Gw3QYhJGebWNFf5voktjCKwhvL");
pub const QA_CREATOR: Pubkey = pubkey!("89cmvLYLdvm9XRa1gu4DB8zzhmUsEjPWuTM1ahJzpkZM");
pub const QA_AUTHORITY: Pubkey = pubkey!("7epA9KQ5wkwo5wZ5kcY8CfVUvpwVJoAMz2RNqt2ZwK5Y");
pub const QA_CLAIM: [u8; 32] = [255,26,231,26,197,226,210,238,219,152,23,184,41,67,197,69,
    40,232,24,134,165,115,228,156,225,48,12,29,22,192,45,15];
pub const QA_AMOUNT: u64 = 742_575;
pub const QA_PRIOR_SETTLED: u64 = 322_917;
pub const QA_RATES: [u32; 6] = [1_000_000, 200_000, 60_000, 40_000, 200_000, 500_000];
pub const QA_PRIOR_PAID: [u64; 7] = [258_333,32_292,6_458,1_938,1_291,6_459,16_146];
pub const QA_FOLLOWUP_CLAIM: [u8;32] = [156,173,204,203,61,37,84,165,8,83,254,123,124,187,38,63,
    181,202,224,129,80,236,26,156,251,12,181,17,8,196,248,100];
pub const QA_FOLLOWUP_AMOUNT: u64 = 1_484_671;
pub const QA_FOLLOWUP_PRIOR_SETTLED: u64 = 1_065_492;
pub const QA_FOLLOWUP_PRIOR_PAID: [u64;7] = [852_393,106_549,21_310,6_393,4_262,21_310,53_275];

pub fn approved_prior(claim_id: [u8;32], settled: u64, paid: [u64;7]) -> bool {
    (claim_id == QA_CLAIM && settled == QA_PRIOR_SETTLED && paid == QA_PRIOR_PAID)
        || (claim_id == QA_FOLLOWUP_CLAIM && settled == QA_FOLLOWUP_PRIOR_SETTLED && paid == QA_FOLLOWUP_PRIOR_PAID)
}

#[derive(Accounts)]
#[instruction(claim_id: [u8; 32])]
pub struct RecoverQaSettlementV3<'info> {
    #[account(mut, address = QA_AUTHORITY)]
    pub authority: Signer<'info>,
    /// CHECK: Fixed historical creator; no signature waiver exists for any other wallet.
    #[account(address = QA_CREATOR)]
    pub creator: UncheckedAccount<'info>,
    /// CHECK: Fixed historical mint, further bound to the immutable policy.
    #[account(address = QA_MINT)]
    pub mint: UncheckedAccount<'info>,
    /// CHECK: The common settlement code verifies the global authority/header.
    #[account(seeds = [SEED], bump)]
    pub legacy_router: UncheckedAccount<'info>,
    /// CHECK: Common code verifies owner, header and rent before debiting.
    #[account(mut, seeds = [MINT_ROUTER_V3_SEED, mint.key().as_ref()], bump)]
    pub router: UncheckedAccount<'info>,
    #[account(mut, seeds = [MINT_POLICY_V3_SEED, mint.key().as_ref()], bump = policy.bump,
        constraint = policy.mint == QA_MINT && policy.creator == QA_CREATOR
            && policy.authority == QA_AUTHORITY && policy.protocol_units == QA_RATES
            && approved_prior(claim_id, policy.settled_lamports, policy.paid_lamports)
            @ ErrorCode::InvalidQaRecoveryV3)]
    pub policy: Account<'info, MintFeePolicyV3>,
    #[account(init, payer = authority, space = 8 + MintClaimRecordV3::INIT_SPACE,
        seeds = [MINT_CLAIM_V3_SEED, mint.key().as_ref(), claim_id.as_ref()], bump)]
    pub claim: Account<'info, MintClaimRecordV3>,
    pub system_program: Program<'info, System>,
}

pub fn handler<'info>(ctx: Context<'info, RecoverQaSettlementV3<'info>>,
    claim_id: [u8; 32], expected_lamports: u64) -> Result<()> {
    require_keys_eq!(*ctx.program_id,
        pubkey!("9H1r2nTZs6gQaheYTMaBWpH12JX6dCFj2Rvxg7Lno2Sm"), ErrorCode::InvalidQaRecoveryV3);
    require!((claim_id == QA_CLAIM && expected_lamports == QA_AMOUNT)
        || (claim_id == QA_FOLLOWUP_CLAIM && expected_lamports == QA_FOLLOWUP_AMOUNT), ErrorCode::InvalidQaRecoveryV3);
    settle_collection(ctx.program_id, &ctx.accounts.authority, &ctx.accounts.mint,
        &ctx.accounts.legacy_router, &ctx.accounts.router, &mut ctx.accounts.policy,
        &mut ctx.accounts.claim, &ctx.accounts.system_program, ctx.remaining_accounts,
        ctx.bumps.router, claim_id, expected_lamports)
}
