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
