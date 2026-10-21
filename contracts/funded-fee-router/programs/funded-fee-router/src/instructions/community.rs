use anchor_lang::prelude::*;
use anchor_spl::associated_token::{get_associated_token_address_with_program_id, AssociatedToken};
use anchor_spl::token_interface::{self, Mint, TokenAccount, TokenInterface, TransferChecked};
use solana_sha256_hasher::hashv;
use crate::{constants::*, error::ErrorCode, state::{CommunityDrop, CommunityPayment, CommunitySnapshotApproval, RewardReserve, RewardVault}};
use super::rotate::{assert_current_router_authority, assert_upgrade_owner};


fn configured_window(program: &Pubkey, mint: &Pubkey, accounts: &[AccountInfo]) -> Result<i64> {
    #[cfg(feature = "devnet-v3-program")]
    { super::agency_rules_v3::community_window(program, mint, accounts) }
    #[cfg(not(feature = "devnet-v3-program"))]
    { let _ = (program, mint, accounts); Ok(COMMUNITY_WINDOW_SECONDS) }
}

#[derive(Accounts)]
pub struct ApproveCommunitySnapshot<'info> {
    #[account(mut)]
    pub app_owner: Signer<'info>,
    /// CHECK: Bound to the approval PDA and checked as the current router authority when opening a drop.
    pub protocol_authority: UncheckedAccount<'info>,
    /// CHECK: Bound to the approved drop metadata.
    pub creator: UncheckedAccount<'info>,
    pub mint: InterfaceAccount<'info, Mint>,
    pub eligibility_mint: InterfaceAccount<'info, Mint>,
    #[account(init, payer = app_owner, space = 8 + CommunitySnapshotApproval::INIT_SPACE,
        seeds = [SNAPSHOT_APPROVAL_SEED, protocol_authority.key().as_ref(), mint.key().as_ref()], bump)]
    pub approval: Account<'info, CommunitySnapshotApproval>,
    /// CHECK: Checked as this executable program by the upgrade-owner guard.
    pub program: UncheckedAccount<'info>,
    /// CHECK: Checked as this program's ProgramData and upgrade owner.
    pub program_data: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[allow(clippy::too_many_arguments)]
pub fn approve_snapshot(ctx: Context<ApproveCommunitySnapshot>, merkle_root: [u8; 32], snapshot_hash: [u8; 32],
    migration_signature: [u8; 64], migration_slot: u64, migration_at: i64, total_amount: u64, leaf_count: u32) -> Result<()> {
    assert_upgrade_owner(&ctx.accounts.program.to_account_info(), &ctx.accounts.program_data.to_account_info(),
        &ctx.accounts.app_owner.key(), ctx.program_id)?;
    let window = configured_window(ctx.program_id, &ctx.accounts.mint.key(), ctx.remaining_accounts)?;
    let now = Clock::get()?.unix_timestamp;
    require!(merkle_root != [0; 32] && snapshot_hash != [0; 32] && migration_signature != [0; 64]
        && migration_slot > 0 && migration_at > 0 && migration_at <= now
        && now < migration_at.checked_add(window).ok_or(ErrorCode::AmountOverflow)?
        && total_amount > 0 && leaf_count > 0, ErrorCode::InvalidCommunitySnapshot);
    let approval = &mut ctx.accounts.approval;
    approval.protocol_authority = ctx.accounts.protocol_authority.key();
    approval.creator = ctx.accounts.creator.key();
    approval.mint = ctx.accounts.mint.key();
    approval.eligibility_mint = ctx.accounts.eligibility_mint.key();
    approval.merkle_root = merkle_root;
    approval.snapshot_hash = snapshot_hash;
    approval.migration_signature = migration_signature;
    approval.migration_slot = migration_slot;
    approval.migration_at = migration_at;
    approval.total_amount = total_amount;
    approval.leaf_count = leaf_count;
    approval.bump = ctx.bumps.approval;
    Ok(())
}

