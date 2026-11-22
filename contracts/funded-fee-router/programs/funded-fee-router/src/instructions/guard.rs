// Protocol guard (Mainnet build only).
//
// The router authority is a hot operator key used by automated workers. On
// Mainnet its power is bounded by a guard stored after the 74-byte router
// header:
// - a guardian key (a separate key kept off the server) can pause every
//   authority-driven action and cancel unpaid reward cycles;
// - only the program upgrade owner (the wallet that can replace the program
//   anyway) can unpause, change the guardian or change the daily cap;
// - external SOL outflows and new SOL reward commitments share a daily cap,
//   which is zero (nothing may leave) until the upgrade owner configures it.
//
// The module is compiled only into the Mainnet build, so Devnet and legacy
// bytecode, account layouts and callers are unchanged.
use anchor_lang::prelude::*;
use crate::{constants::*, error::ErrorCode};

use crate::state::{RewardCycle, RewardReserve};
use super::rotate::assert_upgrade_owner;

const SECONDS_PER_DAY: i64 = 24 * 60 * 60;

// Separate code range so the shared ErrorCode enum (6000+) and the Devnet
// bytecode stay unchanged.
#[error_code(offset = 6100)]
pub enum GuardError {
    #[msg("Protocol outflows are paused by the guardian")]
    ProtocolPaused,
    #[msg("This outflow would exceed the protocol's daily outflow cap")]
    DailyOutflowCapExceeded,
    #[msg("The guardian signer or guard configuration is invalid")]
    InvalidGuardian,
    #[msg("A new reward cycle must leave the minimum review delay before payout")]
    RewardCycleDelayTooShort,
}

fn read_u64(data: &[u8], offset: usize) -> u64 {
    let mut raw = [0u8; 8];
    raw.copy_from_slice(&data[offset..offset + 8]);
    u64::from_le_bytes(raw)
}

/// Rejects authority-driven actions while the protocol is paused. The caller
/// has already validated the header layout.
pub(crate) fn assert_not_paused(data: &[u8]) -> Result<()> {
    require!(data[GUARD_PAUSED] == 0, GuardError::ProtocolPaused);
    Ok(())
}

/// Counts an external SOL outflow or a new SOL reward commitment against the
/// shared daily cap. A reservation does not exempt a later payout: both consume
/// their respective UTC day's budget. The caller has
/// already validated the router header through assert_current_router_authority;
/// the header must be passed writable on Mainnet.
pub(crate) fn record_outflow(router: &AccountInfo, amount: u64) -> Result<()> {
    require!(router.is_writable, ErrorCode::InvalidRouterHeader);
    let mut data = router.try_borrow_mut_data()?;
    require!(data.len() == ROUTER_DATA_LEN, ErrorCode::InvalidRouterHeader);
    assert_not_paused(&data)?;
    let day = Clock::get()?.unix_timestamp.div_euclid(SECONDS_PER_DAY);
    let cap = read_u64(&data, GUARD_DAILY_CAP);
    let stored_day = read_u64(&data, GUARD_WINDOW_DAY) as i64;
    let spent = if stored_day == day { read_u64(&data, GUARD_WINDOW_SPENT) } else { 0 };
    let next = spent.checked_add(amount).ok_or(ErrorCode::AmountOverflow)?;
    require!(next <= cap, GuardError::DailyOutflowCapExceeded);
    data[GUARD_WINDOW_DAY..GUARD_WINDOW_DAY + 8].copy_from_slice(&day.to_le_bytes());
    data[GUARD_WINDOW_SPENT..GUARD_WINDOW_SPENT + 8].copy_from_slice(&next.to_le_bytes());
    Ok(())
}

/// Permissionless payouts must still obey the canonical protocol guard.
/// A trailing account keeps the legacy and Devnet account ABI unchanged.
pub(crate) fn check_reward_payout(program_id: &Pubkey, remaining: &[AccountInfo],
    sol_amount: Option<u64>) -> Result<()> {
    require!(remaining.len() == 1, ErrorCode::InvalidRouterHeader);
    let router = &remaining[0];
    header_guardian(router, program_id)?;
    assert_not_paused(&router.try_borrow_data()?)?;
    if let Some(amount) = sol_amount {
        record_outflow(router, amount)?;
    }
    Ok(())
}

