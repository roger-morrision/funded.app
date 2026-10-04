use anchor_lang::prelude::*;
use anchor_lang::solana_program::system_instruction;
use crate::{constants::*, error::ErrorCode};

// An empty system-owned PDA may already hold a third-party deposit. Funding it
// must not prevent initialization, and those lamports must remain in the vault.
fn create_router_account<'info>(
    payer: AccountInfo<'info>,
    router: AccountInfo<'info>,
    system_program: AccountInfo<'info>,
    program_id: &Pubkey,
    data_len: usize,
    seeds: &[&[u8]],
) -> Result<()> {
    require!(router.data_is_empty() && router.owner == &System::id(), ErrorCode::AlreadyInitialized);
    let rent = Rent::get()?.minimum_balance(data_len);
    if router.lamports() == 0 {
        return anchor_lang::solana_program::program::invoke_signed(
            &system_instruction::create_account(payer.key, router.key, rent, data_len as u64, program_id),
            &[payer, router, system_program],
            &[seeds],
        ).map_err(Into::into);
    }
    let top_up = rent.saturating_sub(router.lamports());
    if top_up > 0 {
        anchor_lang::solana_program::program::invoke(
            &system_instruction::transfer(payer.key, router.key, top_up),
            &[payer, router.clone(), system_program.clone()],
        )?;
    }
    anchor_lang::solana_program::program::invoke_signed(
        &system_instruction::allocate(router.key, data_len as u64),
        &[router.clone(), system_program.clone()],
        &[seeds],
    )?;
    anchor_lang::solana_program::program::invoke_signed(
        &system_instruction::assign(router.key, program_id),
        &[router, system_program],
        &[seeds],
    )?;
    Ok(())
}

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
    let bump = ctx.bumps.router;
    create_router_account(
        ctx.accounts.authority.to_account_info(), router.to_account_info(),
        ctx.accounts.system_program.to_account_info(), ctx.program_id,
        ROUTER_DATA_LEN, &[SEED, &[bump]],
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
    require!(ctx.accounts.legacy_router.owner == ctx.program_id, ErrorCode::InvalidRouterHeader);
    let legacy = ctx.accounts.legacy_router.try_borrow_data()?;
    require!(legacy.len() == ROUTER_DATA_LEN, ErrorCode::InvalidRouterHeader);
    require!(&legacy[0..8] == MAGIC && legacy[8] == VERSION && legacy[9..41] == POLICY_HASH, ErrorCode::InvalidRouterHeader);
    require!(legacy[73] == ctx.bumps.legacy_router, ErrorCode::InvalidRouterHeader);
    let authority = legacy[41..73].to_vec();
    drop(legacy);

    let router = &ctx.accounts.router;
    let bump = ctx.bumps.router;
    let mint_key = ctx.accounts.mint.key();
    create_router_account(
        ctx.accounts.payer.to_account_info(), router.to_account_info(),
        ctx.accounts.system_program.to_account_info(), ctx.program_id,
        MINT_ROUTER_DATA_LEN, &[MINT_ROUTER_SEED, mint_key.as_ref(), &[bump]],
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
