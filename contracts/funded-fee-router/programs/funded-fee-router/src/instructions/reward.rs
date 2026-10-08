use anchor_lang::prelude::*;
use anchor_lang::solana_program::{program::invoke, system_instruction};
use anchor_spl::token_interface::{self, Mint, TokenAccount, TokenInterface, TransferChecked};
use anchor_spl::associated_token::get_associated_token_address_with_program_id;
use solana_sha256_hasher::hashv;
use crate::{constants::*, error::ErrorCode, state::{RewardCycle, RewardPayment, RewardReserve, RewardVault}};
use super::rotate::assert_current_router_authority;

#[derive(Accounts)]
pub struct InitializeRewardVault<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    pub mint: UncheckedAccount<'info>,
    #[account(
        init,
        payer = authority,
        space = 8 + RewardVault::INIT_SPACE,
        seeds = [REWARD_VAULT_SEED, authority.key().as_ref(), mint.key().as_ref()],
        bump
    )]
    pub vault: Account<'info, RewardVault>,
    /// CHECK: Validated against the current router header before creating a vault.
    #[account(seeds = [SEED], bump)]
    pub legacy_router: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

pub fn initialize_vault(ctx: Context<InitializeRewardVault>) -> Result<()> {
    assert_current_router_authority(&ctx.accounts.legacy_router.to_account_info(), &ctx.accounts.authority.key(), ctx.program_id)?;
    let vault = &mut ctx.accounts.vault;
    vault.authority = ctx.accounts.authority.key();
    vault.mint = ctx.accounts.mint.key();
    vault.bump = ctx.bumps.vault;
    Ok(())
}

#[derive(Accounts)]
#[instruction(asset_mint: Pubkey)]
pub struct InitializeRewardReserve<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(seeds = [REWARD_VAULT_SEED, authority.key().as_ref(), vault.mint.as_ref()], bump = vault.bump, has_one = authority)]
    pub vault: Account<'info, RewardVault>,
    #[account(init, payer = authority, space = 8 + RewardReserve::INIT_SPACE,
        seeds = [REWARD_RESERVE_SEED, vault.key().as_ref(), asset_mint.as_ref()], bump)]
    pub reserve: Account<'info, RewardReserve>,
    /// CHECK: Validated against the current router authority.
    #[account(seeds = [SEED], bump)]
    pub legacy_router: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

pub fn initialize_reserve(ctx: Context<InitializeRewardReserve>, asset_mint: Pubkey) -> Result<()> {
    assert_current_router_authority(&ctx.accounts.legacy_router.to_account_info(), &ctx.accounts.authority.key(), ctx.program_id)?;
    let reserve = &mut ctx.accounts.reserve;
    reserve.vault = ctx.accounts.vault.key();
    reserve.asset_mint = asset_mint;
    reserve.outstanding = 0;
    reserve.bump = ctx.bumps.reserve;
    Ok(())
}

#[derive(Accounts)]
#[instruction(cycle_id: [u8; 32])]
pub struct MigrateRewardCycleSol<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(seeds = [REWARD_VAULT_SEED, authority.key().as_ref(), vault.mint.as_ref()], bump = vault.bump, has_one = authority)]
    pub vault: Account<'info, RewardVault>,
    #[account(mut, seeds = [REWARD_RESERVE_SEED, vault.key().as_ref(), Pubkey::default().as_ref()], bump = reserve.bump,
        constraint = reserve.vault == vault.key() && reserve.asset_mint == Pubkey::default() @ ErrorCode::InvalidRewardAsset)]
    pub reserve: Account<'info, RewardReserve>,
    /// CHECK: Legacy layout, address, owner, fields, and rent are verified in the handler.
    #[account(mut, seeds = [REWARD_CYCLE_SEED, vault.key().as_ref(), cycle_id.as_ref()], bump)]
    pub cycle: UncheckedAccount<'info>,
    /// CHECK: Validated against the current router authority.
    #[account(seeds = [SEED], bump)]
    pub legacy_router: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(cycle_id: [u8; 32])]
