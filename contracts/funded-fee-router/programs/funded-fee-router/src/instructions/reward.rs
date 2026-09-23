use anchor_lang::prelude::*;
use anchor_spl::token_interface::{self, Mint, TokenAccount, TokenInterface, TransferChecked};
use solana_sha256_hasher::hashv;
use crate::{constants::*, error::ErrorCode, state::{RewardCycle, RewardPayment, RewardVault}};

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
    pub system_program: Program<'info, System>,
}

pub fn initialize_vault(ctx: Context<InitializeRewardVault>) -> Result<()> {
    let vault = &mut ctx.accounts.vault;
    vault.authority = ctx.accounts.authority.key();
    vault.mint = ctx.accounts.mint.key();
    vault.bump = ctx.bumps.vault;
    Ok(())
}

#[derive(Accounts)]
#[instruction(cycle_id: [u8; 32])]
pub struct CreateRewardCycle<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        seeds = [REWARD_VAULT_SEED, authority.key().as_ref(), vault.mint.as_ref()],
        bump = vault.bump,
        has_one = authority
    )]
    pub vault: Account<'info, RewardVault>,
    #[account(
        init,
        payer = authority,
        space = 8 + RewardCycle::INIT_SPACE,
        seeds = [REWARD_CYCLE_SEED, vault.key().as_ref(), cycle_id.as_ref()],
        bump
    )]
    pub cycle: Account<'info, RewardCycle>,
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
    require!(total_amount > 0 && leaf_count > 0, ErrorCode::InvalidAmount);
    require!(payout_at >= cutoff_at && cutoff_at > 0, ErrorCode::InvalidRewardTiming);
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
    require!(amount > 0 && leaf_index < cycle.leaf_count, ErrorCode::InvalidAmount);
    let now = Clock::get()?.unix_timestamp;
    require!(now >= cycle.payout_at, ErrorCode::RewardCycleNotPayable);
    require!(verify_proof(reward_leaf(cycle, recipient, amount, leaf_index), proof, &cycle.merkle_root), ErrorCode::InvalidRewardProof);
    cycle.distributed_amount = cycle.distributed_amount.checked_add(amount).ok_or(ErrorCode::AmountOverflow)?;
    require!(cycle.distributed_amount <= cycle.total_amount, ErrorCode::RewardTotalExceeded);
    Ok(now)
}

fn record_payment(payment: &mut RewardPayment, cycle: Pubkey, recipient: Pubkey, amount: u64, leaf_index: u32, paid_at: i64) {
    payment.cycle = cycle;
    payment.recipient = recipient;
    payment.amount = amount;
    payment.leaf_index = leaf_index;
    payment.paid_at = paid_at;
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
    let paid_at = validate_payment(&mut ctx.accounts.cycle, &ctx.accounts.recipient.key(), amount, leaf_index, &proof)?;
    let rent = Rent::get()?.minimum_balance(8 + RewardVault::INIT_SPACE);
    require!(amount <= ctx.accounts.vault.to_account_info().lamports().saturating_sub(rent), ErrorCode::InsufficientRouterBalance);
    **ctx.accounts.vault.to_account_info().try_borrow_mut_lamports()? -= amount;
    **ctx.accounts.recipient.to_account_info().try_borrow_mut_lamports()? += amount;
    record_payment(&mut ctx.accounts.payment, ctx.accounts.cycle.key(), ctx.accounts.recipient.key(), amount, leaf_index, paid_at);
    emit!(RewardPaid { cycle: ctx.accounts.cycle.key(), recipient: ctx.accounts.recipient.key(), asset_mint: Pubkey::default(), amount, leaf_index });
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
    #[account(mut, constraint = vault_token_account.owner == vault.key(), constraint = vault_token_account.mint == asset_mint.key())]
    pub vault_token_account: InterfaceAccount<'info, TokenAccount>,
    #[account(mut, constraint = recipient_token_account.owner == recipient.key() @ ErrorCode::InvalidRewardTokenAccount, constraint = recipient_token_account.mint == asset_mint.key() @ ErrorCode::InvalidRewardTokenAccount)]
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
    record_payment(&mut ctx.accounts.payment, ctx.accounts.cycle.key(), ctx.accounts.recipient.key(), amount, leaf_index, paid_at);
    emit!(RewardPaid { cycle: ctx.accounts.cycle.key(), recipient: ctx.accounts.recipient.key(), asset_mint: ctx.accounts.asset_mint.key(), amount, leaf_index });
    Ok(())
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
    pub leaf_index: u32,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sorted_merkle_proof_verifies() {
        let cycle = RewardCycle { vault: Pubkey::new_unique(), cycle_id: [7; 32], merkle_root: [0; 32], asset_mint: Pubkey::default(), total_amount: 5, distributed_amount: 0, cutoff_at: 1, payout_at: 2, leaf_count: 2, bump: 1 };
        let a = reward_leaf(&cycle, &Pubkey::new_unique(), 2, 0);
        let b = reward_leaf(&cycle, &Pubkey::new_unique(), 3, 1);
        let root = if a <= b { hashv(&[&a, &b]).to_bytes() } else { hashv(&[&b, &a]).to_bytes() };
        assert!(verify_proof(a, &[b], &root));
        assert!(verify_proof(b, &[a], &root));
        assert!(!verify_proof(a, &[[9; 32]], &root));
    }
}
