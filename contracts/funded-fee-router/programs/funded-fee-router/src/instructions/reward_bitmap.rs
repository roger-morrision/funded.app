// Devnet V3 only. The same cycle PDA namespace prevents legacy/bitmap dual creation.
use anchor_lang::prelude::*;
use anchor_spl::token_interface::{self, Mint, TokenAccount, TokenInterface, TransferChecked};
use anchor_spl::associated_token::get_associated_token_address_with_program_id;
use solana_sha256_hasher::hashv;
use crate::{constants::*, error::ErrorCode, state::{RewardReserve, RewardVault}, reward_bitmap_state::RewardBitmapCycle};
use super::{rotate::assert_current_router_authority, reward::{RewardCycleCreated, RewardCycleExpired, RewardPaid}};

#[derive(Accounts)]
#[instruction(cycle_id: [u8; 32], _merkle_root: [u8; 32], asset_mint: Pubkey, _total_amount: u64, _cutoff_at: i64, _payout_at: i64, leaf_count: u32)]
pub struct CreateBitmapCycle<'info> {
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
        space = RewardBitmapCycle::space(leaf_count),
        seeds = [REWARD_CYCLE_SEED, vault.key().as_ref(), cycle_id.as_ref()],
        bump
    )]
    pub cycle: Account<'info, RewardBitmapCycle>,
    /// CHECK: Validated against the current router header before creating a cycle.
    #[account(seeds = [SEED], bump)]
    pub legacy_router: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

pub fn create_cycle(
    ctx: Context<CreateBitmapCycle>,
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
    require!(total_amount > 0 && leaf_count > 0 && leaf_count <= RewardBitmapCycle::MAX_LEAVES, ErrorCode::InvalidAmount);
    require!(merkle_root != [0; 32], ErrorCode::InvalidRewardProof);
    require!(payout_at >= cutoff_at && cutoff_at > 0, ErrorCode::InvalidRewardTiming);
    // Mainnet: leave the guardian review delay, and count the SOL commitment
    // that later leaves the vault against the daily outflow cap.
    #[cfg(feature = "mainnet-v3-program")]
    {
        super::guard::assert_review_delay(payout_at)?;
        super::guard::record_outflow(&ctx.accounts.legacy_router.to_account_info(), total_amount)?;
    }
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
    cycle.paid = vec![0; (leaf_count as usize + 7) / 8];
    emit!(RewardCycleCreated { cycle: cycle.key(), cycle_id, merkle_root, asset_mint, total_amount, cutoff_at, payout_at, leaf_count });
    Ok(())
}

#[derive(Accounts)]
#[instruction(cycle_id: [u8; 32], _merkle_root: [u8; 32], asset_mint: Pubkey, _total_amount: u64, _cutoff_at: i64, _payout_at: i64, leaf_count: u32)]
pub struct CreateBitmapCycleToken<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(seeds = [REWARD_VAULT_SEED, authority.key().as_ref(), vault.mint.as_ref()], bump = vault.bump, has_one = authority)]
    pub vault: Account<'info, RewardVault>,
    #[account(mut, seeds = [REWARD_RESERVE_SEED, vault.key().as_ref(), asset_mint.as_ref()], bump = reserve.bump,
        constraint = reserve.vault == vault.key() && reserve.asset_mint == asset_mint @ ErrorCode::InvalidRewardAsset)]
    pub reserve: Account<'info, RewardReserve>,
    #[account(init, payer = authority, space = RewardBitmapCycle::space(leaf_count),
        seeds = [REWARD_CYCLE_SEED, vault.key().as_ref(), cycle_id.as_ref()], bump)]
    pub cycle: Account<'info, RewardBitmapCycle>,
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
pub fn create_cycle_token(ctx: Context<CreateBitmapCycleToken>, cycle_id: [u8; 32], merkle_root: [u8; 32],
    asset_mint: Pubkey, total_amount: u64, cutoff_at: i64, payout_at: i64, leaf_count: u32) -> Result<()> {
    assert_current_router_authority(&ctx.accounts.legacy_router.to_account_info(), &ctx.accounts.authority.key(), ctx.program_id)?;
    require!(asset_mint != Pubkey::default(), ErrorCode::InvalidRewardAsset);
    require!(total_amount > 0 && leaf_count > 0 && leaf_count <= RewardBitmapCycle::MAX_LEAVES, ErrorCode::InvalidAmount);
    require!(payout_at >= cutoff_at && cutoff_at > 0, ErrorCode::InvalidRewardTiming);
    #[cfg(feature = "mainnet-v3-program")]
    super::guard::assert_review_delay(payout_at)?;
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
    cycle.paid = vec![0; (leaf_count as usize + 7) / 8];
    emit!(RewardCycleCreated { cycle: cycle.key(), cycle_id, merkle_root, asset_mint, total_amount, cutoff_at, payout_at, leaf_count });
    Ok(())
}

