use anchor_lang::prelude::*;
use anchor_spl::associated_token::get_associated_token_address_with_program_id;
use anchor_spl::token::{self, CloseAccount, Token, TokenAccount};
use anchor_spl::token::spl_token::native_mint;
use crate::{constants::*, error::ErrorCode};

#[derive(Accounts)]
pub struct RecoverMintWrappedSol<'info> {
    pub authority: Signer<'info>,
    /// CHECK: Used only as the immutable seed in the verified mint router.
    pub mint: UncheckedAccount<'info>,
    /// CHECK: Header, authority, mint and PDA are verified by the handler.
    #[account(mut, seeds = [MINT_ROUTER_SEED, mint.key().as_ref()], bump)]
    pub router: UncheckedAccount<'info>,
    #[account(mut)]
    pub wrapped_sol: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

pub fn handler(ctx: Context<RecoverMintWrappedSol>) -> Result<()> {
    let router = &ctx.accounts.router;
    require!(router.owner == ctx.program_id, ErrorCode::InvalidMintRouter);
    let data = router.try_borrow_data()?;
    require!(data.len() == MINT_ROUTER_DATA_LEN && &data[0..8] == MINT_ROUTER_MAGIC
        && data[8] == MINT_ROUTER_VERSION && data[9..41] == POLICY_HASH
        && &data[41..73] == ctx.accounts.authority.key.as_ref()
        && &data[73..105] == ctx.accounts.mint.key.as_ref()
        && data[105] == ctx.bumps.router, ErrorCode::InvalidMintRouter);
    drop(data);

    let expected = get_associated_token_address_with_program_id(
        &router.key(), &native_mint::id(), &ctx.accounts.token_program.key());
    require_keys_eq!(ctx.accounts.wrapped_sol.key(), expected, ErrorCode::InvalidWrappedSolAccount);
    require_keys_eq!(ctx.accounts.wrapped_sol.owner, router.key(), ErrorCode::InvalidWrappedSolAccount);
    require_keys_eq!(ctx.accounts.wrapped_sol.mint, native_mint::id(), ErrorCode::InvalidWrappedSolAccount);
    require!(ctx.accounts.wrapped_sol.is_native.is_some() && ctx.accounts.wrapped_sol.amount > 0,
        ErrorCode::InvalidWrappedSolAccount);

    let amount = ctx.accounts.wrapped_sol.amount;
    let rent_refund = ctx.accounts.wrapped_sol.to_account_info().lamports().saturating_sub(amount);
    let mint_key = ctx.accounts.mint.key();
    let bump = [ctx.bumps.router];
    let seeds: &[&[u8]] = &[MINT_ROUTER_SEED, mint_key.as_ref(), &bump];
    token::close_account(CpiContext::new_with_signer(
        ctx.accounts.token_program.key(),
        CloseAccount { account:ctx.accounts.wrapped_sol.to_account_info(),
            destination:router.to_account_info(), authority:router.to_account_info() },
        &[seeds],
    ))?;
    emit!(WrappedSolRecovered { mint:mint_key, router:router.key(), amount, rent_refund });
    Ok(())
}

#[event]
pub struct WrappedSolRecovered {
    pub mint: Pubkey,
    pub router: Pubkey,
    pub amount: u64,
    pub rent_refund: u64,
}
