//! Creator fees paid in a token (coins whose Pump curve is quoted in USDC, an
//! xStock or another token). Mirrors the protected SOL path: the coin's own V3
//! policy splits the router's token balance into the same seven category
//! vaults (as token accounts owned by the vault PDAs), with the same payout
//! rules, beneficiary shares and approvals. Buyback (category 6) stays locked.
use anchor_lang::prelude::*;
use anchor_spl::token_interface::{self, Mint, TokenAccount, TokenInterface, TransferChecked};

use crate::{constants::*, error::ErrorCode, state::{MintAgencyPolicyV3, MintFeePolicyV3, MintTokenLedgerV3,
    MintClaimRecordV3, MintWithdrawalApprovalV3, MintWithdrawalV3, RewardVault}};
use super::{policy_v3::category_targets, protected_v3::{read_shares, directed_targets},
    agency_policy_v3::{agency_category_targets, AGENCY_POLICY_SEED}, rotate::assert_current_router_authority};

/// Up to eight category vaults: seven for protected policies, eight (with the
/// AI-agency budget) for agency policies.
const VAULTS: usize = 8;

/// The coin's fee policy, either protected (seven categories) or agency
/// (eight), read from the account at its canonical PDA.
struct PolicyView { creator: Pubkey, agency: bool, protocol: [u32; 7], directed: [u32; 3] }

impl PolicyView {
    fn vaults(&self) -> usize { if self.agency { 8 } else { 7 } }
    fn targets(&self, total: u64) -> Result<[u64; VAULTS]> {
        if self.agency { return agency_category_targets(total, self.protocol); }
        let mut units = [0u32; 6];
        units.copy_from_slice(&self.protocol[..6]);
        let seven = category_targets(total, units)?;
        let mut out = [0u64; VAULTS];
        out[..7].copy_from_slice(&seven);
        Ok(out)
    }
}

fn read_policy(policy: &AccountInfo, program_id: &Pubkey, mint: &Pubkey) -> Result<PolicyView> {
    require!(policy.owner == program_id, ErrorCode::InvalidMintFeePolicyV3);
    let disc = policy.try_borrow_data()?[..8].to_vec();
    if disc.as_slice() == MintFeePolicyV3::DISCRIMINATOR {
        let (expected, _) = Pubkey::find_program_address(&[MINT_POLICY_V3_SEED, mint.as_ref()], program_id);
        require!(policy.key() == expected, ErrorCode::InvalidMintFeePolicyV3);
        let shares = read_shares(policy)?;
        let state = MintFeePolicyV3::try_deserialize(&mut &policy.try_borrow_data()?[..])?;
        require!(state.mint == *mint, ErrorCode::InvalidMintFeePolicyV3);
        let mut protocol = [0u32; 7];
        protocol[..6].copy_from_slice(&state.protocol_units);
        return Ok(PolicyView { creator: state.creator, agency: false, protocol, directed: shares.units });
    }
    require!(disc.as_slice() == MintAgencyPolicyV3::DISCRIMINATOR, ErrorCode::InvalidMintFeePolicyV3);
    let (expected, _) = Pubkey::find_program_address(&[AGENCY_POLICY_SEED, mint.as_ref()], program_id);
    require!(policy.key() == expected, ErrorCode::InvalidMintFeePolicyV3);
    let state = MintAgencyPolicyV3::try_deserialize(&mut &policy.try_borrow_data()?[..])?;
    require!(state.mint == *mint, ErrorCode::InvalidMintFeePolicyV3);
    Ok(PolicyView { creator: state.creator, agency: true, protocol: state.protocol_units, directed: state.directed_units })
}

fn vault_address(program_id: &Pubkey, mint: &Pubkey, category: u8) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[MINT_VAULT_V3_SEED, mint.as_ref(), &[category]], program_id)
}

/// Opens the token ledger for one coin and its paired token. The coin must
/// already have a protected V3 policy (created with its launch).
#[derive(Accounts)]
pub struct InitializeTokenLedgerV3<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    /// CHECK: The coin; bound by the policy seeds.
    pub mint: UncheckedAccount<'info>,
    pub quote_mint: InterfaceAccount<'info, Mint>,
    /// CHECK: Global router header; its current authority is checked.
    #[account(seeds = [SEED], bump)]
    pub legacy_router: UncheckedAccount<'info>,
    /// CHECK: The coin's protected or agency fee policy; validated by read_policy.
    pub policy: UncheckedAccount<'info>,
    #[account(init, payer = authority, space = 8 + MintTokenLedgerV3::INIT_SPACE,
        seeds = [MINT_TOKEN_LEDGER_V3_SEED, mint.key().as_ref(), quote_mint.key().as_ref()], bump)]
    pub ledger: Account<'info, MintTokenLedgerV3>,
    pub system_program: Program<'info, System>,
}

