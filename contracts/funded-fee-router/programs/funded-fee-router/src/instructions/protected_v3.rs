use anchor_lang::prelude::*;
use anchor_lang::solana_program::{program::invoke_signed, system_instruction};

use crate::{constants::*, error::ErrorCode, state::{
    MintFeePolicyV3, MintWithdrawalApprovalV3, MintWithdrawalV3, RewardVault,
}};
use super::{allocation_remainder::advance_ceiling, initialize::create_router_account,
    policy_v3::{category_targets, DisbursementV3Event}, rotate::assert_current_router_authority};

const POLICY_BYTES: usize = 8 + MintFeePolicyV3::INIT_SPACE;
/// magic(8) + units(3*4) + released(3*8) + ceiling(3*8) + remainder(3*8) + pool_base(8)
pub(crate) const EXTENSION_BYTES: usize = 8 + 3 * 4 + 3 * 8 + 3 * 8 + 3 * 8 + 8;
const EXTENSION_MAGIC: &[u8; 8] = b"FNDPROT1";
const DIRECTED_UNITS: u32 = 8_000_000;

pub(crate) struct ProtectedShares {
    pub(crate) units: [u32; 3],
    pub(crate) released: [u64; 3],
    pub(crate) ceiling: [u64; 3],
    pub(crate) remainder: [u64; 3],
    pub(crate) pool_base: u64,
}

pub(crate) fn read_shares(policy: &AccountInfo) -> Result<ProtectedShares> {
    require!(policy.data_len() == POLICY_BYTES + EXTENSION_BYTES,
        ErrorCode::InvalidProtectedMintPolicyV3);
    let data = policy.try_borrow_data()?;
    let tail = &data[POLICY_BYTES..];
    require!(&tail[..8] == EXTENSION_MAGIC, ErrorCode::InvalidProtectedMintPolicyV3);
    let read_u32s = |offset: usize| -> Result<[u32; 3]> {
        let mut out = [0u32; 3];
        for (index, value) in out.iter_mut().enumerate() {
            *value = u32::from_le_bytes(tail[offset + index * 4..offset + 4 + index * 4]
                .try_into().map_err(|_| ErrorCode::InvalidProtectedMintPolicyV3)?);
        }
        Ok(out)
    };
    let read_u64s = |offset: usize| -> Result<[u64; 3]> {
        let mut out = [0u64; 3];
        for (index, value) in out.iter_mut().enumerate() {
            *value = u64::from_le_bytes(tail[offset + index * 8..offset + 8 + index * 8]
                .try_into().map_err(|_| ErrorCode::InvalidProtectedMintPolicyV3)?);
        }
        Ok(out)
    };
    let units = read_u32s(8)?;
    let released = read_u64s(20)?;
    let ceiling = read_u64s(44)?;
    let remainder = read_u64s(68)?;
    let pool_base = u64::from_le_bytes(tail[92..100].try_into().map_err(|_| ErrorCode::InvalidProtectedMintPolicyV3)?);
    require!(units.iter().map(|value| u64::from(*value)).sum::<u64>() == u64::from(DIRECTED_UNITS),
        ErrorCode::InvalidProtectedMintPolicyV3);
    Ok(ProtectedShares { units, released, ceiling, remainder, pool_base })
}

fn write_shares(policy: &AccountInfo, shares: &ProtectedShares) -> Result<()> {
    let mut data = policy.try_borrow_mut_data()?;
    let tail = &mut data[POLICY_BYTES..];
    tail[..8].copy_from_slice(EXTENSION_MAGIC);
    for (index, value) in shares.units.iter().enumerate() {
        tail[8 + index * 4..12 + index * 4].copy_from_slice(&value.to_le_bytes());
    }
    for (index, value) in shares.released.iter().enumerate() {
        tail[20 + index * 8..28 + index * 8].copy_from_slice(&value.to_le_bytes());
    }
    for (index, value) in shares.ceiling.iter().enumerate() {
        tail[44 + index * 8..52 + index * 8].copy_from_slice(&value.to_le_bytes());
    }
    for (index, value) in shares.remainder.iter().enumerate() {
        tail[68 + index * 8..76 + index * 8].copy_from_slice(&value.to_le_bytes());
    }
    tail[92..100].copy_from_slice(&shares.pool_base.to_le_bytes());
    Ok(())
}

#[derive(Accounts)]
pub struct InitializeProtectedMintV3<'info> {
    pub authority: UncheckedAccount<'info>,
    #[account(mut)]
    pub creator: Signer<'info>,
    pub mint: Signer<'info>,
    #[account(seeds = [SEED], bump)]
    pub legacy_router: UncheckedAccount<'info>,
    #[account(mut, seeds = [MINT_ROUTER_V3_SEED, mint.key().as_ref()], bump)]
    pub router: UncheckedAccount<'info>,
    #[account(init, payer = creator, space = POLICY_BYTES + EXTENSION_BYTES,
        seeds = [MINT_POLICY_V3_SEED, mint.key().as_ref()], bump)]
    pub policy: Account<'info, MintFeePolicyV3>,
    pub system_program: Program<'info, System>,
}