fn reward_leaf(cycle: &RewardBitmapCycle, recipient: &Pubkey, amount: u64, leaf_index: u32) -> [u8; 32] {
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

fn validate_payment(cycle: &mut RewardBitmapCycle, recipient: &Pubkey, amount: u64, leaf_index: u32, proof: &[[u8; 32]]) -> Result<i64> {
    require!(cycle.reserved, ErrorCode::RewardReserveExceeded);
    require!(amount > 0 && leaf_index < cycle.leaf_count, ErrorCode::InvalidAmount);
    require!(proof.len() <= 32, ErrorCode::InvalidRewardProof);
    let byte = (leaf_index / 8) as usize;
    let mask = 1u8 << (leaf_index % 8);
    require!(cycle.paid.len() == (cycle.leaf_count as usize + 7) / 8
        && cycle.paid[byte] & mask == 0, ErrorCode::InvalidRewardProof);
    let now = Clock::get()?.unix_timestamp;
    require!(now >= cycle.payout_at, ErrorCode::RewardCycleNotPayable);
    require!(verify_proof(reward_leaf(cycle, recipient, amount, leaf_index), proof, &cycle.merkle_root), ErrorCode::InvalidRewardProof);
    let distributed_amount = cycle.distributed_amount.checked_add(amount).ok_or(ErrorCode::AmountOverflow)?;
    require!(distributed_amount <= cycle.total_amount, ErrorCode::RewardTotalExceeded);
    cycle.distributed_amount = distributed_amount;
    cycle.paid[byte] |= mask;
    Ok(now)
}

#[derive(Accounts)]
pub struct PayoutBitmapSol<'info> {
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
    pub cycle: Account<'info, RewardBitmapCycle>,
    /// CHECK: The Merkle proof binds this writable address to the payout.
    #[account(mut)]
    pub recipient: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

pub fn payout_sol(ctx: Context<PayoutBitmapSol>, amount: u64, leaf_index: u32, proof: Vec<[u8; 32]>) -> Result<()> {
    require!(ctx.accounts.cycle.asset_mint == Pubkey::default(), ErrorCode::InvalidRewardAsset);
    require_keys_neq!(ctx.accounts.recipient.key(), ctx.accounts.vault.key(), ErrorCode::InvalidDestination);
    let _paid_at = validate_payment(&mut ctx.accounts.cycle, &ctx.accounts.recipient.key(), amount, leaf_index, &proof)?;
    ctx.accounts.reserve.outstanding = ctx.accounts.reserve.outstanding.checked_sub(amount).ok_or(ErrorCode::RewardReserveExceeded)?;
    let rent = Rent::get()?.minimum_balance(8 + RewardVault::INIT_SPACE);
    require!(amount <= ctx.accounts.vault.to_account_info().lamports().saturating_sub(rent), ErrorCode::InsufficientRouterBalance);
    **ctx.accounts.vault.to_account_info().try_borrow_mut_lamports()? -= amount;
    let recipient_balance = ctx.accounts.recipient.lamports().checked_add(amount).ok_or(ErrorCode::AmountOverflow)?;
    **ctx.accounts.recipient.to_account_info().try_borrow_mut_lamports()? = recipient_balance;
    emit!(RewardPaid { cycle: ctx.accounts.cycle.key(), recipient: ctx.accounts.recipient.key(), asset_mint: Pubkey::default(), amount, received_amount: amount, leaf_index });
    Ok(())
}

#[derive(Accounts)]
pub struct PayoutBitmapToken<'info> {
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
    pub cycle: Account<'info, RewardBitmapCycle>,
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
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

pub fn payout_token(ctx: Context<PayoutBitmapToken>, amount: u64, leaf_index: u32, proof: Vec<[u8; 32]>) -> Result<()> {
    require!(ctx.accounts.cycle.asset_mint != Pubkey::default(), ErrorCode::InvalidRewardAsset);
    let _paid_at = validate_payment(&mut ctx.accounts.cycle, &ctx.accounts.recipient.key(), amount, leaf_index, &proof)?;
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
    emit!(RewardPaid { cycle: ctx.accounts.cycle.key(), recipient: ctx.accounts.recipient.key(), asset_mint: ctx.accounts.asset_mint.key(), amount, received_amount: amount, leaf_index });
    Ok(())
}

fn exact_token_delivery(vault_before: u64, vault_after: u64, recipient_before: u64, recipient_after: u64, amount: u64) -> bool {
    vault_before.checked_sub(vault_after) == Some(amount)
        && recipient_after.checked_sub(recipient_before) == Some(amount)
}

#[derive(Accounts)]
pub struct ExpireBitmapCycle<'info> {
    pub authority: Signer<'info>,
    #[account(seeds = [REWARD_VAULT_SEED, vault.authority.as_ref(), vault.mint.as_ref()], bump = vault.bump)]
    pub vault: Account<'info, RewardVault>,
    #[account(mut, seeds = [REWARD_RESERVE_SEED, vault.key().as_ref(), cycle.asset_mint.as_ref()], bump = reserve.bump,
        constraint = reserve.vault == vault.key() && reserve.asset_mint == cycle.asset_mint @ ErrorCode::InvalidRewardAsset)]
    pub reserve: Account<'info, RewardReserve>,
    #[account(mut, seeds = [REWARD_CYCLE_SEED, vault.key().as_ref(), cycle.cycle_id.as_ref()], bump = cycle.bump, has_one = vault)]
    pub cycle: Account<'info, RewardBitmapCycle>,
    /// CHECK: Validated against the current router authority.
    #[account(seeds = [SEED], bump)]
    pub legacy_router: UncheckedAccount<'info>,
}