pub fn initialize_token_ledger_v3_handler(ctx: Context<InitializeTokenLedgerV3>) -> Result<()> {
    assert_current_router_authority(&ctx.accounts.legacy_router.to_account_info(), &ctx.accounts.authority.key(), ctx.program_id)?;
    read_policy(&ctx.accounts.policy.to_account_info(), ctx.program_id, &ctx.accounts.mint.key())?;
    let ledger = &mut ctx.accounts.ledger;
    ledger.mint = ctx.accounts.mint.key();
    ledger.quote_mint = ctx.accounts.quote_mint.key();
    ledger.settled = 0;
    ledger.paid = [0; VAULTS];
    ledger.withdrawn = [0; VAULTS];
    ledger.released = [0; 3];
    ledger.bump = ctx.bumps.ledger;
    Ok(())
}

/// Splits `expected_amount` of the router's paired-token balance into the
/// seven category vault token accounts (passed in category order as remaining
/// accounts), by the coin's protocol rates.
#[derive(Accounts)]
#[instruction(claim_id: [u8; 32])]
pub struct SettleMintTokenV3<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    /// CHECK: The coin; bound by the policy and ledger seeds.
    pub mint: UncheckedAccount<'info>,
    pub quote_mint: InterfaceAccount<'info, Mint>,
    /// CHECK: Global router header; its current authority is checked.
    #[account(seeds = [SEED], bump)]
    pub legacy_router: UncheckedAccount<'info>,
    /// CHECK: The coin's protected or agency fee policy; validated by read_policy.
    pub policy: UncheckedAccount<'info>,
    #[account(mut, seeds = [MINT_TOKEN_LEDGER_V3_SEED, mint.key().as_ref(), quote_mint.key().as_ref()], bump = ledger.bump)]
    pub ledger: Account<'info, MintTokenLedgerV3>,
    /// CHECK: The coin's V3 router PDA, which owns `router_token`.
    #[account(seeds = [MINT_ROUTER_V3_SEED, mint.key().as_ref()], bump)]
    pub router: UncheckedAccount<'info>,
    #[account(mut, token::mint = quote_mint, token::authority = router, token::token_program = token_program)]
    pub router_token: InterfaceAccount<'info, TokenAccount>,
    #[account(init, payer = authority, space = 8 + MintClaimRecordV3::INIT_SPACE,
        seeds = [MINT_TOKEN_CLAIM_V3_SEED, mint.key().as_ref(), quote_mint.key().as_ref(), claim_id.as_ref()], bump)]
    pub claim: Account<'info, MintClaimRecordV3>,
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