fn assert_snapshot_approval(approval: &CommunitySnapshotApproval, drop: &CommunityDrop) -> Result<()> {
    require!(approval.protocol_authority == drop.protocol_authority && approval.creator == drop.creator
        && approval.mint == drop.mint && approval.eligibility_mint == drop.eligibility_mint
        && approval.merkle_root == drop.merkle_root && approval.snapshot_hash == drop.snapshot_hash
        && approval.migration_signature == drop.migration_signature && approval.migration_slot == drop.migration_slot
        && approval.migration_at == drop.migration_at && approval.total_amount == drop.total_amount
        && approval.leaf_count == drop.leaf_count, ErrorCode::CommunitySnapshotNotApproved);
    Ok(())
}

#[derive(Accounts)]
pub struct InitializeCommunityDrop<'info> {
    #[account(mut)]
    pub protocol_authority: Signer<'info>,
    #[account(mut)]
    pub creator: Signer<'info>,
    /// CHECK: Equality with the signing reward authority is enforced in the handler.
    pub app_owner: UncheckedAccount<'info>,
    /// CHECK: Validated against the signing protocol authority before opening the drop.
    #[account(seeds = [SEED], bump)]
    pub legacy_router: UncheckedAccount<'info>,
    pub mint: InterfaceAccount<'info, Mint>,
    pub eligibility_mint: InterfaceAccount<'info, Mint>,
    #[account(
        init,
        payer = creator,
        space = 8 + CommunityDrop::INIT_SPACE,
        seeds = [COMMUNITY_DROP_SEED, protocol_authority.key().as_ref(), mint.key().as_ref()],
        bump
    )]
    pub drop: Account<'info, CommunityDrop>,
    #[account(seeds = [SNAPSHOT_APPROVAL_SEED, protocol_authority.key().as_ref(), mint.key().as_ref()], bump = snapshot_approval.bump)]
    pub snapshot_approval: Account<'info, CommunitySnapshotApproval>,
    #[account(mut, constraint = creator_token_account.owner == creator.key() @ ErrorCode::InvalidRewardTokenAccount,
        constraint = creator_token_account.mint == mint.key() @ ErrorCode::InvalidRewardTokenAccount)]
    pub creator_token_account: InterfaceAccount<'info, TokenAccount>,
    #[account(
        init,
        payer = creator,
        associated_token::mint = mint,
        associated_token::authority = drop,
        associated_token::token_program = token_program
    )]
    pub vault_token_account: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

// A launch may have already escrowed its reserved tokens in RewardVault. This
// instruction moves that exact escrow to the claim vault atomically, without
// returning the tokens to the creator or allowing a second reserve deposit.
#[derive(Accounts)]
pub struct InitializeCommunityDropFromRewardVault<'info> {
    #[account(mut)]
    pub protocol_authority: Signer<'info>,
    /// CHECK: The service binds this address to a verified launch and finalized funding receipt.
    pub creator: UncheckedAccount<'info>,
    /// CHECK: Equality with the current router authority is enforced in the handler.
    pub app_owner: UncheckedAccount<'info>,
    pub mint: InterfaceAccount<'info, Mint>,
    pub eligibility_mint: InterfaceAccount<'info, Mint>,
    #[account(
        seeds = [REWARD_VAULT_SEED, protocol_authority.key().as_ref(), mint.key().as_ref()],
        bump = reward_vault.bump,
        has_one = mint @ ErrorCode::InvalidRewardTokenAccount,
    )]
    pub reward_vault: Account<'info, RewardVault>,
    /// CHECK: Validated as the reward reserve PDA and parsed before escrow transfer.
    #[account(seeds = [REWARD_RESERVE_SEED, reward_vault.key().as_ref(), mint.key().as_ref()], bump)]
    pub reward_reserve: UncheckedAccount<'info>,
    #[account(mut,
        associated_token::mint = mint,
        associated_token::authority = reward_vault,
        associated_token::token_program = token_program)]
    pub reward_vault_token_account: InterfaceAccount<'info, TokenAccount>,
    #[account(
        init,
        payer = protocol_authority,
        space = 8 + CommunityDrop::INIT_SPACE,
        seeds = [COMMUNITY_DROP_SEED, protocol_authority.key().as_ref(), mint.key().as_ref()],
        bump
    )]
    pub drop: Account<'info, CommunityDrop>,
    #[account(seeds = [SNAPSHOT_APPROVAL_SEED, protocol_authority.key().as_ref(), mint.key().as_ref()], bump = snapshot_approval.bump)]
    pub snapshot_approval: Account<'info, CommunitySnapshotApproval>,
    #[account(
        init,
        payer = protocol_authority,
        associated_token::mint = mint,
        associated_token::authority = drop,
        associated_token::token_program = token_program
    )]
    pub vault_token_account: InterfaceAccount<'info, TokenAccount>,
    /// CHECK: Verified against the current router header before moving the escrow.
    #[account(seeds = [SEED], bump)]
    pub legacy_router: UncheckedAccount<'info>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[allow(clippy::too_many_arguments)]
