pub mod constants;
pub mod error;
pub mod instructions;
pub mod state;

use anchor_lang::prelude::*;

pub use constants::*;
pub use instructions::*;
pub use state::*;

declare_id!("2tRrwGFzRCDmrVY7U6dny4Ea1RqVm7cSrCYFULmK7tik");

#[program]
pub mod funded_fee_router {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        initialize::handler(ctx)
    }

    pub fn initialize_mint(ctx: Context<InitializeMint>) -> Result<()> {
        initialize::mint_handler(ctx)
    }

    pub fn settle(ctx: Context<Settle>, claim_id: [u8; 32], amounts: Vec<u64>) -> Result<()> {
        settle::handler(ctx, claim_id, amounts)
    }

    pub fn settle_mint(ctx: Context<SettleMint>, claim_id: [u8; 32], amounts: Vec<u64>) -> Result<()> {
        settle::mint_handler(ctx, claim_id, amounts)
    }

    pub fn repair_header(ctx: Context<RepairHeader>) -> Result<()> {
        repair::handler(ctx)
    }

    pub fn initialize_reward_vault(ctx: Context<InitializeRewardVault>) -> Result<()> {
        reward::initialize_vault(ctx)
    }

    pub fn create_reward_cycle(
        ctx: Context<CreateRewardCycle>,
        cycle_id: [u8; 32],
        merkle_root: [u8; 32],
        asset_mint: Pubkey,
        total_amount: u64,
        cutoff_at: i64,
        payout_at: i64,
        leaf_count: u32,
    ) -> Result<()> {
        reward::create_cycle(ctx, cycle_id, merkle_root, asset_mint, total_amount, cutoff_at, payout_at, leaf_count)
    }

    pub fn payout_reward_sol(
        ctx: Context<PayoutRewardSol>,
        amount: u64,
        leaf_index: u32,
        proof: Vec<[u8; 32]>,
    ) -> Result<()> {
        reward::payout_sol(ctx, amount, leaf_index, proof)
    }

    pub fn payout_reward_token(
        ctx: Context<PayoutRewardToken>,
        amount: u64,
        leaf_index: u32,
        proof: Vec<[u8; 32]>,
    ) -> Result<()> {
        reward::payout_token(ctx, amount, leaf_index, proof)
    }
}