pub struct MigrateRewardCycleToken<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(seeds = [REWARD_VAULT_SEED, authority.key().as_ref(), vault.mint.as_ref()], bump = vault.bump, has_one = authority)]
    pub vault: Account<'info, RewardVault>,
    #[account(mut, seeds = [REWARD_RESERVE_SEED, vault.key().as_ref(), token_mint.key().as_ref()], bump = reserve.bump,
        constraint = reserve.vault == vault.key() && reserve.asset_mint == token_mint.key() @ ErrorCode::InvalidRewardAsset)]
    pub reserve: Account<'info, RewardReserve>,
    /// CHECK: Legacy layout, address, owner, fields, and rent are verified in the handler.
    #[account(mut, seeds = [REWARD_CYCLE_SEED, vault.key().as_ref(), cycle_id.as_ref()], bump)]
    pub cycle: UncheckedAccount<'info>,
    pub token_mint: InterfaceAccount<'info, Mint>,
    #[account(constraint = vault_token_account.owner == vault.key() && vault_token_account.mint == token_mint.key()
        && vault_token_account.key() == get_associated_token_address_with_program_id(&vault.key(), &token_mint.key(), token_mint.to_account_info().owner)
        @ ErrorCode::InvalidRewardTokenAccount)]
    pub vault_token_account: InterfaceAccount<'info, TokenAccount>,
    /// CHECK: Validated against the current router authority.
    #[account(seeds = [SEED], bump)]
    pub legacy_router: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

fn migrate_legacy_cycle<'info>(cycle: &UncheckedAccount<'info>, payer: &Signer<'info>, system_program: &Program<'info, System>,
    vault: Pubkey, asset_mint: Pubkey, cycle_id: [u8; 32], bump: u8, available: u64,
    reserve: &mut Account<'info, RewardReserve>, program_id: &Pubkey) -> Result<()> {
    require!(cycle.owner == program_id, ErrorCode::InvalidRewardAsset);
    let data = cycle.try_borrow_data()?;
    require!(data.len() == 173 && &data[0..8] == RewardCycle::DISCRIMINATOR
        && data[8..40] == vault.to_bytes() && data[40..72] == cycle_id
        && data[104..136] == asset_mint.to_bytes() && data[172] == bump, ErrorCode::InvalidRewardAsset);
    let total = u64::from_le_bytes(data[136..144].try_into().map_err(|_| error!(ErrorCode::InvalidRewardAsset))?);
    let distributed = u64::from_le_bytes(data[144..152].try_into().map_err(|_| error!(ErrorCode::InvalidRewardAsset))?);
    let unpaid = total.checked_sub(distributed).ok_or(ErrorCode::RewardTotalExceeded)?;
    drop(data);
    let committed = reserve.outstanding.checked_add(unpaid).ok_or(ErrorCode::AmountOverflow)?;
    require!(committed <= available, ErrorCode::RewardReserveExceeded);
    let rent = Rent::get()?.minimum_balance(8 + RewardCycle::INIT_SPACE);
    let topup = rent.saturating_sub(cycle.lamports());
    if topup > 0 {
        invoke(&system_instruction::transfer(&payer.key(), &cycle.key(), topup),
            &[payer.to_account_info(), cycle.to_account_info(), system_program.to_account_info()])?;
    }
    cycle.to_account_info().resize(8 + RewardCycle::INIT_SPACE)?;
    cycle.try_borrow_mut_data()?[173] = 1;
    reserve.outstanding = committed;
    Ok(())
}

pub fn migrate_cycle_sol(ctx: Context<MigrateRewardCycleSol>, cycle_id: [u8; 32]) -> Result<()> {
    assert_current_router_authority(&ctx.accounts.legacy_router.to_account_info(), &ctx.accounts.authority.key(), ctx.program_id)?;
    let rent = Rent::get()?.minimum_balance(8 + RewardVault::INIT_SPACE);
    let available = ctx.accounts.vault.to_account_info().lamports().saturating_sub(rent);
    migrate_legacy_cycle(&ctx.accounts.cycle, &ctx.accounts.authority, &ctx.accounts.system_program,
        ctx.accounts.vault.key(), Pubkey::default(), cycle_id, ctx.bumps.cycle, available,
        &mut ctx.accounts.reserve, ctx.program_id)
}