pub fn initialize_protected_mint_v3_handler(ctx: Context<InitializeProtectedMintV3>,
    protocol_units: [u32; 6], directed_units: [u32; 3]) -> Result<()> {
    assert_current_router_authority(&ctx.accounts.legacy_router.to_account_info(),
        &ctx.accounts.authority.key(), ctx.program_id)?;
    category_targets(10_000_000, protocol_units)?;
    require!(directed_units.iter().map(|value| u64::from(*value)).sum::<u64>()
        == u64::from(DIRECTED_UNITS), ErrorCode::InvalidProtectedMintPolicyV3);
    let mint = ctx.accounts.mint.key();
    let bump = ctx.bumps.router;
    create_router_account(ctx.accounts.creator.to_account_info(), ctx.accounts.router.to_account_info(),
        ctx.accounts.system_program.to_account_info(), ctx.program_id, MINT_ROUTER_DATA_LEN,
        &[MINT_ROUTER_V3_SEED, mint.as_ref(), &[bump]])?;
    let mut data = ctx.accounts.router.try_borrow_mut_data()?;
    data[0..8].copy_from_slice(MINT_ROUTER_V3_MAGIC);
    data[8] = MINT_ROUTER_V3_VERSION;
    data[9..41].copy_from_slice(&POLICY_HASH);
    data[41..73].copy_from_slice(ctx.accounts.authority.key.as_ref());
    data[73..105].copy_from_slice(mint.as_ref());
    data[105] = bump;
    drop(data);
    let policy = &mut ctx.accounts.policy;
    policy.mint = mint;
    policy.creator = ctx.accounts.creator.key();
    policy.authority = ctx.accounts.authority.key();
    policy.protocol_units = protocol_units;
    policy.settled_lamports = 0;
    policy.paid_lamports = [0; 7];
    policy.withdrawn_lamports = [0; 7];
    policy.bump = ctx.bumps.policy;
    write_shares(&policy.to_account_info(), &ProtectedShares {
        units: directed_units, released: [0; 3],
        ceiling: [0; 3], remainder: [0; 3], pool_base: 0,
    })?;
    Ok(())
}

#[derive(Accounts)]
#[instruction(withdrawal_id: [u8; 32])]
pub struct ApproveProtectedWithdrawalV3<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    /// CHECK: Signature or immutable automation record is required by the handler.
    pub creator: UncheckedAccount<'info>,
    pub mint: UncheckedAccount<'info>,
    #[account(seeds = [SEED], bump)]
    pub legacy_router: UncheckedAccount<'info>,
    #[account(seeds = [MINT_POLICY_V3_SEED, mint.key().as_ref()], bump = policy.bump,
        constraint = policy.mint == mint.key() && policy.creator == creator.key()
            @ ErrorCode::InvalidMintFeePolicyV3)]
    pub policy: Account<'info, MintFeePolicyV3>,
    pub recipient: UncheckedAccount<'info>,
    #[account(init, payer = authority, space = 8 + MintWithdrawalApprovalV3::INIT_SPACE,
        seeds = [MINT_APPROVAL_V3_SEED, mint.key().as_ref(), withdrawal_id.as_ref()], bump)]
    pub approval: Account<'info, MintWithdrawalApprovalV3>,
    pub system_program: Program<'info, System>,
}

pub fn approve_protected_withdrawal_v3_handler(ctx: Context<ApproveProtectedWithdrawalV3>,
    withdrawal_id: [u8; 32], category: u8, beneficiary: u8, amount: u64) -> Result<()> {
    super::automation_v3::authorize(ctx.program_id, &ctx.accounts.creator.to_account_info(),
        &ctx.accounts.mint.key(), &ctx.accounts.policy.key(), category, &ctx.accounts.recipient.key(), ctx.remaining_accounts)?;
    assert_current_router_authority(&ctx.accounts.legacy_router.to_account_info(),
        &ctx.accounts.authority.key(), ctx.program_id)?;
    read_shares(&ctx.accounts.policy.to_account_info())?;
    require!(amount > 0 && (1..=4).contains(&category) && beneficiary == category + 2,
        ErrorCode::InvalidMintApprovalV3);
    let recipient = &ctx.accounts.recipient;
    require!(recipient.owner == &System::id() && recipient.data_is_empty()
        && recipient.key() != ctx.accounts.creator.key(), ErrorCode::InvalidMintApprovalV3);
    let approval = &mut ctx.accounts.approval;
    approval.withdrawal_id = withdrawal_id;
    approval.mint = ctx.accounts.mint.key();
    approval.category = category;
    approval.beneficiary = beneficiary;
    approval.recipient = recipient.key();
    approval.amount = amount;
    approval.consumed = false;
    approval.bump = ctx.bumps.approval;
    approval.created_at = Clock::get()?.unix_timestamp;
    emit!(MintWithdrawalApprovalV3Event { mint:approval.mint, withdrawal_id,
        category, beneficiary, recipient:approval.recipient, amount });
    Ok(())
}

