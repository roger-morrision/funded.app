use anchor_lang::prelude::*;
use anchor_lang::solana_program::{program::invoke, system_instruction};
use crate::{constants::*, error::ErrorCode, state::{AgencyConfigV3, MintAgencyPolicyV3, MintAgencyClaimV3}};
use super::{initialize::create_router_account, rotate::assert_current_router_authority};

pub const AGENCY_CONFIG_SEED: &[u8] = b"agency-config-v3";
pub const AGENCY_POLICY_SEED: &[u8] = b"mint-agency-policy-v3";
pub const AGENCY_UNITS: u32 = 200_000;

// Creator, operations, three referral levels, Daily bonus, FUNDED buyback,
// agency. No saved seven-category policy is reinterpreted as this layout.
pub fn agency_category_targets(total: u64, units: [u32; 7]) -> Result<[u64; 8]> {
    require!(units[6] == AGENCY_UNITS, ErrorCode::InvalidAgencyPolicyV3);
    let mut cumulative = 8_000_000u32;
    let mut prior = 0u64;
    let mut result = [0u64; 8];
    for index in 0..8 {
        if index > 0 { cumulative = cumulative.checked_add(units[index - 1])
            .ok_or(ErrorCode::InvalidProtocolFeeRates)?; }
        require!(cumulative <= 10_000_000, ErrorCode::InvalidProtocolFeeRates);
        let boundary = u64::try_from(u128::from(total) * u128::from(cumulative) / 10_000_000)
            .map_err(|_| ErrorCode::AmountOverflow)?;
        result[index] = boundary.checked_sub(prior).ok_or(ErrorCode::AmountOverflow)?;
        prior = boundary;
    }
    require!(cumulative == 10_000_000, ErrorCode::InvalidProtocolFeeRates);
    Ok(result)
}

pub fn agent_targets(total: u64, selected: u8) -> Result<[u64; 3]> {
    require!(selected & !7 == 0, ErrorCode::InvalidAgencyPolicyV3);
    let count = selected.count_ones();
    let mut result = [0u64; 3];
    let mut ordinal = 0u32;
    let mut prior = 0u64;
    for (index, amount) in result.iter_mut().enumerate() {
        if selected & (1 << index) == 0 { continue; }
        ordinal += 1;
        let boundary = u64::try_from(u128::from(total) * u128::from(ordinal) / u128::from(count))
            .map_err(|_| ErrorCode::AmountOverflow)?;
        *amount = boundary.checked_sub(prior).ok_or(ErrorCode::AmountOverflow)?;
        prior = boundary;
    }
    Ok(result) // No selection retains the full budget in the agency vault.
}

#[derive(Accounts)]
pub struct InitializeAgencyConfigV3<'info> {
    #[account(mut)] pub authority: Signer<'info>,
    #[account(seeds = [SEED], bump)] pub legacy_router: UncheckedAccount<'info>,
    #[account(init, payer = authority, space = 8 + AgencyConfigV3::INIT_SPACE,
        seeds = [AGENCY_CONFIG_SEED], bump)]
    pub config: Account<'info, AgencyConfigV3>,
    pub system_program: Program<'info, System>,
}

pub fn initialize_config(ctx: Context<InitializeAgencyConfigV3>, units: [u32; 7], recipient: Pubkey) -> Result<()> {
    assert_current_router_authority(&ctx.accounts.legacy_router.to_account_info(), &ctx.accounts.authority.key(), ctx.program_id)?;
    agency_category_targets(10_000_000, units)?;
    require!(recipient != Pubkey::default(), ErrorCode::InvalidAgencyPolicyV3);
    let config = &mut ctx.accounts.config;
    config.protocol_units = units; config.promotion_recipient = recipient;
    config.revision = 1; config.bump = ctx.bumps.config;
    Ok(())
}

#[derive(Accounts)]
pub struct UpdateAgencyConfigV3<'info> {
    pub authority: Signer<'info>,
    #[account(seeds = [SEED], bump)] pub legacy_router: UncheckedAccount<'info>,
    #[account(mut, seeds = [AGENCY_CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, AgencyConfigV3>,
}

pub fn update_config(ctx: Context<UpdateAgencyConfigV3>, units: [u32; 7], recipient: Pubkey, expected_revision: u64) -> Result<()> {
    assert_current_router_authority(&ctx.accounts.legacy_router.to_account_info(), &ctx.accounts.authority.key(), ctx.program_id)?;
    agency_category_targets(10_000_000, units)?;
    require!(recipient != Pubkey::default() && expected_revision == ctx.accounts.config.revision, ErrorCode::InvalidAgencyPolicyV3);
    let config = &mut ctx.accounts.config;
    config.protocol_units = units; config.promotion_recipient = recipient;
    config.revision = config.revision.checked_add(1).ok_or(ErrorCode::AmountOverflow)?;
    Ok(()) // Existing mints retain their copied immutable configuration.
}