pub fn migrate_cycle_token(ctx: Context<MigrateRewardCycleToken>, cycle_id: [u8; 32]) -> Result<()> {
    assert_current_router_authority(&ctx.accounts.legacy_router.to_account_info(), &ctx.accounts.authority.key(), ctx.program_id)?;
    migrate_legacy_cycle(&ctx.accounts.cycle, &ctx.accounts.authority, &ctx.accounts.system_program,
        ctx.accounts.vault.key(), ctx.accounts.token_mint.key(), cycle_id, ctx.bumps.cycle,
        ctx.accounts.vault_token_account.amount, &mut ctx.accounts.reserve, ctx.program_id)
}

#[derive(Accounts)]
#[instruction(cycle_id: [u8; 32], _merkle_root: [u8; 32], asset_mint: Pubkey)]
pub struct CreateRewardCycle<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        seeds = [REWARD_VAULT_SEED, authority.key().as_ref(), vault.mint.as_ref()],
        bump = vault.bump,
        has_one = authority
    )]
    pub vault: Account<'info, RewardVault>,
    #[account(mut, seeds = [REWARD_RESERVE_SEED, vault.key().as_ref(), asset_mint.as_ref()], bump = reserve.bump,
        constraint = reserve.vault == vault.key() && reserve.asset_mint == asset_mint @ ErrorCode::InvalidRewardAsset)]
    pub reserve: Account<'info, RewardReserve>,
    #[account(
        init,
        payer = authority,
        space = 8 + RewardCycle::INIT_SPACE,
        seeds = [REWARD_CYCLE_SEED, vault.key().as_ref(), cycle_id.as_ref()],
        bump
    )]
    pub cycle: Account<'info, RewardCycle>,
    /// CHECK: Validated against the current router header before creating a cycle.
    #[account(seeds = [SEED], bump)]
    pub legacy_router: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

pub fn create_cycle(
    ctx: Context<CreateRewardCycle>,
    cycle_id: [u8; 32],
    merkle_root: [u8; 32],
    asset_mint: Pubkey,
    total_amount: u64,
    cutoff_at: i64,
    payout_at: i64,
    leaf_count: u32,
) -> Result<()> {
    assert_current_router_authority(&ctx.accounts.legacy_router.to_account_info(), &ctx.accounts.authority.key(), ctx.program_id)?;
    require!(asset_mint == Pubkey::default(), ErrorCode::InvalidRewardAsset);
    require!(total_amount > 0 && leaf_count > 0, ErrorCode::InvalidAmount);
    require!(merkle_root != [0; 32], ErrorCode::InvalidRewardProof);
    require!(payout_at >= cutoff_at && cutoff_at > 0, ErrorCode::InvalidRewardTiming);
    let rent = Rent::get()?.minimum_balance(8 + RewardVault::INIT_SPACE);
    let balance = ctx.accounts.vault.to_account_info().lamports().saturating_sub(rent);
    let committed = ctx.accounts.reserve.outstanding.checked_add(total_amount).ok_or(ErrorCode::AmountOverflow)?;
    require!(committed <= balance, ErrorCode::RewardReserveExceeded);
    ctx.accounts.reserve.outstanding = committed;
    let cycle = &mut ctx.accounts.cycle;
    cycle.vault = ctx.accounts.vault.key();
    cycle.cycle_id = cycle_id;
    cycle.merkle_root = merkle_root;
    cycle.asset_mint = asset_mint;
    cycle.total_amount = total_amount;
    cycle.distributed_amount = 0;
    cycle.cutoff_at = cutoff_at;
    cycle.payout_at = payout_at;
    cycle.leaf_count = leaf_count;
    cycle.bump = ctx.bumps.cycle;
    cycle.reserved = true;
    emit!(RewardCycleCreated { cycle: cycle.key(), cycle_id, merkle_root, asset_mint, total_amount, cutoff_at, payout_at, leaf_count });
    Ok(())
}