pub fn initialize_drop_from_reward_vault(
    ctx: Context<InitializeCommunityDropFromRewardVault>,
    merkle_root: [u8; 32],
    snapshot_hash: [u8; 32],
    migration_signature: [u8; 64],
    migration_slot: u64,
    snapshot_slot: u64,
    migration_at: i64,
    total_amount: u64,
    leaf_count: u32,
) -> Result<()> {
    assert_current_router_authority(&ctx.accounts.legacy_router.to_account_info(), &ctx.accounts.protocol_authority.key(), ctx.program_id)?;
    require!(ctx.accounts.reward_vault.authority == ctx.accounts.protocol_authority.key(), ErrorCode::InvalidRotationAuthority);
    let reserve_info = ctx.accounts.reward_reserve.to_account_info();
    if reserve_info.owner == ctx.program_id {
        let data = reserve_info.try_borrow_data()?;
        let reserve = RewardReserve::try_deserialize(&mut &data[..])?;
        require!(reserve.vault == ctx.accounts.reward_vault.key() && reserve.asset_mint == ctx.accounts.mint.key()
            && reserve.outstanding == 0, ErrorCode::RewardReserveExceeded);
    } else {
        require!(reserve_info.data_is_empty() && reserve_info.lamports() == 0, ErrorCode::RewardReserveExceeded);
    }
    require!(ctx.accounts.reward_vault_token_account.amount == total_amount, ErrorCode::InvalidAmount);
    fill_drop(&mut ctx.accounts.drop, ctx.accounts.protocol_authority.key(), ctx.accounts.creator.key(),
        ctx.accounts.app_owner.key(), ctx.accounts.mint.key(), ctx.accounts.eligibility_mint.key(),
        merkle_root, snapshot_hash, migration_signature, migration_slot, snapshot_slot, migration_at,
        total_amount, leaf_count, ctx.bumps.drop, configured_window(ctx.program_id, &ctx.accounts.mint.key(), ctx.remaining_accounts)?)?;
    assert_snapshot_approval(&ctx.accounts.snapshot_approval, &ctx.accounts.drop)?;
    let authority = ctx.accounts.reward_vault.authority;
    let mint = ctx.accounts.reward_vault.mint;
    let bump = [ctx.accounts.reward_vault.bump];
    let signer: &[&[u8]] = &[REWARD_VAULT_SEED, authority.as_ref(), mint.as_ref(), &bump];
    token_interface::transfer_checked(CpiContext::new_with_signer(
        ctx.accounts.token_program.key(),
        TransferChecked { from:ctx.accounts.reward_vault_token_account.to_account_info(), mint:ctx.accounts.mint.to_account_info(),
            to:ctx.accounts.vault_token_account.to_account_info(), authority:ctx.accounts.reward_vault.to_account_info() },
        &[signer],
    ), total_amount, ctx.accounts.mint.decimals)?;
    ctx.accounts.reward_vault_token_account.reload()?;
    ctx.accounts.vault_token_account.reload()?;
    require!(ctx.accounts.reward_vault_token_account.amount == 0 && ctx.accounts.vault_token_account.amount == total_amount, ErrorCode::InvalidAmount);
    emit!(CommunityDropOpened { drop:ctx.accounts.drop.key(), mint:ctx.accounts.mint.key(), creator:ctx.accounts.creator.key(),
        eligibility_mint:ctx.accounts.eligibility_mint.key(), migration_slot, snapshot_slot, snapshot_hash,
        merkle_root, total_amount, expires_at:ctx.accounts.drop.expires_at, app_owner:ctx.accounts.app_owner.key() });
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn fill_drop(drop: &mut Account<CommunityDrop>, protocol_authority: Pubkey, creator: Pubkey,
    app_owner: Pubkey, mint: Pubkey, eligibility_mint: Pubkey, merkle_root: [u8; 32], snapshot_hash: [u8; 32],
    migration_signature: [u8; 64], migration_slot: u64, snapshot_slot: u64, migration_at: i64,
    total_amount: u64, leaf_count: u32, bump: u8, window: i64) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let expires_at = migration_at.checked_add(window).ok_or(ErrorCode::AmountOverflow)?;
    require!(migration_slot > 0 && snapshot_slot == migration_slot && migration_at > 0 && migration_at <= now
        && now < expires_at && merkle_root != [0; 32] && snapshot_hash != [0; 32]
        && migration_signature != [0; 64], ErrorCode::InvalidCommunitySnapshot);
    require!(total_amount > 0 && leaf_count > 0, ErrorCode::InvalidAmount);
    require!(app_owner == protocol_authority, ErrorCode::InvalidCommunityRemainder);
    drop.protocol_authority = protocol_authority;
    drop.creator = creator;
    drop.app_owner = app_owner;
    drop.mint = mint;
    drop.eligibility_mint = eligibility_mint;
    drop.merkle_root = merkle_root;
    drop.snapshot_hash = snapshot_hash;
    drop.migration_signature = migration_signature;
    drop.migration_slot = migration_slot;
    drop.snapshot_slot = snapshot_slot;
    drop.total_amount = total_amount;
    drop.claimed_amount = 0;
    drop.migration_at = migration_at;
    drop.expires_at = expires_at;
    drop.leaf_count = leaf_count;
    drop.closed = false;
    drop.bump = bump;
    Ok(())
}