#[event]
pub struct MintWithdrawalApprovalV3Event {
    pub mint: Pubkey,
    pub withdrawal_id: [u8; 32],
    pub category: u8,
    pub beneficiary: u8,
    pub recipient: Pubkey,
    pub amount: u64,
}

#[derive(Accounts)]
#[instruction(withdrawal_id: [u8; 32], category: u8)]
pub struct DisburseProtectedMintV3<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    /// CHECK: Signature or immutable automation record is required by the handler.
    pub creator: UncheckedAccount<'info>,
    pub mint: UncheckedAccount<'info>,
    #[account(seeds = [SEED], bump)]
    pub legacy_router: UncheckedAccount<'info>,
    #[account(mut, seeds = [MINT_POLICY_V3_SEED, mint.key().as_ref()], bump = policy.bump,
        constraint = policy.mint == mint.key() && policy.creator == creator.key()
            @ ErrorCode::InvalidMintFeePolicyV3)]
    pub policy: Account<'info, MintFeePolicyV3>,
    #[account(mut, seeds = [MINT_VAULT_V3_SEED, mint.key().as_ref(), &[category]], bump)]
    pub vault: UncheckedAccount<'info>,
    #[account(mut)]
    pub recipient: UncheckedAccount<'info>,
    #[account(mut, seeds = [MINT_APPROVAL_V3_SEED, mint.key().as_ref(), withdrawal_id.as_ref()], bump)]
    pub approval: UncheckedAccount<'info>,
    #[account(init, payer = authority, space = 8 + MintWithdrawalV3::INIT_SPACE,
        seeds = [MINT_WITHDRAWAL_V3_SEED, mint.key().as_ref(), withdrawal_id.as_ref()], bump)]
    pub withdrawal: Account<'info, MintWithdrawalV3>,
    pub system_program: Program<'info, System>,
}