#[derive(Accounts)]
#[instruction(cycle_id: [u8; 32], _merkle_root: [u8; 32], asset_mint: Pubkey)]
pub struct CreateRewardCycleToken<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(seeds = [REWARD_VAULT_SEED, authority.key().as_ref(), vault.mint.as_ref()], bump = vault.bump, has_one = authority)]
    pub vault: Account<'info, RewardVault>,
    #[account(mut, seeds = [REWARD_RESERVE_SEED, vault.key().as_ref(), asset_mint.as_ref()], bump = reserve.bump,
        constraint = reserve.vault == vault.key() && reserve.asset_mint == asset_mint @ ErrorCode::InvalidRewardAsset)]
    pub reserve: Account<'info, RewardReserve>,
    #[account(init, payer = authority, space = 8 + RewardCycle::INIT_SPACE,
        seeds = [REWARD_CYCLE_SEED, vault.key().as_ref(), cycle_id.as_ref()], bump)]
    pub cycle: Account<'info, RewardCycle>,
    #[account(address = asset_mint)]
    pub token_mint: InterfaceAccount<'info, Mint>,
    #[account(constraint = vault_token_account.owner == vault.key() && vault_token_account.mint == token_mint.key()
        && vault_token_account.key() == get_associated_token_address_with_program_id(&vault.key(), &token_mint.key(), token_mint.to_account_info().owner)
        @ ErrorCode::InvalidRewardTokenAccount)]
    pub vault_token_account: InterfaceAccount<'info, TokenAccount>,
    /// CHECK: Validated against the current router authority.
    #[account(seeds = [SEED], bump)]
    pub legacy_router: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[allow(clippy::too_many_arguments)]
pub fn create_cycle_token(ctx: Context<CreateRewardCycleToken>, cycle_id: [u8; 32], merkle_root: [u8; 32],
    asset_mint: Pubkey, total_amount: u64, cutoff_at: i64, payout_at: i64, leaf_count: u32) -> Result<()> {
    assert_current_router_authority(&ctx.accounts.legacy_router.to_account_info(), &ctx.accounts.authority.key(), ctx.program_id)?;
    require!(asset_mint != Pubkey::default(), ErrorCode::InvalidRewardAsset);
    require!(total_amount > 0 && leaf_count > 0, ErrorCode::InvalidAmount);
    require!(payout_at >= cutoff_at && cutoff_at > 0, ErrorCode::InvalidRewardTiming);
    let committed = ctx.accounts.reserve.outstanding.checked_add(total_amount).ok_or(ErrorCode::AmountOverflow)?;
    require!(committed <= ctx.accounts.vault_token_account.amount, ErrorCode::RewardReserveExceeded);
    ctx.accounts.reserve.outstanding = committed;
    let cycle = &mut ctx.accounts.cycle;
    cycle.vault = ctx.accounts.vault.key();
    cycle.cycle_id = cycle_id;
    cycle.merkle_root = merkle_root;
    cycle.asset_mint = asset_mint;
    cycle.total_amount = total_amount;
    cycle.distributed_amount = 0;
    cycle.cutoff_at = cutoff_at;
    cycle.payout_at = payout_at;
    cycle.leaf_count = leaf_count;
    cycle.bump = ctx.bumps.cycle;
    cycle.reserved = true;
    emit!(RewardCycleCreated { cycle: cycle.key(), cycle_id, merkle_root, asset_mint, total_amount, cutoff_at, payout_at, leaf_count });
    Ok(())
}

fn reward_leaf(cycle: &RewardCycle, recipient: &Pubkey, amount: u64, leaf_index: u32) -> [u8; 32] {
    hashv(&[
        REWARD_LEAF_DOMAIN,
        &cycle.cycle_id,
        recipient.as_ref(),
        cycle.asset_mint.as_ref(),
        &amount.to_le_bytes(),
        &leaf_index.to_le_bytes(),
    ]).to_bytes()
}

fn verify_proof(mut node: [u8; 32], proof: &[[u8; 32]], root: &[u8; 32]) -> bool {
    for sibling in proof {
        node = if node <= *sibling { hashv(&[&node, sibling]).to_bytes() } else { hashv(&[sibling, &node]).to_bytes() };
    }
    node == *root
}