#[allow(clippy::too_many_arguments)]
pub fn initialize_drop(
    ctx: Context<InitializeCommunityDrop>,
    merkle_root: [u8; 32],
    snapshot_hash: [u8; 32],
    migration_signature: [u8; 64],
    migration_slot: u64,
    snapshot_slot: u64,
    migration_at: i64,
    total_amount: u64,
    leaf_count: u32,
) -> Result<()> {
    assert_current_router_authority(&ctx.accounts.legacy_router.to_account_info(), &ctx.accounts.protocol_authority.key(), ctx.program_id)?;
    fill_drop(&mut ctx.accounts.drop, ctx.accounts.protocol_authority.key(), ctx.accounts.creator.key(),
        ctx.accounts.app_owner.key(), ctx.accounts.mint.key(), ctx.accounts.eligibility_mint.key(),
        merkle_root, snapshot_hash, migration_signature, migration_slot, snapshot_slot, migration_at,
        total_amount, leaf_count, ctx.bumps.drop, configured_window(ctx.program_id, &ctx.accounts.mint.key(), ctx.remaining_accounts)?)?;
    assert_snapshot_approval(&ctx.accounts.snapshot_approval, &ctx.accounts.drop)?;
    token_interface::transfer_checked(
        CpiContext::new(
            ctx.accounts.token_program.key(),
            TransferChecked {
                from: ctx.accounts.creator_token_account.to_account_info(),
                mint: ctx.accounts.mint.to_account_info(),
                to: ctx.accounts.vault_token_account.to_account_info(),
                authority: ctx.accounts.creator.to_account_info(),
            },
        ),
        total_amount,
        ctx.accounts.mint.decimals,
    )?;
    ctx.accounts.vault_token_account.reload()?;
    require!(ctx.accounts.vault_token_account.amount == total_amount, ErrorCode::InvalidAmount);
    emit!(CommunityDropOpened { drop:ctx.accounts.drop.key(), mint:ctx.accounts.mint.key(), creator:ctx.accounts.creator.key(), eligibility_mint:ctx.accounts.eligibility_mint.key(),
        migration_slot, snapshot_slot, snapshot_hash, merkle_root, total_amount, expires_at:ctx.accounts.drop.expires_at, app_owner:ctx.accounts.app_owner.key() });
    Ok(())
}

