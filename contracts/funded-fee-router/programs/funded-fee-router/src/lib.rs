pub mod constants;
pub mod error;
pub mod instructions;
pub mod state;

use anchor_lang::prelude::*;

pub use constants::*;
pub use instructions::*;
pub use state::*;

#[cfg(not(feature = "devnet-v3-program"))]
declare_id!("61EQ3onuS2jKzjUDhXdkwKNGiG8Djss3an5vPN3vwYYa");
#[cfg(feature = "devnet-v3-program")]
declare_id!("9H1r2nTZs6gQaheYTMaBWpH12JX6dCFj2Rvxg7Lno2Sm");

#[program]
pub mod funded_fee_router {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        initialize::handler(ctx)
    }

    #[cfg(not(feature = "devnet-v3-program"))]
    pub fn initialize_mint(ctx: Context<InitializeMint>) -> Result<()> {
        initialize::mint_handler(ctx)
    }

    pub fn initialize_mint_v3(ctx: Context<InitializeMintV3>, protocol_units: [u32; 6]) -> Result<()> {
        policy_v3::initialize_mint_v3_handler(ctx, protocol_units)
    }

    pub fn settle_mint_v3<'info>(ctx: Context<'info, SettleMintV3<'info>>,
        claim_id: [u8; 32], expected_lamports: u64) -> Result<()> {
        policy_v3::settle_mint_v3_handler(ctx, claim_id, expected_lamports)
    }

    pub fn disburse_mint_v3(ctx: Context<DisburseMintV3>, withdrawal_id: [u8; 32], category: u8, amount: u64) -> Result<()> {
        policy_v3::disburse_mint_v3_handler(ctx, withdrawal_id, category, amount)
    }

    #[cfg(feature = "devnet-v3-program")]
    pub fn buyback_mint_v3<'info>(ctx: Context<'info, BuybackMintV3<'info>>,
        buyback_id: [u8; 32], spendable_quote_in: u64,
        min_base_amount_out: u64, max_total_debit: u64) -> Result<()> {
        buyback_v3::handler(ctx, buyback_id, spendable_quote_in,
            min_base_amount_out, max_total_debit)
    }

    #[cfg(not(feature = "devnet-v3-program"))]
    pub fn migrate_mint_fee_ledger(ctx: Context<MigrateMintFeeLedger>, historical_creator_spent: u64,
        historical_protocol_spent: u64, expected_available_lamports: u64) -> Result<()> {
        initialize::migrate_mint_fee_ledger_handler(ctx, historical_creator_spent,
            historical_protocol_spent, expected_available_lamports)
    }

    #[cfg(not(feature = "devnet-v3-program"))]
    pub fn settle(ctx: Context<Settle>, claim_id: [u8; 32], amounts: Vec<u64>) -> Result<()> {
        settle::handler(ctx, claim_id, amounts)
    }

    #[cfg(not(feature = "devnet-v3-program"))]
    pub fn settle_mint(ctx: Context<SettleMint>, claim_id: [u8; 32], amounts: Vec<u64>, share: u8) -> Result<()> {
        settle::mint_handler(ctx, claim_id, amounts, share)
    }

    #[cfg(not(feature = "devnet-v3-program"))]
    pub fn recover_mint_wrapped_sol(ctx: Context<RecoverMintWrappedSol>) -> Result<()> {
        recover_wrapped_sol::handler(ctx)
    }

    #[cfg(not(feature = "devnet-v3-program"))]
    pub fn repair_header(ctx: Context<RepairHeader>) -> Result<()> {
        repair::handler(ctx)
    }

    pub fn rotate_authority(ctx: Context<RotateAuthority>) -> Result<()> {
        rotate::handler(ctx)
    }

    pub fn initialize_reward_vault(ctx: Context<InitializeRewardVault>) -> Result<()> {
        reward::initialize_vault(ctx)
    }

    pub fn initialize_reward_reserve(ctx: Context<InitializeRewardReserve>, asset_mint: Pubkey) -> Result<()> {
        reward::initialize_reserve(ctx, asset_mint)
    }

    #[cfg(not(feature = "devnet-v3-program"))]
    pub fn migrate_reward_cycle_sol(ctx: Context<MigrateRewardCycleSol>, cycle_id: [u8; 32]) -> Result<()> {
        reward::migrate_cycle_sol(ctx, cycle_id)
    }

    #[cfg(not(feature = "devnet-v3-program"))]
    pub fn migrate_reward_cycle_token(ctx: Context<MigrateRewardCycleToken>, cycle_id: [u8; 32]) -> Result<()> {
        reward::migrate_cycle_token(ctx, cycle_id)
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

    pub fn create_reward_cycle_token(
        ctx: Context<CreateRewardCycleToken>,
        cycle_id: [u8; 32],
        merkle_root: [u8; 32],
        asset_mint: Pubkey,
        total_amount: u64,
        cutoff_at: i64,
        payout_at: i64,
        leaf_count: u32,
    ) -> Result<()> {
        reward::create_cycle_token(ctx, cycle_id, merkle_root, asset_mint, total_amount, cutoff_at, payout_at, leaf_count)
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

    pub fn approve_community_snapshot(
        ctx: Context<ApproveCommunitySnapshot>, merkle_root: [u8; 32], snapshot_hash: [u8; 32],
        migration_signature: [u8; 64], migration_slot: u64, migration_at: i64,
        total_amount: u64, leaf_count: u32,
    ) -> Result<()> {
        community::approve_snapshot(ctx, merkle_root, snapshot_hash, migration_signature,
            migration_slot, migration_at, total_amount, leaf_count)
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