fn validate_payment(cycle: &mut RewardCycle, recipient: &Pubkey, amount: u64, leaf_index: u32, proof: &[[u8; 32]]) -> Result<i64> {
    require!(cycle.reserved, ErrorCode::RewardReserveExceeded);
    require!(amount > 0 && leaf_index < cycle.leaf_count, ErrorCode::InvalidAmount);
    require!(proof.len() <= 32, ErrorCode::InvalidRewardProof);
    let now = Clock::get()?.unix_timestamp;
    require!(now >= cycle.payout_at, ErrorCode::RewardCycleNotPayable);
    require!(verify_proof(reward_leaf(cycle, recipient, amount, leaf_index), proof, &cycle.merkle_root), ErrorCode::InvalidRewardProof);
    let distributed_amount = cycle.distributed_amount.checked_add(amount).ok_or(ErrorCode::AmountOverflow)?;
    require!(distributed_amount <= cycle.total_amount, ErrorCode::RewardTotalExceeded);
    cycle.distributed_amount = distributed_amount;
    Ok(now)
}

fn record_payment(payment: &mut RewardPayment, cycle: Pubkey, recipient: Pubkey, amount: u64, received_amount: u64, leaf_index: u32, paid_at: i64) {
    payment.cycle = cycle;
    payment.recipient = recipient;
    payment.amount = amount;
    payment.leaf_index = leaf_index;
    payment.paid_at = paid_at;
    payment.received_amount = received_amount;
}

#[derive(Accounts)]
pub struct PayoutRewardSol<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        mut,
        seeds = [REWARD_VAULT_SEED, vault.authority.as_ref(), vault.mint.as_ref()],
        bump = vault.bump
    )]
    pub vault: Account<'info, RewardVault>,
    #[account(mut, seeds = [REWARD_RESERVE_SEED, vault.key().as_ref(), Pubkey::default().as_ref()], bump = reserve.bump,
        constraint = reserve.vault == vault.key() && reserve.asset_mint == Pubkey::default() @ ErrorCode::InvalidRewardAsset)]
    pub reserve: Account<'info, RewardReserve>,
    #[account(
        mut,
        seeds = [REWARD_CYCLE_SEED, vault.key().as_ref(), cycle.cycle_id.as_ref()],
        bump = cycle.bump,
        has_one = vault
    )]
    pub cycle: Account<'info, RewardCycle>,
    /// CHECK: The Merkle proof binds this writable address to the payout.
    #[account(mut)]
    pub recipient: UncheckedAccount<'info>,
    #[account(
        init,
        payer = payer,
        space = 8 + RewardPayment::INIT_SPACE,
        seeds = [REWARD_PAYMENT_SEED, cycle.key().as_ref(), recipient.key().as_ref()],
        bump
    )]
    pub payment: Account<'info, RewardPayment>,
    pub system_program: Program<'info, System>,
}

pub fn payout_sol(ctx: Context<PayoutRewardSol>, amount: u64, leaf_index: u32, proof: Vec<[u8; 32]>) -> Result<()> {
    require!(ctx.accounts.cycle.asset_mint == Pubkey::default(), ErrorCode::InvalidRewardAsset);
    require_keys_neq!(ctx.accounts.recipient.key(), ctx.accounts.vault.key(), ErrorCode::InvalidDestination);
    let paid_at = validate_payment(&mut ctx.accounts.cycle, &ctx.accounts.recipient.key(), amount, leaf_index, &proof)?;
    ctx.accounts.reserve.outstanding = ctx.accounts.reserve.outstanding.checked_sub(amount).ok_or(ErrorCode::RewardReserveExceeded)?;
    let rent = Rent::get()?.minimum_balance(8 + RewardVault::INIT_SPACE);
    require!(amount <= ctx.accounts.vault.to_account_info().lamports().saturating_sub(rent), ErrorCode::InsufficientRouterBalance);
    **ctx.accounts.vault.to_account_info().try_borrow_mut_lamports()? -= amount;
    let recipient_balance = ctx.accounts.recipient.lamports().checked_add(amount).ok_or(ErrorCode::AmountOverflow)?;
    **ctx.accounts.recipient.to_account_info().try_borrow_mut_lamports()? = recipient_balance;
    record_payment(&mut ctx.accounts.payment, ctx.accounts.cycle.key(), ctx.accounts.recipient.key(), amount, amount, leaf_index, paid_at);
    emit!(RewardPaid { cycle: ctx.accounts.cycle.key(), recipient: ctx.accounts.recipient.key(), asset_mint: Pubkey::default(), amount, received_amount: amount, leaf_index });
    Ok(())
}