fn leaf(drop: Pubkey, recipient: Pubkey, amount: u64, leaf_index: u32) -> [u8; 32] {
    hashv(&[COMMUNITY_LEAF_DOMAIN, drop.as_ref(), recipient.as_ref(), &amount.to_le_bytes(), &leaf_index.to_le_bytes()]).to_bytes()
}

fn proof_valid(mut node: [u8; 32], proof: &[[u8; 32]], root: &[u8; 32]) -> bool {
    for sibling in proof {
        node = if node <= *sibling { hashv(&[&node, sibling]).to_bytes() } else { hashv(&[sibling, &node]).to_bytes() };
    }
    node == *root
}

fn claim_window_open(now: i64, drop: &CommunityDrop) -> bool {
    !drop.closed && now >= drop.migration_at && now < drop.expires_at
}

fn close_eligible(now: i64, drop: &CommunityDrop) -> bool {
    !drop.closed && now >= drop.expires_at
}

#[derive(Accounts)]
pub struct ClaimCommunityDrop<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, seeds = [COMMUNITY_DROP_SEED, drop.protocol_authority.as_ref(), drop.mint.as_ref()], bump = drop.bump)]
    pub drop: Account<'info, CommunityDrop>,
    /// CHECK: Merkle proof binds this account to the claim.
    pub recipient: UncheckedAccount<'info>,
    #[account(address = drop.mint)]
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(mut, constraint = vault_token_account.owner == drop.key() @ ErrorCode::InvalidRewardTokenAccount,
        constraint = vault_token_account.mint == mint.key() @ ErrorCode::InvalidRewardTokenAccount)]
    pub vault_token_account: InterfaceAccount<'info, TokenAccount>,
    #[account(mut, constraint = recipient_token_account.owner == recipient.key() @ ErrorCode::InvalidRewardTokenAccount,
        constraint = recipient_token_account.mint == mint.key() @ ErrorCode::InvalidRewardTokenAccount)]
    pub recipient_token_account: InterfaceAccount<'info, TokenAccount>,
    #[account(init, payer = payer, space = 8 + CommunityPayment::INIT_SPACE,
        seeds = [COMMUNITY_PAYMENT_SEED, drop.key().as_ref(), recipient.key().as_ref()], bump)]
    pub payment: Account<'info, CommunityPayment>,
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

