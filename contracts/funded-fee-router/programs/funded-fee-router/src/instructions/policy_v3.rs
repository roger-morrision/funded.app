use anchor_lang::prelude::*;
use crate::{constants::*, error::ErrorCode, state::{MintClaimRecordV3, MintFeePolicyV3}};
use super::{initialize::create_router_account, rotate::assert_current_router_authority};

const CREATOR_UNITS: u32 = 8_000_000;
const TOTAL_UNITS: u32 = 10_000_000;
const VAULT_COUNT: usize = 7;

/// The first bucket is creator-directed. The remaining six are operations,
/// referral levels 1-3, community, and buyback, in that order. Cumulative
/// rounding makes the allocation exact across repeated small deposits.
pub fn category_targets(total: u64, protocol_units: [u32; 6]) -> Result<[u64; VAULT_COUNT]> {
    let mut cumulative = CREATOR_UNITS;
    let mut targets = [0u64; VAULT_COUNT];
    let creator_target = u128::from(total) * u128::from(cumulative) / u128::from(TOTAL_UNITS);
    targets[0] = u64::try_from(creator_target).map_err(|_| ErrorCode::AmountOverflow)?;
    let mut previous = targets[0];
    for (index, units) in protocol_units.iter().enumerate() {
        cumulative = cumulative.checked_add(*units).ok_or(ErrorCode::InvalidProtocolFeeRates)?;
        require!(cumulative <= TOTAL_UNITS, ErrorCode::InvalidProtocolFeeRates);
        let boundary = u64::try_from(u128::from(total) * u128::from(cumulative) / u128::from(TOTAL_UNITS))
            .map_err(|_| ErrorCode::AmountOverflow)?;
        targets[index + 1] = boundary.checked_sub(previous).ok_or(ErrorCode::AmountOverflow)?;
        previous = boundary;
    }
    require!(cumulative == TOTAL_UNITS, ErrorCode::InvalidProtocolFeeRates);
    Ok(targets)
}

#[derive(Accounts)]
pub struct InitializeMintV3<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(mut)]
    pub creator: Signer<'info>,
    pub mint: Signer<'info>,
    #[account(seeds = [SEED], bump)]
    pub legacy_router: UncheckedAccount<'info>,
    #[account(mut, seeds = [MINT_ROUTER_V3_SEED, mint.key().as_ref()], bump)]
    pub router: UncheckedAccount<'info>,
    #[account(init, payer = creator, space = 8 + MintFeePolicyV3::INIT_SPACE,
        seeds = [MINT_POLICY_V3_SEED, mint.key().as_ref()], bump)]
    pub policy: Account<'info, MintFeePolicyV3>,
    pub system_program: Program<'info, System>,
}

pub fn initialize_mint_v3_handler(ctx: Context<InitializeMintV3>, protocol_units: [u32; 6]) -> Result<()> {
    assert_current_router_authority(&ctx.accounts.legacy_router.to_account_info(), &ctx.accounts.authority.key(), ctx.program_id)?;
    // Validate rates before creating either account. The creator share is
    // fixed at 80%; config may only redistribute the remaining 20%.
    category_targets(10_000_000, protocol_units)?;
    let router = &ctx.accounts.router;
    let mint = ctx.accounts.mint.key();
    let bump = ctx.bumps.router;
    create_router_account(ctx.accounts.creator.to_account_info(), router.to_account_info(),
        ctx.accounts.system_program.to_account_info(), ctx.program_id, MINT_ROUTER_DATA_LEN,
        &[MINT_ROUTER_V3_SEED, mint.as_ref(), &[bump]])?;
    let mut data = router.try_borrow_mut_data()?;
    data[0..8].copy_from_slice(MINT_ROUTER_V3_MAGIC);
    data[8] = MINT_ROUTER_V3_VERSION;
    data[9..41].copy_from_slice(&POLICY_HASH);
    data[41..73].copy_from_slice(ctx.accounts.authority.key.as_ref());
    data[73..105].copy_from_slice(mint.as_ref());
    data[105] = bump;
    let policy = &mut ctx.accounts.policy;
    policy.mint = mint;
    policy.creator = ctx.accounts.creator.key();
    policy.authority = ctx.accounts.authority.key();
    policy.protocol_units = protocol_units;
    policy.settled_lamports = 0;
    policy.paid_lamports = [0; VAULT_COUNT];
    policy.bump = ctx.bumps.policy;
    Ok(())
}

