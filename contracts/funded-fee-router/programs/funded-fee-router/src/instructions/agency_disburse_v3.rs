use anchor_lang::prelude::*;
use anchor_lang::solana_program::{program::invoke_signed, system_instruction};
use crate::{constants::*, error::ErrorCode, state::{MintAgencyPolicyV3, MintWithdrawalApprovalV3, MintWithdrawalV3, RewardVault, AgencyPromotionV3}};
use super::{agency_policy_v3::{AGENCY_POLICY_SEED,agent_targets}, rotate::assert_current_router_authority};

#[derive(Accounts)]
#[instruction(withdrawal_id: [u8; 32])]
pub struct ApproveAgencyWithdrawalV3<'info> {
    #[account(mut)] pub authority: Signer<'info>,
    pub creator: Signer<'info>, pub mint: UncheckedAccount<'info>,
    #[account(seeds = [SEED], bump)] pub legacy_router: UncheckedAccount<'info>,
    #[account(seeds = [AGENCY_POLICY_SEED, mint.key().as_ref()], bump = policy.bump,
        constraint = policy.mint == mint.key() && policy.creator == creator.key() @ ErrorCode::InvalidAgencyPolicyV3)]
    pub policy: Account<'info, MintAgencyPolicyV3>,
    pub recipient: UncheckedAccount<'info>,
    #[account(init, payer = authority, space = 8 + MintWithdrawalApprovalV3::INIT_SPACE,
        seeds = [MINT_APPROVAL_V3_SEED, mint.key().as_ref(), withdrawal_id.as_ref()], bump)]
    pub approval: Account<'info, MintWithdrawalApprovalV3>,
    pub system_program: Program<'info, System>,
}

pub fn approve(ctx: Context<ApproveAgencyWithdrawalV3>, withdrawal_id: [u8; 32], category: u8, beneficiary: u8, amount: u64) -> Result<()> {
    assert_current_router_authority(&ctx.accounts.legacy_router.to_account_info(), &ctx.accounts.authority.key(), ctx.program_id)?;
    require!(amount > 0 && (1..=4).contains(&category) && beneficiary == category + 2, ErrorCode::InvalidMintApprovalV3);
    let recipient = &ctx.accounts.recipient;
    require!(recipient.owner == &System::id() && recipient.data_is_empty() && recipient.key() != ctx.accounts.creator.key(), ErrorCode::InvalidMintApprovalV3);
    let approval = &mut ctx.accounts.approval;
    approval.withdrawal_id = withdrawal_id; approval.mint = ctx.accounts.mint.key();
    approval.category = category; approval.beneficiary = beneficiary;
    approval.recipient = recipient.key(); approval.amount = amount; approval.consumed = false; approval.bump = ctx.bumps.approval;
    Ok(())
}

#[derive(Accounts)]
#[instruction(withdrawal_id: [u8; 32], category: u8)]
pub struct DisburseAgencyMintV3<'info> {
    #[account(mut)] pub authority: Signer<'info>,
    pub creator: Signer<'info>, pub mint: UncheckedAccount<'info>,
    #[account(seeds = [SEED], bump)] pub legacy_router: UncheckedAccount<'info>,
    #[account(mut, seeds = [AGENCY_POLICY_SEED, mint.key().as_ref()], bump = policy.bump,
        constraint = policy.mint == mint.key() && policy.creator == creator.key() @ ErrorCode::InvalidAgencyPolicyV3)]
    pub policy: Account<'info, MintAgencyPolicyV3>,
    #[account(mut, seeds = [MINT_VAULT_V3_SEED, mint.key().as_ref(), &[category]], bump)] pub vault: UncheckedAccount<'info>,
    #[account(mut)] pub recipient: UncheckedAccount<'info>,
    #[account(mut, seeds = [MINT_APPROVAL_V3_SEED, mint.key().as_ref(), withdrawal_id.as_ref()], bump)] pub approval: UncheckedAccount<'info>,
    #[account(init, payer = authority, space = 8 + MintWithdrawalV3::INIT_SPACE,
        seeds = [MINT_WITHDRAWAL_V3_SEED, mint.key().as_ref(), withdrawal_id.as_ref()], bump)] pub withdrawal: Account<'info, MintWithdrawalV3>,
    pub system_program: Program<'info, System>,
}

fn directed_targets(pool: u64, units: [u32; 3]) -> Result<[u64; 3]> {
    require!(units.iter().map(|n| u64::from(*n)).sum::<u64>() == 8_000_000, ErrorCode::InvalidAgencyPolicyV3);
    let mut cumulative = 0u64; let mut prior = 0u64; let mut result = [0u64; 3];
    for (index, share) in units.iter().enumerate() {
        cumulative += u64::from(*share);
        let boundary = u64::try_from(u128::from(pool) * u128::from(cumulative) / 8_000_000).map_err(|_| ErrorCode::AmountOverflow)?;
        result[index] = boundary - prior; prior = boundary;
    }
    Ok(result)
}