/// A new reward cycle cannot pay before the guardian has had time to review
/// and, if needed, cancel it.
pub(crate) fn assert_review_delay(payout_at: i64) -> Result<()> {
    let earliest = Clock::get()?.unix_timestamp.checked_add(REWARD_CYCLE_MIN_DELAY_SECONDS)
        .ok_or(ErrorCode::AmountOverflow)?;
    require!(payout_at >= earliest, GuardError::RewardCycleDelayTooShort);
    Ok(())
}

/// Mainnet token conversions need the independent price signer, like buybacks.
/// The caller appends [price config PDA, price signer] after the swap accounts;
/// this checks them and returns the swap accounts alone.
pub(crate) fn split_price_signer<'a, 'info>(program_id: &Pubkey, remaining: &'a [AccountInfo<'info>],
    authority: &Pubkey) -> Result<&'a [AccountInfo<'info>]> {
    require!(remaining.len() >= 2, ErrorCode::InvalidMintBuybackV3);
    let (swap, price) = remaining.split_at(remaining.len() - 2);
    let (config, signer) = (&price[0], &price[1]);
    let (expected, _) = Pubkey::find_program_address(&[super::buyback_price::PRICE_SIGNER_SEED], program_id);
    require!(config.key() == expected && config.owner == program_id, ErrorCode::InvalidMintBuybackV3);
    let saved = super::buyback_price::BuybackPriceConfig::try_deserialize(&mut &config.try_borrow_data()?[..])?;
    require!(signer.is_signer && signer.key() == saved.price_signer && signer.key() != *authority,
        ErrorCode::InvalidRotationAuthority);
    Ok(swap)
}

fn header_guardian(router: &AccountInfo, program_id: &Pubkey) -> Result<Pubkey> {
    require!(router.owner == program_id, ErrorCode::InvalidRouterHeader);
    let data = router.try_borrow_data()?;
    require!(data.len() == ROUTER_DATA_LEN && &data[0..8] == MAGIC && data[8] == VERSION
        && data[9..41] == POLICY_HASH, ErrorCode::InvalidRouterHeader);
    let (expected, bump) = Pubkey::find_program_address(&[SEED], program_id);
    require!(router.key() == expected && data[73] == bump, ErrorCode::InvalidRouterHeader);
    let mut key = [0u8; 32];
    key.copy_from_slice(&data[GUARD_GUARDIAN..GUARD_GUARDIAN + 32]);
    Ok(Pubkey::new_from_array(key))
}

fn authority_of(router: &AccountInfo) -> Result<Pubkey> {
    let data = router.try_borrow_data()?;
    let mut key = [0u8; 32];
    key.copy_from_slice(&data[41..73]);
    Ok(Pubkey::new_from_array(key))
}

#[derive(Accounts)]
pub struct ConfigureGuard<'info> {
    pub upgrade_owner: Signer<'info>,
    /// CHECK: Only its address is stored; it must differ from the hot authority.
    pub guardian: UncheckedAccount<'info>,
    /// CHECK: Router header layout and PDA are verified in the handler.
    #[account(mut, seeds = [SEED], bump)]
    pub legacy_router: UncheckedAccount<'info>,
    /// CHECK: Bound to this program by assert_upgrade_owner.
    pub program: UncheckedAccount<'info>,
    /// CHECK: The upgrade owner must match the loader's current authority.
    pub program_data: UncheckedAccount<'info>,
}

pub fn configure(ctx: Context<ConfigureGuard>, daily_cap_lamports: u64) -> Result<()> {
    assert_upgrade_owner(&ctx.accounts.program, &ctx.accounts.program_data,
        &ctx.accounts.upgrade_owner.key(), ctx.program_id)?;
    let router = ctx.accounts.legacy_router.to_account_info();
    header_guardian(&router, ctx.program_id)?;
    let guardian = ctx.accounts.guardian.key();
    require!(guardian != Pubkey::default() && guardian != authority_of(&router)?, GuardError::InvalidGuardian);
    let mut data = router.try_borrow_mut_data()?;
    data[GUARD_GUARDIAN..GUARD_GUARDIAN + 32].copy_from_slice(guardian.as_ref());
    data[GUARD_DAILY_CAP..GUARD_DAILY_CAP + 8].copy_from_slice(&daily_cap_lamports.to_le_bytes());
    emit!(ProtocolGuardConfigured { guardian, daily_cap_lamports });
    Ok(())
}