pub fn disburse_protected_mint_v3_handler(ctx: Context<DisburseProtectedMintV3>,
    withdrawal_id: [u8; 32], category: u8, beneficiary: u8, amount: u64,
    holder_amount: u64) -> Result<()> {
    super::automation_v3::authorize(ctx.program_id, &ctx.accounts.creator.to_account_info(),
        &ctx.accounts.mint.key(), &ctx.accounts.policy.key(), category, &ctx.accounts.recipient.key(), ctx.remaining_accounts)?;
    assert_current_router_authority(&ctx.accounts.legacy_router.to_account_info(),
        &ctx.accounts.authority.key(), ctx.program_id)?;
    require!(category < 6 && amount > 0, ErrorCode::InvalidMintWithdrawalV3);
    let policy_info = ctx.accounts.policy.to_account_info();
    let mut shares = read_shares(&policy_info)?;
    let policy = &mut ctx.accounts.policy;
    let index = usize::from(category);
    let new_withdrawn = policy.withdrawn_lamports[index]
        .checked_add(amount).ok_or(ErrorCode::AmountOverflow)?;
    require!(new_withdrawn <= policy.paid_lamports[index], ErrorCode::MintWithdrawalBudgetExceededV3);
    let vault = &ctx.accounts.vault;
    let reserve = Rent::get()?.minimum_balance(0);
    require!(vault.owner == &System::id() && vault.data_is_empty()
        && vault.lamports().saturating_sub(reserve) >= amount,
        ErrorCode::InsufficientMintVaultV3);
    let mint = ctx.accounts.mint.key();
    let recipient = &ctx.accounts.recipient;
    let recipient_key = recipient.key();
    let needs_approval = (1..=4).contains(&category);
    if category == 0 {
        require!(beneficiary < 2, ErrorCode::InvalidProtectedMintPolicyV3);
        advance_ceiling(policy.paid_lamports[0], shares.units, DIRECTED_UNITS,
            &mut shares.pool_base, &mut shares.remainder, &mut shares.ceiling)?;
        if beneficiary == 0 {
            require!(holder_amount == 0, ErrorCode::InvalidProtectedMintPolicyV3);
            shares.released[0] = shares.released[0].checked_add(amount)
                .ok_or(ErrorCode::AmountOverflow)?;
            require!(recipient_key == ctx.accounts.creator.key()
                && recipient.owner == &System::id() && recipient.data_is_empty(),
                ErrorCode::InvalidMintWithdrawalV3);
        } else {
            require!(holder_amount <= amount, ErrorCode::InvalidProtectedMintPolicyV3);
            shares.released[1] = shares.released[1].checked_add(holder_amount)
                .ok_or(ErrorCode::AmountOverflow)?;
            shares.released[2] = shares.released[2].checked_add(amount - holder_amount)
                .ok_or(ErrorCode::AmountOverflow)?;
        }
        require!(shares.released.iter().zip(shares.ceiling).all(|(released, target)| *released <= target),
            ErrorCode::MintWithdrawalBudgetExceededV3);
    } else {
        require!(beneficiary == category + 2, ErrorCode::InvalidProtectedMintPolicyV3);
        require!(holder_amount == 0, ErrorCode::InvalidProtectedMintPolicyV3);
    }
    if category == 0 && beneficiary == 1 || category == 5 {
        let (expected, bump) = Pubkey::find_program_address(
            &[REWARD_VAULT_SEED, ctx.accounts.authority.key.as_ref(), mint.as_ref()], ctx.program_id);
        require!(recipient_key == expected && recipient.owner == ctx.program_id,
            ErrorCode::InvalidMintWithdrawalV3);
        let reward = RewardVault::try_deserialize(&mut &recipient.try_borrow_data()?[..])?;
        require!(reward.authority == ctx.accounts.authority.key()
            && reward.mint == mint && reward.bump == bump, ErrorCode::InvalidMintWithdrawalV3);
    }
    if needs_approval {
        require!(recipient.owner == &System::id() && recipient.data_is_empty()
            && ctx.accounts.approval.owner == ctx.program_id, ErrorCode::InvalidMintApprovalV3);
        let mut data = ctx.accounts.approval.try_borrow_mut_data()?;
        let mut record = MintWithdrawalApprovalV3::try_deserialize(&mut &data[..])?;
        require!(record.withdrawal_id == withdrawal_id && record.mint == mint
            && record.category == category && record.beneficiary == beneficiary
            && record.recipient == recipient_key && record.amount == amount
            && !record.consumed && record.bump == ctx.bumps.approval,
            ErrorCode::InvalidMintApprovalV3);
        // The automation-record bypass (no live creator signature) leaves the
        // guardian a review window between approval and disbursement, the same
        // way a new reward cycle leaves REWARD_CYCLE_MIN_DELAY_SECONDS before
        // payout. A creator who actually signs is unaffected.
        if cfg!(feature = "mainnet-v3-program") && !ctx.accounts.creator.to_account_info().is_signer {
            let earliest = record.created_at.checked_add(AUTOMATION_WITHDRAWAL_REVIEW_DELAY_SECONDS)
                .ok_or(ErrorCode::AmountOverflow)?;
            require!(Clock::get()?.unix_timestamp >= earliest, ErrorCode::AutomationWithdrawalReviewPending);
        }
        record.consumed = true;
        record.try_serialize(&mut &mut data[..])?;
    }
    let (router, _) = Pubkey::find_program_address(&[MINT_ROUTER_V3_SEED, mint.as_ref()], ctx.program_id);
    require!(recipient_key != router, ErrorCode::InvalidMintWithdrawalV3);
    for other in 0..7 {
        let (vault_key, _) = Pubkey::find_program_address(
            &[MINT_VAULT_V3_SEED, mint.as_ref(), &[other]], ctx.program_id);
        require!(recipient_key != vault_key, ErrorCode::InvalidMintWithdrawalV3);
    }
    // Only operations spending consumes the administrative cap. Creator,
    // X-account, referral and holder entitlements remain uncapped.
    #[cfg(feature = "mainnet-v3-program")]
    if category == 1 {
        super::guard::record_outflow(&ctx.accounts.legacy_router.to_account_info(), amount)?;
    }
    let category_seed = [category];
    let bump = [ctx.bumps.vault];
    invoke_signed(&system_instruction::transfer(&vault.key(), &recipient_key, amount),
        &[vault.to_account_info(), recipient.to_account_info(), ctx.accounts.system_program.to_account_info()],
        &[&[MINT_VAULT_V3_SEED, mint.as_ref(), &category_seed, &bump]])?;
    policy.withdrawn_lamports[index] = new_withdrawn;
    write_shares(&policy_info, &shares)?;
    let receipt = &mut ctx.accounts.withdrawal;
    receipt.withdrawal_id = withdrawal_id;
    receipt.mint = mint;
    receipt.category = category;
    receipt.recipient = recipient_key;
    receipt.amount = amount;
    receipt.created_at = Clock::get()?.unix_timestamp;
    emit!(DisbursementV3Event { mint, withdrawal_id, category, recipient:recipient_key, amount });
    Ok(())
}
