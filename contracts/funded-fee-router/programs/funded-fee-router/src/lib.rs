pub mod constants;
pub mod error;
pub mod instructions;
pub mod state;

use anchor_lang::prelude::*;

pub use constants::*;
pub use instructions::*;
pub use state::*;

declare_id!("C92L1A3ZkS9Nnau5JLAMwMUYxPSYVUTdeosHyc6WMA8W");

#[program]
pub mod funded_fee_router {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        initialize::handler(ctx)
    }

    pub fn settle(ctx: Context<Settle>, claim_id: [u8; 32], amounts: Vec<u64>) -> Result<()> {
        settle::handler(ctx, claim_id, amounts)
    }

    pub fn repair_header(ctx: Context<RepairHeader>) -> Result<()> {
        repair::handler(ctx)
    }
}
