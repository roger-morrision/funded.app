use anchor_lang::prelude::*;
use anchor_lang::solana_program::system_instruction;
use crate::{constants::*, error::ErrorCode};

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(mut, seeds = [SEED], bump)]
    pub router: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<Initialize>) -> Result<()> {
    let router = &ctx.accounts.router;
    require!(router.data_is_empty() && router.lamports() == 0, ErrorCode::AlreadyInitialized);
    let bump = ctx.bumps.router;
    let rent = Rent::get()?.minimum_balance(ROUTER_DATA_LEN);
    let create = system_instruction::create_account(
        ctx.accounts.authority.key,
        router.key,
        rent,
        ROUTER_DATA_LEN as u64,
        ctx.program_id,
    );
    anchor_lang::solana_program::program::invoke_signed(
        &create,
        &[ctx.accounts.authority.to_account_info(), router.to_account_info(), ctx.accounts.system_program.to_account_info()],
        &[&[SEED, &[bump]]],
    )?;
    let mut data = router.try_borrow_mut_data()?;
    data[0..8].copy_from_slice(MAGIC);
    data[8] = VERSION;
    data[9..41].copy_from_slice(&POLICY_HASH);
    data[41..73].copy_from_slice(ctx.accounts.authority.key.as_ref());
    data[73] = bump;
    Ok(())
}

#[derive(Accounts)]
pub struct InitializeMint<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    pub mint: Signer<'info>,
    #[account(seeds = [SEED], bump)]
    pub legacy_router: UncheckedAccount<'info>,
    #[account(mut, seeds = [MINT_ROUTER_SEED, mint.key().as_ref()], bump)]
    pub router: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

pub fn mint_handler(ctx: Context<InitializeMint>) -> Result<()> {
    let legacy = ctx.accounts.legacy_router.try_borrow_data()?;
    require!(legacy.len() == ROUTER_DATA_LEN, ErrorCode::InvalidRouterHeader);
    require!(&legacy[0..8] == MAGIC && legacy[8] == VERSION && legacy[9..41] == POLICY_HASH, ErrorCode::InvalidRouterHeader);
    let authority = legacy[41..73].to_vec();
    drop(legacy);

    let router = &ctx.accounts.router;
    require!(router.data_is_empty() && router.lamports() == 0, ErrorCode::AlreadyInitialized);
    let bump = ctx.bumps.router;
    let rent = Rent::get()?.minimum_balance(MINT_ROUTER_DATA_LEN);
    let mint_key = ctx.accounts.mint.key();
    let create = system_instruction::create_account(
        ctx.accounts.payer.key,
        router.key,
        rent,
        MINT_ROUTER_DATA_LEN as u64,
        ctx.program_id,
    );
    anchor_lang::solana_program::program::invoke_signed(
        &create,
        &[ctx.accounts.payer.to_account_info(), router.to_account_info(), ctx.accounts.system_program.to_account_info()],
        &[&[MINT_ROUTER_SEED, mint_key.as_ref(), &[bump]]],
    )?;
    let mut data = router.try_borrow_mut_data()?;
    data[0..8].copy_from_slice(MINT_ROUTER_MAGIC);
    data[8] = MINT_ROUTER_VERSION;
    data[9..41].copy_from_slice(&POLICY_HASH);
    data[41..73].copy_from_slice(&authority);
    data[73..105].copy_from_slice(mint_key.as_ref());
    data[105] = bump;
    Ok(())
}