#[derive(Accounts)]
pub struct InitializeAgencyMintV3<'info> {
    pub authority: UncheckedAccount<'info>,
    #[account(mut)] pub creator: Signer<'info>,
    pub mint: Signer<'info>,
    #[account(seeds = [SEED], bump)] pub legacy_router: UncheckedAccount<'info>,
    #[account(seeds = [AGENCY_CONFIG_SEED], bump = config.bump)] pub config: Account<'info, AgencyConfigV3>,
    #[account(mut, seeds = [MINT_ROUTER_V3_SEED, mint.key().as_ref()], bump)] pub router: UncheckedAccount<'info>,
    #[account(init, payer = creator, space = 8 + MintAgencyPolicyV3::INIT_SPACE,
        seeds = [AGENCY_POLICY_SEED, mint.key().as_ref()], bump)] pub policy: Account<'info, MintAgencyPolicyV3>,
    pub system_program: Program<'info, System>,
}

pub fn initialize_mint(ctx: Context<InitializeAgencyMintV3>, directed_units: [u32; 3], selected_agents: u8, config_revision: u64) -> Result<()> {
    assert_current_router_authority(&ctx.accounts.legacy_router.to_account_info(), &ctx.accounts.authority.key(), ctx.program_id)?;
    agency_category_targets(10_000_000, ctx.accounts.config.protocol_units)?;
    require!(directed_units.iter().map(|n| u64::from(*n)).sum::<u64>() == 8_000_000
        && selected_agents & !7 == 0 && config_revision == ctx.accounts.config.revision,
        ErrorCode::InvalidAgencyPolicyV3);
    let mint = ctx.accounts.mint.key(); let bump = ctx.bumps.router;
    // The same router PDA prevents a second initialization using old policy routes.
    create_router_account(ctx.accounts.creator.to_account_info(), ctx.accounts.router.to_account_info(),
        ctx.accounts.system_program.to_account_info(), ctx.program_id, MINT_ROUTER_DATA_LEN,
        &[MINT_ROUTER_V3_SEED, mint.as_ref(), &[bump]])?;
    let mut data = ctx.accounts.router.try_borrow_mut_data()?;
    data[..8].copy_from_slice(MINT_ROUTER_V3_MAGIC); data[8] = MINT_ROUTER_V3_VERSION;
    data[9..41].copy_from_slice(&POLICY_HASH); data[41..73].copy_from_slice(ctx.accounts.authority.key.as_ref());
    data[73..105].copy_from_slice(mint.as_ref()); data[105] = bump; drop(data);
    let policy = &mut ctx.accounts.policy;
    policy.mint = mint; policy.creator = ctx.accounts.creator.key(); policy.authority = ctx.accounts.authority.key();
    policy.protocol_units = ctx.accounts.config.protocol_units; policy.settled_lamports = 0;
    policy.paid_lamports = [0; 8]; policy.withdrawn_lamports = [0; 8];
    policy.directed_units = directed_units; policy.directed_released = [0; 3];
    policy.selected_agents = selected_agents; policy.agent_spent = [0; 3]; policy.completed_agents = 0;
    policy.last_promotion_at = 0; policy.promotion_sequence = 0;
    policy.promotion_recipient = ctx.accounts.config.promotion_recipient;
    policy.config_revision = config_revision; policy.bump = ctx.bumps.policy;
    Ok(())
}

#[derive(Accounts)]
#[instruction(claim_id: [u8; 32])]
pub struct SettleAgencyMintV3<'info> {
    #[account(mut)] pub authority: Signer<'info>,
    pub creator: Signer<'info>,
    pub mint: UncheckedAccount<'info>,
    #[account(seeds = [SEED], bump)] pub legacy_router: UncheckedAccount<'info>,
    #[account(mut, seeds = [MINT_ROUTER_V3_SEED, mint.key().as_ref()], bump)] pub router: UncheckedAccount<'info>,
    #[account(mut, seeds = [AGENCY_POLICY_SEED, mint.key().as_ref()], bump = policy.bump,
        constraint = policy.mint == mint.key() && policy.creator == creator.key() @ ErrorCode::InvalidAgencyPolicyV3)]
    pub policy: Account<'info, MintAgencyPolicyV3>,
    #[account(init, payer = authority, space = 8 + MintAgencyClaimV3::INIT_SPACE,
        seeds = [MINT_CLAIM_V3_SEED, mint.key().as_ref(), claim_id.as_ref()], bump)] pub claim: Account<'info, MintAgencyClaimV3>,
    pub system_program: Program<'info, System>,
}

