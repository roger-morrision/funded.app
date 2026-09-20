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
