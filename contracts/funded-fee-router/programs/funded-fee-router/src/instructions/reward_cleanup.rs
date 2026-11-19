use anchor_lang::prelude::*;
use crate::{constants::*, error::ErrorCode, state::{RewardCycle, RewardPayment, RewardVault}};
use super::rotate::assert_current_router_authority;

// Keep the cycle account forever. Its address cannot be initialized again and
// reserved=false rejects every legacy payout, even after receipt reclamation.
#[derive(Accounts)]
pub struct CompleteRewardCycle<'info> {
    pub authority: Signer<'info>,
    #[account(seeds=[REWARD_VAULT_SEED, authority.key().as_ref(), vault.mint.as_ref()], bump=vault.bump, has_one=authority)]
    pub vault: Account<'info, RewardVault>,
    #[account(mut, seeds=[REWARD_CYCLE_SEED, vault.key().as_ref(), cycle.cycle_id.as_ref()], bump=cycle.bump, has_one=vault)]
    pub cycle: Account<'info, RewardCycle>,
    /// CHECK: Verified against the current router authority.
    #[account(seeds=[SEED], bump)]
    pub legacy_router: UncheckedAccount<'info>,
}

pub fn complete(ctx: Context<CompleteRewardCycle>) -> Result<()> {
    assert_current_router_authority(&ctx.accounts.legacy_router.to_account_info(), &ctx.accounts.authority.key(), ctx.program_id)?;
    require!(ctx.accounts.cycle.distributed_amount == ctx.accounts.cycle.total_amount, ErrorCode::RewardTotalExceeded);
    ctx.accounts.cycle.reserved = false;
    Ok(())
}

#[derive(Accounts)]
pub struct CloseRewardPayment<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(seeds=[REWARD_VAULT_SEED, authority.key().as_ref(), vault.mint.as_ref()], bump=vault.bump, has_one=authority)]
    pub vault: Account<'info, RewardVault>,
    #[account(seeds=[REWARD_CYCLE_SEED, vault.key().as_ref(), cycle.cycle_id.as_ref()], bump=cycle.bump, has_one=vault,
        constraint=!cycle.reserved @ ErrorCode::RewardCycleNotExpirable)]
    pub cycle: Account<'info, RewardCycle>,
    // The app-sponsored receipt rent returns only to this vault's authority.
    #[account(mut, close=authority,
        seeds=[REWARD_PAYMENT_SEED, cycle.key().as_ref(), payment.recipient.as_ref()], bump, has_one=cycle)]
    pub payment: Account<'info, RewardPayment>,
    /// CHECK: Verified against the current router authority.
    #[account(seeds=[SEED], bump)]
    pub legacy_router: UncheckedAccount<'info>,
}

pub fn close_payment(ctx: Context<CloseRewardPayment>) -> Result<()> {
    assert_current_router_authority(&ctx.accounts.legacy_router.to_account_info(), &ctx.accounts.authority.key(), ctx.program_id)
}