// Release the unpaid part of a cycle that can never be fully paid (for
// example a leaf whose owner cannot hold a token account). Tokens never move:
// they stay in the vault and become available to later cycles. Clearing
// `reserved` makes validate_payment reject every later payout of this cycle.
pub fn expire_cycle(ctx: Context<ExpireBitmapCycle>) -> Result<()> {
    assert_current_router_authority(&ctx.accounts.legacy_router.to_account_info(), &ctx.accounts.authority.key(), ctx.program_id)?;
    let now = Clock::get()?.unix_timestamp;
    let cycle = &mut ctx.accounts.cycle;
    let expirable_at = cycle.payout_at.checked_add(REWARD_CYCLE_EXPIRY_GRACE_SECONDS).ok_or(ErrorCode::AmountOverflow)?;
    require!(cycle.reserved && now >= expirable_at, ErrorCode::RewardCycleNotExpirable);
    let unpaid = cycle.total_amount.checked_sub(cycle.distributed_amount).ok_or(ErrorCode::RewardTotalExceeded)?;
    ctx.accounts.reserve.outstanding = ctx.accounts.reserve.outstanding.checked_sub(unpaid).ok_or(ErrorCode::RewardReserveExceeded)?;
    cycle.reserved = false;
    emit!(RewardCycleExpired { cycle: cycle.key(), asset_mint: cycle.asset_mint, unpaid_amount: unpaid, expired_at: now });
    Ok(())
}