#[derive(Accounts)]
pub struct PayoutRewardToken<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        seeds = [REWARD_VAULT_SEED, vault.authority.as_ref(), vault.mint.as_ref()],
        bump = vault.bump
    )]
    pub vault: Account<'info, RewardVault>,
    #[account(mut, seeds = [REWARD_RESERVE_SEED, vault.key().as_ref(), cycle.asset_mint.as_ref()], bump = reserve.bump,
        constraint = reserve.vault == vault.key() && reserve.asset_mint == cycle.asset_mint @ ErrorCode::InvalidRewardAsset)]
    pub reserve: Account<'info, RewardReserve>,
    #[account(
        mut,
        seeds = [REWARD_CYCLE_SEED, vault.key().as_ref(), cycle.cycle_id.as_ref()],
        bump = cycle.bump,
        has_one = vault
    )]
    pub cycle: Account<'info, RewardCycle>,
    /// CHECK: Bound to the destination token account owner and the Merkle proof.
    pub recipient: UncheckedAccount<'info>,
    #[account(address = cycle.asset_mint)]
    pub asset_mint: InterfaceAccount<'info, Mint>,
    #[account(mut, constraint = vault_token_account.owner == vault.key()
        && vault_token_account.mint == asset_mint.key()
        && vault_token_account.key() == get_associated_token_address_with_program_id(&vault.key(), &asset_mint.key(), asset_mint.to_account_info().owner)
        @ ErrorCode::InvalidRewardTokenAccount)]
    pub vault_token_account: InterfaceAccount<'info, TokenAccount>,
    #[account(mut, constraint = recipient_token_account.owner == recipient.key()
        && recipient_token_account.mint == asset_mint.key()
        && recipient_token_account.key() == get_associated_token_address_with_program_id(&recipient.key(), &asset_mint.key(), asset_mint.to_account_info().owner)
        @ ErrorCode::InvalidRewardTokenAccount)]
    pub recipient_token_account: InterfaceAccount<'info, TokenAccount>,
    #[account(
        init,
        payer = payer,
        space = 8 + RewardPayment::INIT_SPACE,
        seeds = [REWARD_PAYMENT_SEED, cycle.key().as_ref(), recipient.key().as_ref()],
        bump
    )]
    pub payment: Account<'info, RewardPayment>,
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

pub fn payout_token(ctx: Context<PayoutRewardToken>, amount: u64, leaf_index: u32, proof: Vec<[u8; 32]>) -> Result<()> {
    require!(ctx.accounts.cycle.asset_mint != Pubkey::default(), ErrorCode::InvalidRewardAsset);
    let paid_at = validate_payment(&mut ctx.accounts.cycle, &ctx.accounts.recipient.key(), amount, leaf_index, &proof)?;
    ctx.accounts.reserve.outstanding = ctx.accounts.reserve.outstanding.checked_sub(amount).ok_or(ErrorCode::RewardReserveExceeded)?;
    let vault_before = ctx.accounts.vault_token_account.amount;
    let recipient_before = ctx.accounts.recipient_token_account.amount;
    let authority = ctx.accounts.vault.authority;
    let mint = ctx.accounts.vault.mint;
    let bump = [ctx.accounts.vault.bump];
    let signer: &[&[u8]] = &[REWARD_VAULT_SEED, authority.as_ref(), mint.as_ref(), &bump];
    token_interface::transfer_checked(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            TransferChecked {
                from: ctx.accounts.vault_token_account.to_account_info(),
                mint: ctx.accounts.asset_mint.to_account_info(),
                to: ctx.accounts.recipient_token_account.to_account_info(),
                authority: ctx.accounts.vault.to_account_info(),
            },
            &[signer],
        ),
        amount,
        ctx.accounts.asset_mint.decimals,
    )?;
    ctx.accounts.vault_token_account.reload()?;
    ctx.accounts.recipient_token_account.reload()?;
    // Preserve exact delivery: a fee-bearing or self-transfer cannot satisfy the committed payout.
    require!(exact_token_delivery(vault_before, ctx.accounts.vault_token_account.amount,
        recipient_before, ctx.accounts.recipient_token_account.amount, amount), ErrorCode::InvalidAmount);
    record_payment(&mut ctx.accounts.payment, ctx.accounts.cycle.key(), ctx.accounts.recipient.key(), amount, amount, leaf_index, paid_at);
    emit!(RewardPaid { cycle: ctx.accounts.cycle.key(), recipient: ctx.accounts.recipient.key(), asset_mint: ctx.accounts.asset_mint.key(), amount, received_amount: amount, leaf_index });
    Ok(())
}