#[derive(Accounts)]
#[instruction(claim_id: [u8; 32])]
pub struct SettleMintV3<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    pub creator: Signer<'info>,
    pub mint: UncheckedAccount<'info>,
    #[account(seeds = [SEED], bump)]
    pub legacy_router: UncheckedAccount<'info>,
    #[account(mut, seeds = [MINT_ROUTER_V3_SEED, mint.key().as_ref()], bump)]
    pub router: UncheckedAccount<'info>,
    #[account(mut, seeds = [MINT_POLICY_V3_SEED, mint.key().as_ref()], bump = policy.bump,
        constraint = policy.mint == mint.key() && policy.creator == creator.key()
            @ ErrorCode::InvalidMintFeePolicyV3)]
    pub policy: Account<'info, MintFeePolicyV3>,
    #[account(init, payer = authority, space = 8 + MintClaimRecordV3::INIT_SPACE,
        seeds = [MINT_CLAIM_V3_SEED, mint.key().as_ref(), claim_id.as_ref()], bump)]
    pub claim: Account<'info, MintClaimRecordV3>,
    pub system_program: Program<'info, System>,
}

pub fn settle_mint_v3_handler(ctx: Context<SettleMintV3>, claim_id: [u8; 32]) -> Result<()> {
    assert_current_router_authority(&ctx.accounts.legacy_router.to_account_info(), &ctx.accounts.authority.key(), ctx.program_id)?;
    let router = &ctx.accounts.router;
    require!(router.owner == ctx.program_id, ErrorCode::InvalidMintRouter);
    let data = router.try_borrow_data()?;
    require!(data.len() == MINT_ROUTER_DATA_LEN && &data[0..8] == MINT_ROUTER_V3_MAGIC
        && data[8] == MINT_ROUTER_V3_VERSION && data[9..41] == POLICY_HASH
        && data[41..73] == ctx.accounts.policy.authority.to_bytes()
        && data[73..105] == ctx.accounts.mint.key().to_bytes()
        && data[105] == ctx.bumps.router, ErrorCode::InvalidMintRouter);
    drop(data);

    let vaults = ctx.remaining_accounts;
    require!(vaults.len() == VAULT_COUNT, ErrorCode::InvalidMintFeeVaultV3);
    for (index, vault) in vaults.iter().enumerate() {
        let category = [index as u8];
        let (expected, _) = Pubkey::find_program_address(
            &[MINT_VAULT_V3_SEED, ctx.accounts.mint.key.as_ref(), &category], ctx.program_id);
        require!(vault.key() == expected && vault.is_writable && vault.owner == &System::id()
            && vault.data_is_empty(), ErrorCode::InvalidMintFeeVaultV3);
    }

    let minimum = Rent::get()?.minimum_balance(MINT_ROUTER_DATA_LEN);
    let amount = router.lamports().checked_sub(minimum).ok_or(ErrorCode::InsufficientRouterBalance)?;
    require!(amount > 0, ErrorCode::InvalidAmount);
    let policy = &mut ctx.accounts.policy;
    let new_total = policy.settled_lamports.checked_add(amount).ok_or(ErrorCode::AmountOverflow)?;
    let targets = category_targets(new_total, policy.protocol_units)?;
    let mut paid = [0u64; VAULT_COUNT];
    for (index, vault) in vaults.iter().enumerate() {
        let allocation = targets[index].checked_sub(policy.paid_lamports[index]).ok_or(ErrorCode::AmountOverflow)?;
        if allocation > 0 {
            let router_balance = router.lamports().checked_sub(allocation).ok_or(ErrorCode::AmountOverflow)?;
            let vault_balance = vault.lamports().checked_add(allocation).ok_or(ErrorCode::AmountOverflow)?;
            **router.try_borrow_mut_lamports()? = router_balance;
            **vault.try_borrow_mut_lamports()? = vault_balance;
        }
        policy.paid_lamports[index] = targets[index];
        paid[index] = allocation;
    }
    policy.settled_lamports = new_total;
    let claim = &mut ctx.accounts.claim;
    claim.claim_id = claim_id;
    claim.mint = ctx.accounts.mint.key();
    claim.total_lamports = amount;
    claim.category_lamports = paid;
    claim.created_at = Clock::get()?.unix_timestamp;
    emit!(SettlementV3Event { mint: claim.mint, claim_id, total_lamports: amount, category_lamports: paid });
    Ok(())
}

#[event]
pub struct SettlementV3Event {
    pub mint: Pubkey,
    pub claim_id: [u8; 32],
    pub total_lamports: u64,
    pub category_lamports: [u64; VAULT_COUNT],
}