pub fn settle<'info>(ctx: Context<'info, SettleAgencyMintV3<'info>>, claim_id: [u8; 32], expected_lamports: u64) -> Result<()> {
    assert_current_router_authority(&ctx.accounts.legacy_router.to_account_info(), &ctx.accounts.authority.key(), ctx.program_id)?;
    let mint = ctx.accounts.mint.key(); let router = &ctx.accounts.router;
    require!(router.owner == ctx.program_id && router.data_len() == MINT_ROUTER_DATA_LEN, ErrorCode::InvalidMintRouter);
    let data = router.try_borrow_data()?;
    require!(&data[..8] == MINT_ROUTER_V3_MAGIC && data[8] == MINT_ROUTER_V3_VERSION
        && data[9..41] == POLICY_HASH && data[41..73] == ctx.accounts.policy.authority.to_bytes()
        && data[73..105] == mint.to_bytes() && data[105] == ctx.bumps.router, ErrorCode::InvalidMintRouter); drop(data);
    require!(expected_lamports > 0 && router.lamports().saturating_sub(Rent::get()?.minimum_balance(MINT_ROUTER_DATA_LEN)) >= expected_lamports,
        ErrorCode::MintClaimAmountMismatchV3);
    require!(ctx.remaining_accounts.len() == 8, ErrorCode::InvalidAgencyPolicyV3);
    let policy = &mut ctx.accounts.policy;
    let total = policy.settled_lamports.checked_add(expected_lamports).ok_or(ErrorCode::AmountOverflow)?;
    let targets = agency_category_targets(total, policy.protocol_units)?;
    let mut delta = [0u64; 8]; let reserve = Rent::get()?.minimum_balance(0);
    for (index, vault) in ctx.remaining_accounts.iter().enumerate() {
        let (expected, _) = Pubkey::find_program_address(&[MINT_VAULT_V3_SEED, mint.as_ref(), &[index as u8]], ctx.program_id);
        require!(vault.key() == expected && vault.is_writable && vault.owner == &System::id() && vault.data_is_empty(), ErrorCode::InvalidMintFeeVaultV3);
        delta[index] = targets[index].checked_sub(policy.paid_lamports[index]).ok_or(ErrorCode::AmountOverflow)?;
        if delta[index] > 0 {
            if vault.lamports() < reserve { invoke(&system_instruction::transfer(&ctx.accounts.authority.key(), &vault.key(), reserve - vault.lamports()),
                &[ctx.accounts.authority.to_account_info(), vault.clone(), ctx.accounts.system_program.to_account_info()])?; }
            let router_balance = router.lamports().checked_sub(delta[index]).ok_or(ErrorCode::AmountOverflow)?;
            let vault_balance = vault.lamports().checked_add(delta[index]).ok_or(ErrorCode::AmountOverflow)?;
            **router.try_borrow_mut_lamports()? = router_balance;
            **vault.try_borrow_mut_lamports()? = vault_balance;
        }
    }
    policy.settled_lamports = total; policy.paid_lamports = targets;
    let claim = &mut ctx.accounts.claim; claim.claim_id = claim_id; claim.mint = mint;
    claim.total_lamports = expected_lamports; claim.category_lamports = delta; claim.created_at = Clock::get()?.unix_timestamp;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    const UNITS: [u32; 7] = [800_000, 66_670, 20_000, 13_330, 400_000, 500_000, 200_000];
    #[test] fn policy_conserves_and_separates_agency() {
        assert_eq!(agency_category_targets(10_000_000, UNITS).unwrap(), [8_000_000,800_000,66_670,20_000,13_330,400_000,500_000,200_000]);
        for total in [1,2,49,50,99,1_000_002,u64::MAX] { assert_eq!(agency_category_targets(total,UNITS).unwrap().iter().map(|v| u128::from(*v)).sum::<u128>(), u128::from(total)); }
        let mut bad=UNITS; bad[6]=0; assert!(agency_category_targets(10_000_000,bad).is_err());
    }
    #[test] fn selected_agents_have_distinct_exact_cumulative_caps() {
        assert_eq!(agent_targets(10,7).unwrap(),[3,3,4]); assert_eq!(agent_targets(10,5).unwrap(),[5,0,5]);
        assert_eq!(agent_targets(10,0).unwrap(),[0,0,0]); assert!(agent_targets(10,8).is_err());
    }
}