pub fn disburse(ctx: Context<DisburseAgencyMintV3>, withdrawal_id: [u8; 32], category: u8, beneficiary: u8, amount: u64, holder_amount: u64) -> Result<()> {
    assert_current_router_authority(&ctx.accounts.legacy_router.to_account_info(), &ctx.accounts.authority.key(), ctx.program_id)?;
    require!(category < 6 && amount > 0, ErrorCode::InvalidMintWithdrawalV3);
    let policy = &mut ctx.accounts.policy; let index = usize::from(category);
    let withdrawn = policy.withdrawn_lamports[index].checked_add(amount).ok_or(ErrorCode::AmountOverflow)?;
    require!(withdrawn <= policy.paid_lamports[index], ErrorCode::MintWithdrawalBudgetExceededV3);
    let vault = &ctx.accounts.vault; let recipient = &ctx.accounts.recipient;
    let mint = ctx.accounts.mint.key(); let recipient_key = recipient.key();
    require!(vault.owner == &System::id() && vault.data_is_empty()
        && vault.lamports().saturating_sub(Rent::get()?.minimum_balance(0)) >= amount, ErrorCode::InsufficientMintVaultV3);
    if category == 0 {
        require!(beneficiary < 2 && holder_amount <= amount, ErrorCode::InvalidProtectedMintPolicyV3);
        if beneficiary == 0 {
            require!(holder_amount == 0 && recipient_key == ctx.accounts.creator.key()
                && recipient.owner == &System::id() && recipient.data_is_empty(), ErrorCode::InvalidMintWithdrawalV3);
            policy.directed_released[0] = policy.directed_released[0].checked_add(amount).ok_or(ErrorCode::AmountOverflow)?;
        } else {
            policy.directed_released[1] = policy.directed_released[1].checked_add(holder_amount).ok_or(ErrorCode::AmountOverflow)?;
            policy.directed_released[2] = policy.directed_released[2].checked_add(amount - holder_amount).ok_or(ErrorCode::AmountOverflow)?;
        }
        let targets = directed_targets(policy.paid_lamports[0], policy.directed_units)?;
        require!(policy.directed_released.iter().zip(targets).all(|(released, target)| *released <= target), ErrorCode::MintWithdrawalBudgetExceededV3);
    } else { require!(beneficiary == category + 2 && holder_amount == 0, ErrorCode::InvalidProtectedMintPolicyV3); }
    if category == 0 && beneficiary == 1 || category == 5 {
        let (expected, bump) = Pubkey::find_program_address(&[REWARD_VAULT_SEED, ctx.accounts.authority.key.as_ref(), mint.as_ref()], ctx.program_id);
        require!(recipient_key == expected && recipient.owner == ctx.program_id, ErrorCode::InvalidMintWithdrawalV3);
        let reward = RewardVault::try_deserialize(&mut &recipient.try_borrow_data()?[..])?;
        require!(reward.authority == ctx.accounts.authority.key() && reward.mint == mint && reward.bump == bump, ErrorCode::InvalidMintWithdrawalV3);
    }
    if (1..=4).contains(&category) {
        require!(recipient.owner == &System::id() && recipient.data_is_empty() && ctx.accounts.approval.owner == ctx.program_id, ErrorCode::InvalidMintApprovalV3);
        let mut data = ctx.accounts.approval.try_borrow_mut_data()?;
        let mut record = MintWithdrawalApprovalV3::try_deserialize(&mut &data[..])?;
        require!(record.withdrawal_id == withdrawal_id && record.mint == mint && record.category == category
            && record.beneficiary == beneficiary && record.recipient == recipient_key && record.amount == amount
            && !record.consumed && record.bump == ctx.bumps.approval, ErrorCode::InvalidMintApprovalV3);
        record.consumed = true; record.try_serialize(&mut &mut data[..])?;
    }
    let (router, _) = Pubkey::find_program_address(&[MINT_ROUTER_V3_SEED, mint.as_ref()], ctx.program_id);
    require!(recipient_key != router, ErrorCode::InvalidMintWithdrawalV3);
    for other in 0..8 {
        let (key, _) = Pubkey::find_program_address(&[MINT_VAULT_V3_SEED, mint.as_ref(), &[other]], ctx.program_id);
        require!(recipient_key != key, ErrorCode::InvalidMintWithdrawalV3);
    }
    invoke_signed(&system_instruction::transfer(&vault.key(), &recipient_key, amount),
        &[vault.to_account_info(), recipient.to_account_info(), ctx.accounts.system_program.to_account_info()],
        &[&[MINT_VAULT_V3_SEED, mint.as_ref(), &[category], &[ctx.bumps.vault]]])?;
    policy.withdrawn_lamports[index] = withdrawn;
    let receipt = &mut ctx.accounts.withdrawal; receipt.withdrawal_id = withdrawal_id; receipt.mint = mint;
    receipt.category = category; receipt.recipient = recipient_key; receipt.amount = amount; receipt.created_at = Clock::get()?.unix_timestamp;
    Ok(())
}