pub fn claim(ctx: Context<ClaimCommunityDrop>, amount: u64, leaf_index: u32, proof: Vec<[u8; 32]>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let drop = &mut ctx.accounts.drop;
    require!(claim_window_open(now, drop), ErrorCode::CommunityClaimClosed);
    require!(amount > 0 && leaf_index < drop.leaf_count && proof.len() <= 32, ErrorCode::InvalidAmount);
    require!(proof_valid(leaf(drop.key(), ctx.accounts.recipient.key(), amount, leaf_index), &proof, &drop.merkle_root), ErrorCode::InvalidRewardProof);
    let expected_vault = get_associated_token_address_with_program_id(&drop.key(), &ctx.accounts.mint.key(), &ctx.accounts.token_program.key());
    require_keys_eq!(ctx.accounts.vault_token_account.key(), expected_vault, ErrorCode::InvalidRewardTokenAccount);
    let next = drop.claimed_amount.checked_add(amount).ok_or(ErrorCode::AmountOverflow)?;
    require!(next <= drop.total_amount, ErrorCode::RewardTotalExceeded);
    drop.claimed_amount = next;
    let vault_before = ctx.accounts.vault_token_account.amount;
    let recipient_before = ctx.accounts.recipient_token_account.amount;
    let authority = drop.protocol_authority;
    let mint = drop.mint;
    let bump = [drop.bump];
    let signer: &[&[u8]] = &[COMMUNITY_DROP_SEED, authority.as_ref(), mint.as_ref(), &bump];
    token_interface::transfer_checked(CpiContext::new_with_signer(
        ctx.accounts.token_program.key(),
        TransferChecked { from:ctx.accounts.vault_token_account.to_account_info(), mint:ctx.accounts.mint.to_account_info(),
            to:ctx.accounts.recipient_token_account.to_account_info(), authority:drop.to_account_info() },
        &[signer],
    ), amount, ctx.accounts.mint.decimals)?;
    ctx.accounts.vault_token_account.reload()?;
    ctx.accounts.recipient_token_account.reload()?;
    let received_amount = ctx.accounts.recipient_token_account.amount.checked_sub(recipient_before).ok_or(ErrorCode::InvalidAmount)?;
    require!(vault_before.checked_sub(ctx.accounts.vault_token_account.amount) == Some(amount)
        && received_amount > 0 && received_amount <= amount, ErrorCode::InvalidAmount);
    let payment = &mut ctx.accounts.payment;
    payment.drop = drop.key(); payment.recipient = ctx.accounts.recipient.key();
    payment.amount = amount; payment.leaf_index = leaf_index; payment.paid_at = now;
    emit!(CommunityDropClaimed { drop:drop.key(), recipient:payment.recipient, amount, received_amount, leaf_index });
    Ok(())
}

#[derive(Accounts)]
pub struct CloseCommunityDrop<'info> {
    pub caller: Signer<'info>,
    #[account(mut, seeds = [COMMUNITY_DROP_SEED, drop.protocol_authority.as_ref(), drop.mint.as_ref()], bump = drop.bump)]
    pub drop: Account<'info, CommunityDrop>,
    #[account(address = drop.mint)]
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(mut, constraint = vault_token_account.owner == drop.key() @ ErrorCode::InvalidRewardTokenAccount,
        constraint = vault_token_account.mint == mint.key() @ ErrorCode::InvalidRewardTokenAccount)]
    pub vault_token_account: InterfaceAccount<'info, TokenAccount>,
    #[account(mut, constraint = remainder_token_account.mint == mint.key() @ ErrorCode::InvalidRewardTokenAccount)]
    pub remainder_token_account: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
}

