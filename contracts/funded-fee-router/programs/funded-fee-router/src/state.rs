use anchor_lang::prelude::*;

#[account]
pub struct ClaimRecord {
    pub claim_id: [u8; 32],
    pub total_lamports: u64,
    pub created_at: i64,
}

impl ClaimRecord {
    pub const INIT_SPACE: usize = 32 + 8 + 8;
}

#[account]
pub struct MintClaimRecord {
    pub claim_id: [u8; 32],
    pub mint: Pubkey,
    pub recipient: Pubkey,
    pub total_lamports: u64,
    pub created_at: i64,
}

impl MintClaimRecord {
    pub const INIT_SPACE: usize = 32 + 32 + 32 + 8 + 8;
}

#[account]
pub struct RewardVault {
    pub authority: Pubkey,
    pub mint: Pubkey,
    pub bump: u8,
}

impl RewardVault {
    pub const INIT_SPACE: usize = 32 + 32 + 1;
}

#[account]
pub struct RewardCycle {
    pub vault: Pubkey,
    pub cycle_id: [u8; 32],
    pub merkle_root: [u8; 32],
    pub asset_mint: Pubkey,
    pub total_amount: u64,
    pub distributed_amount: u64,
    pub cutoff_at: i64,
    pub payout_at: i64,
    pub leaf_count: u32,
    pub bump: u8,
}

impl RewardCycle {
    pub const INIT_SPACE: usize = 32 + 32 + 32 + 32 + 8 + 8 + 8 + 8 + 4 + 1;
}

#[account]
pub struct RewardPayment {
    pub cycle: Pubkey,
    pub recipient: Pubkey,
    pub amount: u64,
    pub leaf_index: u32,
    pub paid_at: i64,
}

impl RewardPayment {
    pub const INIT_SPACE: usize = 32 + 32 + 8 + 4 + 8;
}

#[account]
pub struct CommunityDrop {
    pub protocol_authority: Pubkey,
    pub creator: Pubkey,
    pub app_owner: Pubkey,
    pub mint: Pubkey,
    pub eligibility_mint: Pubkey,
    pub merkle_root: [u8; 32],
    pub snapshot_hash: [u8; 32],
    pub migration_signature: [u8; 64],
    pub migration_slot: u64,
    pub snapshot_slot: u64,
    pub total_amount: u64,
    pub claimed_amount: u64,
    pub migration_at: i64,
    pub expires_at: i64,
    pub leaf_count: u32,
    pub closed: bool,
    pub bump: u8,
}

impl CommunityDrop {
    pub const INIT_SPACE: usize = 7 * 32 + 64 + 6 * 8 + 4 + 2;
}

#[account]
pub struct CommunityPayment {
    pub drop: Pubkey,
    pub recipient: Pubkey,
    pub amount: u64,
    pub leaf_index: u32,
    pub paid_at: i64,
}

impl CommunityPayment {
    pub const INIT_SPACE: usize = 32 + 32 + 8 + 4 + 8;
}