#[derive(Accounts)]
#[instruction(post_id: u64)]
pub struct BillAgencyPromotionV3<'info> {
    #[account(mut)] pub authority: Signer<'info>,
    pub mint: UncheckedAccount<'info>,
    #[account(seeds = [SEED], bump)] pub legacy_router: UncheckedAccount<'info>,
    #[account(mut, seeds = [AGENCY_POLICY_SEED, mint.key().as_ref()], bump = policy.bump,
        constraint = policy.mint == mint.key() @ ErrorCode::InvalidAgencyPolicyV3)] pub policy: Account<'info, MintAgencyPolicyV3>,
    #[account(mut, seeds = [MINT_VAULT_V3_SEED, mint.key().as_ref(), &[7]], bump)] pub vault: UncheckedAccount<'info>,
    #[account(mut, address = policy.promotion_recipient)] pub recipient: UncheckedAccount<'info>,
    #[account(init, payer = authority, space = 8 + AgencyPromotionV3::INIT_SPACE,
        seeds = [b"agency-promotion-v3", mint.key().as_ref(), &post_id.to_le_bytes()], bump)] pub receipt: Account<'info, AgencyPromotionV3>,
    pub system_program: Program<'info, System>,
}

// The configured authority attests an independently verified X delivery. The
// chain enforces its immutable recipient, agent budget, sequence and cadence;
// a delivery hash is an audit commitment, not an on-chain X oracle.
pub fn bill_promotion(ctx: Context<BillAgencyPromotionV3>, post_id: u64, delivery_hash: [u8; 32], sequence: u32, amount: u64, posted_at: i64) -> Result<()> {
    assert_current_router_authority(&ctx.accounts.legacy_router.to_account_info(), &ctx.accounts.authority.key(), ctx.program_id)?;
    let rules = super::agency_rules_v3::read_rules(&ctx.accounts.policy.to_account_info().try_borrow_data()?, super::agency_rules_v3::POLICY_BASE)?;
    let now = Clock::get()?.unix_timestamp; let policy = &mut ctx.accounts.policy;
    require!(post_id > 0 && delivery_hash != [0; 32] && amount > 0 && policy.selected_agents & 1 != 0
        && sequence == policy.promotion_sequence && posted_at > 0 && posted_at <= now
        && (policy.last_promotion_at == 0
            || posted_at.saturating_sub(policy.last_promotion_at) >= rules.promotion_interval_seconds), ErrorCode::InvalidAgencyPolicyV3);
    let target = agent_targets(policy.paid_lamports[7], policy.selected_agents)?[0];
    let spent = policy.agent_spent[0].checked_add(amount).ok_or(ErrorCode::AmountOverflow)?;
    let withdrawn = policy.withdrawn_lamports[7].checked_add(amount).ok_or(ErrorCode::AmountOverflow)?;
    require!(spent <= target && withdrawn <= policy.paid_lamports[7], ErrorCode::MintWithdrawalBudgetExceededV3);
    let vault = &ctx.accounts.vault; let recipient = &ctx.accounts.recipient; let mint = ctx.accounts.mint.key();
    require!(vault.owner == &System::id() && vault.data_is_empty() && recipient.owner == &System::id()
        && recipient.data_is_empty() && vault.key() != recipient.key()
        && vault.lamports().saturating_sub(Rent::get()?.minimum_balance(0)) >= amount, ErrorCode::InvalidMintWithdrawalV3);
    let (router, _) = Pubkey::find_program_address(&[MINT_ROUTER_V3_SEED, mint.as_ref()], ctx.program_id);
    require!(recipient.key() != router, ErrorCode::InvalidMintWithdrawalV3);
    for category in 0..8 { let (other, _) = Pubkey::find_program_address(&[MINT_VAULT_V3_SEED, mint.as_ref(), &[category]], ctx.program_id);
        require!(recipient.key() != other, ErrorCode::InvalidMintWithdrawalV3); }
    invoke_signed(&system_instruction::transfer(&vault.key(), &recipient.key(), amount),
        &[vault.to_account_info(), recipient.to_account_info(), ctx.accounts.system_program.to_account_info()],
        &[&[MINT_VAULT_V3_SEED, mint.as_ref(), &[7], &[ctx.bumps.vault]]])?;
    policy.agent_spent[0] = spent; policy.withdrawn_lamports[7] = withdrawn;
    policy.last_promotion_at = posted_at; policy.promotion_sequence = sequence.checked_add(1).ok_or(ErrorCode::AmountOverflow)?;
    let receipt = &mut ctx.accounts.receipt; receipt.mint = mint; receipt.post_id = post_id;
    receipt.delivery_hash = delivery_hash; receipt.sequence = sequence; receipt.recipient = recipient.key();
    receipt.amount = amount; receipt.posted_at = posted_at; receipt.billed_at = now;
    Ok(())
}
