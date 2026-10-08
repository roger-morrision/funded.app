use anchor_lang::prelude::*;
use crate::{constants::*, error::ErrorCode, state::{ClaimRecord, MintClaimRecord, MintFeeLedger}};
use super::rotate::assert_current_router_authority;

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

#[derive(Accounts)]
#[instruction(claim_id: [u8; 32])]
pub struct SettleMint<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    pub creator: Signer<'info>,
    pub mint: UncheckedAccount<'info>,
    /// CHECK: Verified against the signing authority and program ID before settlement.
    #[account(seeds = [SEED], bump)]
    pub legacy_router: UncheckedAccount<'info>,
    #[account(mut, seeds = [MINT_ROUTER_SEED, mint.key().as_ref()], bump)]
    pub router: UncheckedAccount<'info>,
    #[account(mut, seeds = [MINT_LEDGER_SEED, mint.key().as_ref()], bump = ledger.bump,
        constraint = ledger.mint == mint.key() && ledger.creator == creator.key() @ ErrorCode::InvalidMintFeeLedger)]
    pub ledger: Account<'info, MintFeeLedger>,
    #[account(init, payer = authority, space = 8 + MintClaimRecord::INIT_SPACE, seeds = [CLAIM_SEED, mint.key().as_ref(), claim_id.as_ref()], bump)]
    pub claim: Account<'info, MintClaimRecord>,
    pub system_program: Program<'info, System>,
}

pub fn mint_handler(ctx: Context<SettleMint>, claim_id: [u8; 32], amounts: Vec<u64>, share: u8) -> Result<()> {
    assert_current_router_authority(&ctx.accounts.legacy_router.to_account_info(), &ctx.accounts.authority.key(), ctx.program_id)?;
    require!(share <= 1, ErrorCode::InvalidFeeShare);
    let router = &ctx.accounts.router;
    require!(router.owner == ctx.program_id, ErrorCode::InvalidMintRouter);
    let data = router.try_borrow_data()?;
    require!(data.len() == MINT_ROUTER_DATA_LEN, ErrorCode::InvalidMintRouter);
    require!(&data[0..8] == MINT_ROUTER_MAGIC && data[8] == MINT_ROUTER_VERSION && data[9..41] == POLICY_HASH, ErrorCode::InvalidMintRouter);
    require!(&data[41..73] == ctx.accounts.authority.key.as_ref(), ErrorCode::InvalidMintRouter);
    require!(&data[73..105] == ctx.accounts.mint.key.as_ref() && data[105] == ctx.bumps.router, ErrorCode::InvalidMintRouter);
    drop(data);

    let destinations = ctx.remaining_accounts;
    require!(destinations.len() == 1 && amounts.len() == 1, ErrorCode::DestinationAmountMismatch);
    let mut total = 0u64;
    for (destination, amount) in destinations.iter().zip(amounts.iter()) {
        require!(*amount > 0, ErrorCode::InvalidAmount);
        require!(destination.is_writable && destination.key != router.key && destination.key != ctx.accounts.authority.key, ErrorCode::InvalidDestination);
        total = total.checked_add(*amount).ok_or(ErrorCode::AmountOverflow)?;
    }
    let minimum = Rent::get()?.minimum_balance(MINT_ROUTER_DATA_LEN);
    let available = router.lamports().saturating_sub(minimum);
    require!(total <= available, ErrorCode::InsufficientRouterBalance);
    let ledger = &mut ctx.accounts.ledger;
    let received = u128::from(available)
        .checked_add(u128::from(ledger.creator_spent)).and_then(|v| v.checked_add(u128::from(ledger.protocol_spent)))
        .ok_or(ErrorCode::AmountOverflow)?;
    let creator_limit = received.checked_mul(80).ok_or(ErrorCode::AmountOverflow)? / 100;
    let share_limit = if share == 0 { creator_limit } else { received - creator_limit };
    let spent = if share == 0 { &mut ledger.creator_spent } else { &mut ledger.protocol_spent };
    let new_spent = spent.checked_add(total).ok_or(ErrorCode::AmountOverflow)?;
    require!(u128::from(new_spent) <= share_limit, ErrorCode::FeeShareExceeded);
    *spent = new_spent;
    for (destination, amount) in destinations.iter().zip(amounts.iter()) {
        **router.try_borrow_mut_lamports()? -= amount;
        let balance = destination.lamports().checked_add(*amount).ok_or(ErrorCode::AmountOverflow)?;
        **destination.try_borrow_mut_lamports()? = balance;
    }
    let claim = &mut ctx.accounts.claim;
    claim.claim_id = claim_id;
    claim.mint = ctx.accounts.mint.key();
    claim.recipient = *destinations[0].key;
    claim.total_lamports = total;
    claim.created_at = Clock::get()?.unix_timestamp;
    claim.share = share;
    emit!(SettlementEvent { claim_id, total_lamports: total });
    Ok(())
}

pub fn handler(_ctx: Context<Settle>, _claim_id: [u8; 32], _amounts: Vec<u64>) -> Result<()> {
    err!(ErrorCode::LegacySettlementDisabled)
}

#[event]
pub struct SettlementEvent {
    pub claim_id: [u8; 32],
    pub total_lamports: u64,
}