pub fn settle_mint_token_v3_handler<'info>(ctx: Context<'info, SettleMintTokenV3<'info>>,
    claim_id: [u8; 32], expected_amount: u64) -> Result<()> {
    assert_current_router_authority(&ctx.accounts.legacy_router.to_account_info(), &ctx.accounts.authority.key(), ctx.program_id)?;
    let view = read_policy(&ctx.accounts.policy.to_account_info(), ctx.program_id, &ctx.accounts.mint.key())?;
    require!(expected_amount > 0, ErrorCode::InvalidAmount);
    require!(expected_amount <= ctx.accounts.router_token.amount, ErrorCode::MintClaimAmountMismatchV3);
    require!(ctx.remaining_accounts.len() == view.vaults(), ErrorCode::InvalidMintFeeVaultV3);
    let mint = ctx.accounts.mint.key();
    let quote = ctx.accounts.quote_mint.key();
    let decimals = ctx.accounts.quote_mint.decimals;
    let ledger = &mut ctx.accounts.ledger;
    let new_total = ledger.settled.checked_add(expected_amount).ok_or(ErrorCode::AmountOverflow)?;
    let targets = view.targets(new_total)?;
    let router_bump = [ctx.bumps.router];
    let router_seeds: &[&[u8]] = &[MINT_ROUTER_V3_SEED, mint.as_ref(), &router_bump];
    let mut paid = [0u64; VAULTS];
    for index in 0..view.vaults() {
        let allocation = targets[index].checked_sub(ledger.paid[index]).ok_or(ErrorCode::AmountOverflow)?;
        let vault_info = &ctx.remaining_accounts[index];
        // Each vault token account must hold the paired token and belong to
        // this coin's vault PDA for that category.
        let (vault_owner, _) = vault_address(ctx.program_id, &mint, index as u8);
        require!(vault_info.owner == &ctx.accounts.token_program.key(), ErrorCode::InvalidMintFeeVaultV3);
        {
            let data = vault_info.try_borrow_data()?;
            let account = TokenAccount::try_deserialize(&mut &data[..]).map_err(|_| ErrorCode::InvalidMintFeeVaultV3)?;
            require!(account.mint == quote && account.owner == vault_owner, ErrorCode::InvalidMintFeeVaultV3);
        }
        if allocation > 0 {
            token_interface::transfer_checked(CpiContext::new_with_signer(ctx.accounts.token_program.key(),
                TransferChecked { from: ctx.accounts.router_token.to_account_info(), mint: ctx.accounts.quote_mint.to_account_info(),
                    to: vault_info.clone(), authority: ctx.accounts.router.to_account_info() }, &[router_seeds]), allocation, decimals)?;
        }
        paid[index] = allocation;
        ledger.paid[index] = targets[index];
    }
    ledger.settled = new_total;
    let claim = &mut ctx.accounts.claim;
    claim.claim_id = claim_id;
    claim.mint = mint;
    claim.total_lamports = expected_amount;
    claim.category_lamports.copy_from_slice(&paid[..7]);
    claim.created_at = Clock::get()?.unix_timestamp;
    emit!(TokenSettlementV3Event { mint, quote_mint: quote, claim_id, total: expected_amount, category_amounts: paid });
    Ok(())
}

/// Approval for a referral-category token payout (categories 1-4), same rules
/// as SOL approvals but recorded separately so units are never mixed.
#[derive(Accounts)]
#[instruction(withdrawal_id: [u8; 32])]
pub struct ApproveProtectedTokenWithdrawalV3<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    /// CHECK: Signature or immutable automation record is required by the handler.
    pub creator: UncheckedAccount<'info>,
    /// CHECK: The coin; bound by the policy seeds.
    pub mint: UncheckedAccount<'info>,
    pub quote_mint: InterfaceAccount<'info, Mint>,
    /// CHECK: Global router header; its current authority is checked.
    #[account(seeds = [SEED], bump)]
    pub legacy_router: UncheckedAccount<'info>,
    /// CHECK: The coin's protected or agency fee policy; validated by read_policy.
    pub policy: UncheckedAccount<'info>,
    /// CHECK: Recipient wallet; must be a plain system account.
    pub recipient: UncheckedAccount<'info>,
    #[account(init, payer = authority, space = 8 + MintWithdrawalApprovalV3::INIT_SPACE,
        seeds = [MINT_TOKEN_APPROVAL_V3_SEED, mint.key().as_ref(), quote_mint.key().as_ref(), withdrawal_id.as_ref()], bump)]
    pub approval: Account<'info, MintWithdrawalApprovalV3>,
    pub system_program: Program<'info, System>,
}

pub fn approve_protected_token_withdrawal_v3_handler(ctx: Context<ApproveProtectedTokenWithdrawalV3>,
    withdrawal_id: [u8; 32], category: u8, beneficiary: u8, amount: u64) -> Result<()> {
    super::automation_v3::authorize(ctx.program_id, &ctx.accounts.creator.to_account_info(),
        &ctx.accounts.mint.key(), &ctx.accounts.policy.key(), category, &ctx.accounts.recipient.key(), ctx.remaining_accounts)?;
    assert_current_router_authority(&ctx.accounts.legacy_router.to_account_info(), &ctx.accounts.authority.key(), ctx.program_id)?;
    let view = read_policy(&ctx.accounts.policy.to_account_info(), ctx.program_id, &ctx.accounts.mint.key())?;
    require!(view.creator == ctx.accounts.creator.key(), ErrorCode::InvalidMintFeePolicyV3);
    require!(amount > 0 && (1..=4).contains(&category) && beneficiary == category + 2, ErrorCode::InvalidMintApprovalV3);
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
    Ok(())
}