#[derive(Accounts)]
pub struct SetProtocolPause<'info> {
    pub signer: Signer<'info>,
    /// CHECK: Router header layout and PDA are verified in the handler.
    #[account(mut, seeds = [SEED], bump)]
    pub legacy_router: UncheckedAccount<'info>,
    /// CHECK: Checked by assert_upgrade_owner when the signer is not the guardian.
    pub program: UncheckedAccount<'info>,
    /// CHECK: Checked by assert_upgrade_owner when the signer is not the guardian.
    pub program_data: UncheckedAccount<'info>,
}

/// The guardian may only pause. Unpausing needs the upgrade owner.
pub fn set_pause(ctx: Context<SetProtocolPause>, paused: bool) -> Result<()> {
    let router = ctx.accounts.legacy_router.to_account_info();
    let guardian = header_guardian(&router, ctx.program_id)?;
    let signer = ctx.accounts.signer.key();
    if !(paused && guardian != Pubkey::default() && signer == guardian) {
        assert_upgrade_owner(&ctx.accounts.program, &ctx.accounts.program_data, &signer, ctx.program_id)?;
    }
    router.try_borrow_mut_data()?[GUARD_PAUSED] = u8::from(paused);
    emit!(ProtocolPauseChanged { paused, signer });
    Ok(())
}

#[derive(Accounts)]
pub struct CancelRewardCycle<'info> {
    pub signer: Signer<'info>,
    /// CHECK: Router header layout and PDA are verified in the handler.
    #[account(seeds = [SEED], bump)]
    pub legacy_router: UncheckedAccount<'info>,
    /// CHECK: Checked by assert_upgrade_owner when the signer is not the guardian.
    pub program: UncheckedAccount<'info>,
    /// CHECK: Checked by assert_upgrade_owner when the signer is not the guardian.
    pub program_data: UncheckedAccount<'info>,
    #[account(mut, seeds = [REWARD_RESERVE_SEED, cycle.vault.as_ref(), cycle.asset_mint.as_ref()], bump = reserve.bump,
        constraint = reserve.vault == cycle.vault && reserve.asset_mint == cycle.asset_mint @ ErrorCode::InvalidRewardAsset)]
    pub reserve: Account<'info, RewardReserve>,
    #[account(mut, seeds = [REWARD_CYCLE_SEED, cycle.vault.as_ref(), cycle.cycle_id.as_ref()], bump = cycle.bump)]
    pub cycle: Account<'info, RewardCycle>,
}

/// Stops every later payout of a reserved cycle. Funds never move: the unpaid
/// commitment returns to the reward vault for later cycles.
pub fn cancel_reward_cycle(ctx: Context<CancelRewardCycle>) -> Result<()> {
    let guardian = header_guardian(&ctx.accounts.legacy_router.to_account_info(), ctx.program_id)?;
    let signer = ctx.accounts.signer.key();
    if !(guardian != Pubkey::default() && signer == guardian) {
        assert_upgrade_owner(&ctx.accounts.program, &ctx.accounts.program_data, &signer, ctx.program_id)?;
    }
    let cycle = &mut ctx.accounts.cycle;
    require!(cycle.reserved, ErrorCode::RewardCycleNotExpirable);
    let unpaid = cycle.total_amount.checked_sub(cycle.distributed_amount).ok_or(ErrorCode::RewardTotalExceeded)?;
    ctx.accounts.reserve.outstanding = ctx.accounts.reserve.outstanding.checked_sub(unpaid)
        .ok_or(ErrorCode::RewardReserveExceeded)?;
    cycle.reserved = false;
    emit!(RewardCycleCancelled { cycle: cycle.key(), asset_mint: cycle.asset_mint, unpaid_amount: unpaid, signer });
    Ok(())
}

#[event]
pub struct ProtocolGuardConfigured {
    pub guardian: Pubkey,
    pub daily_cap_lamports: u64,
}

#[event]
pub struct ProtocolPauseChanged {
    pub paused: bool,
    pub signer: Pubkey,
}

#[event]
pub struct RewardCycleCancelled {
    pub cycle: Pubkey,
    pub asset_mint: Pubkey,
    pub unpaid_amount: u64,
    pub signer: Pubkey,
}
