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

    pub fn recover_mint_wrapped_sol(ctx: Context<RecoverMintWrappedSol>) -> Result<()> {
        recover_wrapped_sol::handler(ctx)
    }

    pub fn repair_header(ctx: Context<RepairHeader>) -> Result<()> {
        repair::handler(ctx)
    }

    pub fn rotate_authority(ctx: Context<RotateAuthority>) -> Result<()> {
        rotate::handler(ctx)
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

    pub fn initialize_community_drop(
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
        community::initialize_drop(ctx, merkle_root, snapshot_hash, migration_signature, migration_slot, snapshot_slot, migration_at, total_amount, leaf_count)
    }

    pub fn initialize_community_drop_from_reward_vault(
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
        community::initialize_drop_from_reward_vault(ctx, merkle_root, snapshot_hash, migration_signature,
            migration_slot, snapshot_slot, migration_at, total_amount, leaf_count)
    }

    pub fn claim_community_drop(ctx: Context<ClaimCommunityDrop>, amount: u64, leaf_index: u32, proof: Vec<[u8; 32]>) -> Result<()> {
        community::claim(ctx, amount, leaf_index, proof)
    }

    pub fn close_community_drop(ctx: Context<CloseCommunityDrop>) -> Result<()> {
        community::close(ctx)
    }
}