/// Pays one category budget in the paired token. `recipient_owner` is the
/// wallet (or reward vault) that owns `recipient_token`.
#[derive(Accounts)]
#[instruction(withdrawal_id: [u8; 32], category: u8)]
pub struct DisburseProtectedMintTokenV3<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    /// CHECK: Signature or immutable automation record is required by the handler.
    pub creator: UncheckedAccount<'info>,
    /// CHECK: The coin; bound by the policy and ledger seeds.
    pub mint: UncheckedAccount<'info>,
    pub quote_mint: InterfaceAccount<'info, Mint>,
    /// CHECK: Global router header; its current authority is checked.
    #[account(seeds = [SEED], bump)]
    pub legacy_router: UncheckedAccount<'info>,
    /// CHECK: The coin's protected or agency fee policy; validated by read_policy.
    pub policy: UncheckedAccount<'info>,
    #[account(mut, seeds = [MINT_TOKEN_LEDGER_V3_SEED, mint.key().as_ref(), quote_mint.key().as_ref()], bump = ledger.bump)]
    pub ledger: Account<'info, MintTokenLedgerV3>,
    /// CHECK: The category vault PDA, which owns `vault_token`.
    #[account(seeds = [MINT_VAULT_V3_SEED, mint.key().as_ref(), &[category]], bump)]
    pub vault: UncheckedAccount<'info>,
    #[account(mut, token::mint = quote_mint, token::authority = vault, token::token_program = token_program)]
    pub vault_token: InterfaceAccount<'info, TokenAccount>,
    /// CHECK: Owner of `recipient_token`; validated per category below.
    pub recipient_owner: UncheckedAccount<'info>,
    #[account(mut, token::mint = quote_mint, token::authority = recipient_owner, token::token_program = token_program)]
    pub recipient_token: InterfaceAccount<'info, TokenAccount>,
    /// CHECK: Token approval PDA; required and consumed for categories 1-4.
    #[account(mut, seeds = [MINT_TOKEN_APPROVAL_V3_SEED, mint.key().as_ref(), quote_mint.key().as_ref(), withdrawal_id.as_ref()], bump)]
    pub approval: UncheckedAccount<'info>,
    #[account(init, payer = authority, space = 8 + MintWithdrawalV3::INIT_SPACE,
        seeds = [MINT_TOKEN_WITHDRAWAL_V3_SEED, mint.key().as_ref(), quote_mint.key().as_ref(), withdrawal_id.as_ref()], bump)]
    pub withdrawal: Account<'info, MintWithdrawalV3>,
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

