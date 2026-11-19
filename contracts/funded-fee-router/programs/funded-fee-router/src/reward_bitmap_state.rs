use anchor_lang::prelude::*;

#[account]
pub struct RewardBitmapCycle {
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
    pub paid: Vec<u8>,
}

impl RewardBitmapCycle {
    pub const MAX_LEAVES: u32 = 65_536;
    pub fn space(leaves: u32) -> usize { 174 + 4 + (leaves.min(Self::MAX_LEAVES) as usize + 7) / 8 }
}