fn exact_token_delivery(vault_before: u64, vault_after: u64, recipient_before: u64, recipient_after: u64, amount: u64) -> bool {
    vault_before.checked_sub(vault_after) == Some(amount)
        && recipient_after.checked_sub(recipient_before) == Some(amount)
}

#[event]
pub struct RewardCycleCreated {
    pub cycle: Pubkey,
    pub cycle_id: [u8; 32],
    pub merkle_root: [u8; 32],
    pub asset_mint: Pubkey,
    pub total_amount: u64,
    pub cutoff_at: i64,
    pub payout_at: i64,
    pub leaf_count: u32,
}

#[event]
pub struct RewardPaid {
    pub cycle: Pubkey,
    pub recipient: Pubkey,
    pub asset_mint: Pubkey,
    pub amount: u64,
    pub received_amount: u64,
    pub leaf_index: u32,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn payment_requires_exact_recipient_credit() {
        assert!(exact_token_delivery(100, 60, 10, 50, 40));
        assert!(!exact_token_delivery(100, 60, 10, 49, 40)); // transfer fee
        assert!(!exact_token_delivery(100, 100, 100, 100, 40)); // self-transfer
        assert!(!exact_token_delivery(100, 60, 50, 10, 40)); // recipient debit
        assert!(!exact_token_delivery(60, 100, 10, 50, 40)); // source credit
        assert!(!exact_token_delivery(u64::MAX, 0, 1, 0, u64::MAX));
    }

    #[test]
    fn proof_binds_cycle_recipient_asset_amount_and_index() {
        let mut cycle = RewardCycle { vault: Pubkey::new_unique(), cycle_id: [7; 32], merkle_root: [0; 32], asset_mint: Pubkey::default(), total_amount: 5, distributed_amount: 0, cutoff_at: 1, payout_at: 2, leaf_count: 2, bump: 1, reserved: true };
        let recipient = Pubkey::new_unique();
        let root = reward_leaf(&cycle, &recipient, 5, 0);
        assert!(verify_proof(root, &[], &root));
        assert!(!verify_proof(reward_leaf(&cycle, &Pubkey::new_unique(), 5, 0), &[], &root));
        assert!(!verify_proof(reward_leaf(&cycle, &recipient, 4, 0), &[], &root));
        assert!(!verify_proof(reward_leaf(&cycle, &recipient, 5, 1), &[], &root));
        cycle.asset_mint = Pubkey::new_unique();
        assert!(!verify_proof(reward_leaf(&cycle, &recipient, 5, 0), &[], &root));
        cycle.asset_mint = Pubkey::default();
        cycle.cycle_id = [8; 32];
        assert!(!verify_proof(reward_leaf(&cycle, &recipient, 5, 0), &[], &root));
    }

    #[test]
    fn sorted_merkle_proof_verifies() {
        let cycle = RewardCycle { vault: Pubkey::new_unique(), cycle_id: [7; 32], merkle_root: [0; 32], asset_mint: Pubkey::default(), total_amount: 5, distributed_amount: 0, cutoff_at: 1, payout_at: 2, leaf_count: 2, bump: 1, reserved:true };
        let a = reward_leaf(&cycle, &Pubkey::new_unique(), 2, 0);
        let b = reward_leaf(&cycle, &Pubkey::new_unique(), 3, 1);
        let root = if a <= b { hashv(&[&a, &b]).to_bytes() } else { hashv(&[&b, &a]).to_bytes() };
        assert!(verify_proof(a, &[b], &root));
        assert!(verify_proof(b, &[a], &root));
        assert!(!verify_proof(a, &[[9; 32]], &root));
    }
}