pub fn disburse_protected_mint_token_v3_handler(ctx: Context<DisburseProtectedMintTokenV3>,
    withdrawal_id: [u8; 32], category: u8, beneficiary: u8, amount: u64, holder_amount: u64) -> Result<()> {
    let owner_key = ctx.accounts.recipient_owner.key();
    super::automation_v3::authorize(ctx.program_id, &ctx.accounts.creator.to_account_info(),
        &ctx.accounts.mint.key(), &ctx.accounts.policy.key(), category, &owner_key, ctx.remaining_accounts)?;
    assert_current_router_authority(&ctx.accounts.legacy_router.to_account_info(), &ctx.accounts.authority.key(), ctx.program_id)?;
    require!(category < 6 && amount > 0, ErrorCode::InvalidMintWithdrawalV3);
    let view = read_policy(&ctx.accounts.policy.to_account_info(), ctx.program_id, &ctx.accounts.mint.key())?;
    require!(view.creator == ctx.accounts.creator.key(), ErrorCode::InvalidMintFeePolicyV3);
    let mint = ctx.accounts.mint.key();
    let quote = ctx.accounts.quote_mint.key();
    let ledger = &mut ctx.accounts.ledger;
    let index = usize::from(category);
    let new_withdrawn = ledger.withdrawn[index].checked_add(amount).ok_or(ErrorCode::AmountOverflow)?;
    require!(new_withdrawn <= ledger.paid[index], ErrorCode::MintWithdrawalBudgetExceededV3);
    require!(ctx.accounts.vault_token.amount >= amount, ErrorCode::InsufficientMintVaultV3);
    let owner = &ctx.accounts.recipient_owner;
    if category == 0 {
        require!(beneficiary < 2, ErrorCode::InvalidProtectedMintPolicyV3);
        let targets = directed_targets(ledger.paid[0], view.directed)?;
        if beneficiary == 0 {
            require!(holder_amount == 0, ErrorCode::InvalidProtectedMintPolicyV3);
            ledger.released[0] = ledger.released[0].checked_add(amount).ok_or(ErrorCode::AmountOverflow)?;
            require!(owner_key == ctx.accounts.creator.key() && owner.owner == &System::id() && owner.data_is_empty(),
                ErrorCode::InvalidMintWithdrawalV3);
        } else {
            require!(holder_amount <= amount, ErrorCode::InvalidProtectedMintPolicyV3);
            ledger.released[1] = ledger.released[1].checked_add(holder_amount).ok_or(ErrorCode::AmountOverflow)?;
            ledger.released[2] = ledger.released[2].checked_add(amount - holder_amount).ok_or(ErrorCode::AmountOverflow)?;
        }
        require!(ledger.released.iter().zip(targets).all(|(released, target)| *released <= target),
            ErrorCode::MintWithdrawalBudgetExceededV3);
    } else {
        require!(beneficiary == category + 2 && holder_amount == 0, ErrorCode::InvalidProtectedMintPolicyV3);
    }
    // Holder and community budgets only enter this coin's proof-gated reward vault.
    if category == 0 && beneficiary == 1 || category == 5 {
        let (expected, bump) = Pubkey::find_program_address(
            &[REWARD_VAULT_SEED, ctx.accounts.authority.key.as_ref(), mint.as_ref()], ctx.program_id);
        require!(owner_key == expected && owner.owner == ctx.program_id, ErrorCode::InvalidMintWithdrawalV3);
        let reward = RewardVault::try_deserialize(&mut &owner.try_borrow_data()?[..])?;
        require!(reward.authority == ctx.accounts.authority.key() && reward.mint == mint && reward.bump == bump,
            ErrorCode::InvalidMintWithdrawalV3);
    }
    if (1..=4).contains(&category) {
        require!(owner.owner == &System::id() && owner.data_is_empty() && ctx.accounts.approval.owner == ctx.program_id,
            ErrorCode::InvalidMintApprovalV3);
        let mut data = ctx.accounts.approval.try_borrow_mut_data()?;
        let mut record = MintWithdrawalApprovalV3::try_deserialize(&mut &data[..])?;
        require!(record.withdrawal_id == withdrawal_id && record.mint == mint && record.category == category
            && record.beneficiary == beneficiary && record.recipient == owner_key && record.amount == amount
            && !record.consumed && record.bump == ctx.bumps.approval, ErrorCode::InvalidMintApprovalV3);
        record.consumed = true;
        record.try_serialize(&mut &mut data[..])?;
    }
    // Never pay into this coin's router or any of its vaults (no reclassifying).
    let (router, _) = Pubkey::find_program_address(&[MINT_ROUTER_V3_SEED, mint.as_ref()], ctx.program_id);
    require!(owner_key != router, ErrorCode::InvalidMintWithdrawalV3);
    for other in 0..VAULTS as u8 {
        require!(owner_key != vault_address(ctx.program_id, &mint, other).0, ErrorCode::InvalidMintWithdrawalV3);
    }
    let category_seed = [category];
    let vault_bump = [ctx.bumps.vault];
    let vault_seeds: &[&[u8]] = &[MINT_VAULT_V3_SEED, mint.as_ref(), &category_seed, &vault_bump];
    token_interface::transfer_checked(CpiContext::new_with_signer(ctx.accounts.token_program.key(),
        TransferChecked { from: ctx.accounts.vault_token.to_account_info(), mint: ctx.accounts.quote_mint.to_account_info(),
            to: ctx.accounts.recipient_token.to_account_info(), authority: ctx.accounts.vault.to_account_info() }, &[vault_seeds]),
        amount, ctx.accounts.quote_mint.decimals)?;
    ledger.withdrawn[index] = new_withdrawn;
    let receipt = &mut ctx.accounts.withdrawal;
    receipt.withdrawal_id = withdrawal_id;
    receipt.mint = mint;
    receipt.category = category;
    receipt.recipient = owner_key;
    receipt.amount = amount;
    receipt.created_at = Clock::get()?.unix_timestamp;
    emit!(TokenDisbursementV3Event { mint, quote_mint: quote, withdrawal_id, category, recipient: owner_key, amount });
    Ok(())
}

#[event]
pub struct TokenSettlementV3Event {
    pub mint: Pubkey,
    pub quote_mint: Pubkey,
    pub claim_id: [u8; 32],
    pub total: u64,
    pub category_amounts: [u64; 8],
}

#[event]
pub struct TokenDisbursementV3Event {
    pub mint: Pubkey,
    pub quote_mint: Pubkey,
    pub withdrawal_id: [u8; 32],
    pub category: u8,
    pub recipient: Pubkey,
    pub amount: u64,
}