pub fn close(ctx: Context<CloseCommunityDrop>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let drop = &mut ctx.accounts.drop;
    require!(!drop.closed && now >= drop.expires_at, ErrorCode::CommunityClaimStillOpen);
    require!(close_eligible(now, drop), ErrorCode::InvalidCommunityRemainder);
    require!(ctx.accounts.remainder_token_account.owner == drop.app_owner, ErrorCode::InvalidRewardTokenAccount);
    let expected_vault = get_associated_token_address_with_program_id(&drop.key(), &ctx.accounts.mint.key(), &ctx.accounts.token_program.key());
    require_keys_eq!(ctx.accounts.vault_token_account.key(), expected_vault, ErrorCode::InvalidRewardTokenAccount);
    let remaining = drop.total_amount.checked_sub(drop.claimed_amount).ok_or(ErrorCode::AmountOverflow)?;
    require!(ctx.accounts.vault_token_account.amount >= remaining, ErrorCode::InsufficientRouterBalance);
    let amount = ctx.accounts.vault_token_account.amount;
    let recipient_before = ctx.accounts.remainder_token_account.amount;
    let authority = drop.protocol_authority;
    let mint = drop.mint;
    let bump = [drop.bump];
    let signer: &[&[u8]] = &[COMMUNITY_DROP_SEED, authority.as_ref(), mint.as_ref(), &bump];
    if amount > 0 {
        token_interface::transfer_checked(CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            TransferChecked { from:ctx.accounts.vault_token_account.to_account_info(), mint:ctx.accounts.mint.to_account_info(),
                to:ctx.accounts.remainder_token_account.to_account_info(), authority:drop.to_account_info() },
            &[signer],
        ), amount, ctx.accounts.mint.decimals)?;
        ctx.accounts.remainder_token_account.reload()?;
        require!(ctx.accounts.remainder_token_account.amount.checked_sub(recipient_before).is_some_and(|received| received <= amount), ErrorCode::InvalidAmount);
    }
    ctx.accounts.vault_token_account.reload()?;
    require!(ctx.accounts.vault_token_account.amount == 0, ErrorCode::InvalidAmount);
    drop.closed = true;
    emit!(CommunityDropClosed { drop:drop.key(), amount, app_owner:drop.app_owner });
    Ok(())
}

#[event]
pub struct CommunityDropOpened {
    pub drop: Pubkey,
    pub mint: Pubkey,
    pub creator: Pubkey,
    pub eligibility_mint: Pubkey,
    pub migration_slot: u64,
    pub snapshot_slot: u64,
    pub snapshot_hash: [u8; 32],
    pub merkle_root: [u8; 32],
    pub total_amount: u64,
    pub expires_at: i64,
    pub app_owner: Pubkey,
}

#[event]
pub struct CommunityDropClaimed {
    pub drop: Pubkey,
    pub recipient: Pubkey,
    pub amount: u64,
    pub received_amount: u64,
    pub leaf_index: u32,
}

#[event]
pub struct CommunityDropClosed {
    pub drop: Pubkey,
    pub amount: u64,
    pub app_owner: Pubkey,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn community_merkle_proof_and_window() {
        let drop = Pubkey::new_unique();
        let a = leaf(drop, Pubkey::new_unique(), 10, 0);
        let b = leaf(drop, Pubkey::new_unique(), 15, 1);
        let root = if a <= b { hashv(&[&a, &b]).to_bytes() } else { hashv(&[&b, &a]).to_bytes() };
        assert!(proof_valid(a, &[b], &root));
        assert!(proof_valid(b, &[a], &root));
        assert!(!proof_valid(a, &[[0; 32]], &root));
        assert_eq!(COMMUNITY_WINDOW_SECONDS, 7_776_000);
        let mut policy = CommunityDrop {
            protocol_authority:Pubkey::new_unique(), creator:Pubkey::new_unique(), app_owner:Pubkey::new_unique(), mint:Pubkey::new_unique(),
            eligibility_mint:Pubkey::new_unique(), merkle_root:root, snapshot_hash:[1; 32], migration_signature:[1; 64],
            migration_slot:1, snapshot_slot:1, total_amount:25, claimed_amount:0, migration_at:100,
            expires_at:100 + COMMUNITY_WINDOW_SECONDS, leaf_count:2, closed:false, bump:1,
        };
        assert!(!claim_window_open(99, &policy));
        assert!(claim_window_open(100, &policy));
        assert!(claim_window_open(policy.expires_at - 1, &policy));
        assert!(!claim_window_open(policy.expires_at, &policy));
        assert!(!close_eligible(policy.expires_at - 1, &policy));
        assert!(close_eligible(policy.expires_at, &policy));
        policy.closed = true;
        assert!(!claim_window_open(101, &policy));
    }
}
