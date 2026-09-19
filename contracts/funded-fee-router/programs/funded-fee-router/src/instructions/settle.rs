use anchor_lang::prelude::*;
use crate::{constants::*, error::ErrorCode, state::ClaimRecord};

#[derive(Accounts)]
#[instruction(claim_id: [u8; 32])]
pub struct Settle<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(mut, seeds = [SEED], bump)]
    pub router: UncheckedAccount<'info>,
    #[account(init, payer = authority, space = 8 + ClaimRecord::INIT_SPACE, seeds = [CLAIM_SEED, claim_id.as_ref()], bump)]
    pub claim: Account<'info, ClaimRecord>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<Settle>, claim_id: [u8; 32], amounts: Vec<u64>) -> Result<()> {
    let router = &ctx.accounts.router;
    let data = router.try_borrow_data()?;
    require!(data.len() == ROUTER_DATA_LEN, ErrorCode::InvalidRouterHeader);
    require!(&data[0..8] == MAGIC && data[8] == VERSION && data[9..41] == POLICY_HASH, ErrorCode::InvalidRouterHeader);
    require!(&data[41..73] == ctx.accounts.authority.key.as_ref(), ErrorCode::InvalidRouterHeader);
    drop(data);

    let destinations = ctx.remaining_accounts;
    require!(destinations.len() == amounts.len(), ErrorCode::DestinationAmountMismatch);
    let mut total = 0u64;
    for amount in &amounts {
        require!(*amount > 0, ErrorCode::InvalidAmount);
        total = total.checked_add(*amount).ok_or(ErrorCode::AmountOverflow)?;
    }
    let minimum = Rent::get()?.minimum_balance(ROUTER_DATA_LEN);
    let available = router.lamports().saturating_sub(minimum);
    require!(total <= available, ErrorCode::InsufficientRouterBalance);

    for (destination, amount) in destinations.iter().zip(amounts.iter()) {
        **router.try_borrow_mut_lamports()? -= amount;
        **destination.try_borrow_mut_lamports()? += amount;
    }
    let claim = &mut ctx.accounts.claim;
    claim.claim_id = claim_id;
    claim.total_lamports = total;
    claim.created_at = Clock::get()?.unix_timestamp;
    emit!(SettlementEvent { claim_id, total_lamports: total });
    Ok(())
}

#[event]
pub struct SettlementEvent {
    pub claim_id: [u8; 32],
    pub total_lamports: u64,
}
