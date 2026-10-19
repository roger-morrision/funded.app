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
    pub share: u8,
}

impl MintClaimRecord {
    pub const INIT_SPACE: usize = 32 + 32 + 32 + 8 + 8 + 1;
}

#[account]
pub struct MintFeeLedger {
    pub mint: Pubkey,
    pub creator: Pubkey,
    pub creator_spent: u64,
    pub protocol_spent: u64,
    pub bump: u8,
}

impl MintFeeLedger {
    pub const INIT_SPACE: usize = 32 + 32 + 8 + 8 + 1;
}

/// Immutable rates for a v3 mint. The creator receives exactly 8,000,000 of
/// 10,000,000 rate units over the lifetime of the router. The six protocol
/// entries are operations, three referral levels, community, and buyback.
#[account]
pub struct MintFeePolicyV3 {
    pub mint: Pubkey,
    pub creator: Pubkey,
    pub authority: Pubkey, // Initial authority; the global router controls rotations.
    pub protocol_units: [u32; 6],
    pub settled_lamports: u64,
    pub paid_lamports: [u64; 7],
    pub withdrawn_lamports: [u64; 7],
    pub bump: u8,
}

/// Eight categories for new agency launches. Existing seven-category accounts
/// retain their discriminator, seeds, rates and release rules.
#[account]
pub struct MintAgencyPolicyV3 {
    pub mint: Pubkey,
    pub creator: Pubkey,
    pub authority: Pubkey,
    pub protocol_units: [u32; 7],
    pub settled_lamports: u64,
    pub paid_lamports: [u64; 8],
    pub withdrawn_lamports: [u64; 8],
    pub directed_units: [u32; 3],
    pub directed_released: [u64; 3],
    pub selected_agents: u8,
    pub agent_spent: [u64; 3],
    pub completed_agents: u8,
    pub last_promotion_at: i64,
    pub promotion_sequence: u32,
    pub promotion_recipient: Pubkey,
    pub config_revision: u64,
    pub bump: u8,
}

impl MintAgencyPolicyV3 {
    pub const INIT_SPACE: usize = 32 * 4 + 4 * 7 + 8 + 8 * 16 + 4 * 3
        + 8 * 3 + 1 + 8 * 3 + 1 + 8 + 4 + 8 + 1;
}

#[account]
pub struct AgencyConfigV3 {
    pub protocol_units: [u32; 7],
    pub promotion_recipient: Pubkey,
    pub revision: u64,
    pub bump: u8,
}

impl AgencyConfigV3 {
    pub const INIT_SPACE: usize = 4 * 7 + 32 + 8 + 1;
}

#[account]
pub struct MintAgencyClaimV3 {
    pub claim_id: [u8; 32],
    pub mint: Pubkey,
    pub total_lamports: u64,
    pub category_lamports: [u64; 8],
    pub created_at: i64,
}

impl MintAgencyClaimV3 {
    pub const INIT_SPACE: usize = 32 * 2 + 8 * 10;
}

#[account]
pub struct AgencyPromotionV3 {
    pub mint: Pubkey,
    pub post_id: u64,
    pub delivery_hash: [u8; 32],
    pub sequence: u32,
    pub recipient: Pubkey,
    pub amount: u64,
    pub posted_at: i64,
    pub billed_at: i64,
}

impl AgencyPromotionV3 {
    pub const INIT_SPACE: usize = 32 * 3 + 8 * 4 + 4;
}

#[account]
pub struct AgencyBuybackV3 {
    pub buyback_id: [u8; 32],
    pub source_mint: Pubkey,
    pub bought_mint: Pubkey,
    pub pool: Pubkey,
    pub spent_lamports: u64,
    pub burned_base_units: u64,
    pub created_at: i64,
    pub agent: u8,
    pub observation_slot: u64,
    pub market_cap_usd_micros: u64,
    pub observation_hash: [u8; 32],
}

impl AgencyBuybackV3 {
    pub const INIT_SPACE: usize = 32 * 5 + 8 * 5 + 1;
}

impl MintFeePolicyV3 {
    pub const INIT_SPACE: usize = 32 * 3 + 4 * 6 + 8 + 8 * 7 + 8 * 7 + 1;
}

#[account]
pub struct MintClaimRecordV3 {
    pub claim_id: [u8; 32],
    pub mint: Pubkey,
    pub total_lamports: u64,
    pub category_lamports: [u64; 7],
    pub created_at: i64,
}

impl MintClaimRecordV3 {
    pub const INIT_SPACE: usize = 32 + 32 + 8 + 8 * 7 + 8;
}

#[account]
pub struct MintWithdrawalV3 {
    pub withdrawal_id: [u8; 32],
    pub mint: Pubkey,
    pub category: u8,
    pub recipient: Pubkey,
    pub amount: u64,
    pub created_at: i64,
}

impl MintWithdrawalV3 {
    pub const INIT_SPACE: usize = 32 + 32 + 1 + 32 + 8 + 8;
}

#[account]
pub struct MintWithdrawalApprovalV3 {
    pub withdrawal_id: [u8; 32],
    pub mint: Pubkey,
    pub category: u8,
    pub beneficiary: u8,
    pub recipient: Pubkey,
    pub amount: u64,
    pub consumed: bool,
    pub bump: u8,
}

impl MintWithdrawalApprovalV3 {
    pub const INIT_SPACE: usize = 32 + 32 + 1 + 1 + 32 + 8 + 1 + 1;
}

#[account]
pub struct MintBuybackV3 {
    pub buyback_id: [u8; 32],
    pub source_mint: Pubkey,
    pub funded_mint: Pubkey,
    pub pool: Pubkey,
    pub spent_lamports: u64,
    pub burned_base_units: u64,
    pub created_at: i64,
}

impl MintBuybackV3 {
    pub const INIT_SPACE: usize = 32 * 4 + 8 * 3;
}

#[account]
pub struct RewardVault {
    pub authority: Pubkey,
    pub mint: Pubkey,
    pub bump: u8,
}

#[account]
pub struct RewardReserve {
    pub vault: Pubkey,
    pub asset_mint: Pubkey,
    pub outstanding: u64,
    pub bump: u8,
}

impl RewardReserve {
    pub const INIT_SPACE: usize = 32 + 32 + 8 + 1;
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
    pub reserved: bool,
}

impl RewardCycle {
    pub const INIT_SPACE: usize = 32 + 32 + 32 + 32 + 8 + 8 + 8 + 8 + 4 + 1 + 1;
}

#[account]
pub struct RewardPayment {
    pub cycle: Pubkey,
    pub recipient: Pubkey,
    pub amount: u64,
    pub leaf_index: u32,
    pub paid_at: i64,
    pub received_amount: u64,
}

impl RewardPayment {
    pub const INIT_SPACE: usize = 32 + 32 + 8 + 4 + 8 + 8;
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

#[account]
pub struct CommunitySnapshotApproval {
    pub protocol_authority: Pubkey,
    pub creator: Pubkey,
    pub mint: Pubkey,
    pub eligibility_mint: Pubkey,
    pub merkle_root: [u8; 32],
    pub snapshot_hash: [u8; 32],
    pub migration_signature: [u8; 64],
    pub migration_slot: u64,
    pub migration_at: i64,
    pub total_amount: u64,
    pub leaf_count: u32,
    pub bump: u8,
}

impl CommunitySnapshotApproval {
    pub const INIT_SPACE: usize = 6 * 32 + 64 + 3 * 8 + 4 + 1;
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
