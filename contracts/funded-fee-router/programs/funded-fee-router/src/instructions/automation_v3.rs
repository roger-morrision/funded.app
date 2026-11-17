use anchor_lang::prelude::*;
use crate::{constants::*, error::ErrorCode, state::{MintFeePolicyV3, MintAgencyPolicyV3}};
use super::rotate::assert_current_router_authority;

pub const AUTOMATION_SEED: &[u8] = b"mint-automation-v3";

#[account]
#[derive(InitSpace)]
pub struct MintAutomationV3 {
    pub mint: Pubkey,
    pub creator: Pubkey,
    pub policy: Pubkey,
    pub recipients: [Pubkey; 4],
    pub bump: u8,
}

#[derive(Accounts)]
pub struct InitializeMintAutomationV3<'info> {
    #[account(mut)] pub authority: Signer<'info>,
    /// CHECK: Identity is verified against the program-owned mint policy.
    pub creator: UncheckedAccount<'info>,
    pub mint: UncheckedAccount<'info>,
    #[account(seeds = [SEED], bump)] pub legacy_router: UncheckedAccount<'info>,
    /// CHECK: The policy owner, PDA, mint and creator are verified below.
    pub policy: UncheckedAccount<'info>,
    #[account(init, payer = authority, space = 8 + MintAutomationV3::INIT_SPACE,
        seeds = [AUTOMATION_SEED, mint.key().as_ref()], bump)]
    pub automation: Account<'info, MintAutomationV3>,
    pub system_program: Program<'info, System>,
}

pub fn initialize(ctx: Context<InitializeMintAutomationV3>, recipients: [Pubkey; 4]) -> Result<()> {
    assert_current_router_authority(&ctx.accounts.legacy_router.to_account_info(), &ctx.accounts.authority.key(), ctx.program_id)?;
    let mint = ctx.accounts.mint.key();
    let creator = ctx.accounts.creator.key();
    let info = ctx.accounts.policy.to_account_info();
    require!(info.owner == ctx.program_id, ErrorCode::InvalidMintFeePolicyV3);
    let data = info.try_borrow_data()?;
    let standard = Pubkey::find_program_address(&[MINT_POLICY_V3_SEED, mint.as_ref()], ctx.program_id).0;
    let agency = Pubkey::find_program_address(&[b"mint-agency-policy-v3", mint.as_ref()], ctx.program_id).0;
    let identity = if info.key() == standard {
        // Only protected policies enforce the creator's three individual budgets.
        require!(data.len() == 8 + MintFeePolicyV3::INIT_SPACE + 44, ErrorCode::InvalidProtectedMintPolicyV3);
        let policy = MintFeePolicyV3::try_deserialize(&mut &data[..])?;
        (policy.mint, policy.creator)
    } else {
        require!(info.key() == agency, ErrorCode::InvalidAgencyPolicyV3);
        let policy = MintAgencyPolicyV3::try_deserialize(&mut &data[..])?;
        (policy.mint, policy.creator)
    };
    require!(identity == (mint, creator) && recipients[0] != Pubkey::default(), ErrorCode::InvalidMintFeePolicyV3);
    let record = &mut ctx.accounts.automation;
    record.mint = mint; record.creator = creator; record.policy = info.key();
    record.recipients = recipients; record.bump = ctx.bumps.automation;
    Ok(())
}

// A creator signature preserves the existing manual path. The automatic path
// uses one immutable record, initialized by the current platform authority.
// Category 0 and 5 destinations and individual budgets are enforced by their
// existing protected-policy handlers; protocol recipients are frozen here.
pub fn authorize(program_id: &Pubkey, creator: &AccountInfo, mint: &Pubkey,
    policy: &Pubkey, category: u8, recipient: &Pubkey, remaining: &[AccountInfo]) -> Result<()> {
    if creator.is_signer { return Ok(()); }
    require!(remaining.len() == 1, ErrorCode::InvalidMintApprovalV3);
    let info = &remaining[0];
    let (expected, bump) = Pubkey::find_program_address(&[AUTOMATION_SEED, mint.as_ref()], program_id);
    require!(info.key() == expected && info.owner == program_id, ErrorCode::InvalidMintApprovalV3);
    let record = MintAutomationV3::try_deserialize(&mut &info.try_borrow_data()?[..])?;
    require!(record.mint == *mint && record.creator == creator.key() && record.policy == *policy
        && record.bump == bump, ErrorCode::InvalidMintApprovalV3);
    if (1..=4).contains(&category) {
        require!(record.recipients[usize::from(category - 1)] != Pubkey::default()
            && record.recipients[usize::from(category - 1)] == *recipient, ErrorCode::InvalidMintApprovalV3);
    }
    Ok(())
}
