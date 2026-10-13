use std::str::FromStr;

use anchor_lang::prelude::*;
use anchor_lang::solana_program::{
    instruction::{AccountMeta, Instruction},
    program::{invoke, invoke_signed},
    system_instruction,
};
use anchor_spl::{associated_token::AssociatedToken, token::Token};

use crate::{constants::*, error::ErrorCode, state::{MintBuybackV3, MintFeePolicyV3}};
use super::rotate::assert_current_router_authority;

// Devnet pilot assets. The production program cannot inherit these addresses.
const FUNDED_MINT: &str = "C5JFX2W3YtLDmiZeUTcYjfLqXPWmW2GZZC5fbxv7ut64";
const FUNDED_POOL: &str = "EKKUWqwbZKeq4hdth8kdYuHZBtvxDCu3kZahHATbba32";
const PUMP_SWAP: &str = "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA";
const BUY_EXACT_QUOTE_IN: [u8; 8] = [198, 46, 21, 82, 180, 217, 232, 112];
const INIT_USER_VOLUME: [u8; 8] = [94, 6, 202, 115, 255, 96, 232, 183];
const BUY_ACCOUNTS: usize = 23;
const BUYBACK_CATEGORY: u8 = 6;

#[derive(Accounts)]
#[instruction(buyback_id: [u8; 32])]
pub struct BuybackMintV3<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    pub creator: Signer<'info>,
    pub mint: UncheckedAccount<'info>,
    #[account(seeds = [SEED], bump)]
    pub legacy_router: UncheckedAccount<'info>,
    #[account(mut, seeds = [MINT_POLICY_V3_SEED, mint.key().as_ref()], bump = policy.bump,
        constraint = policy.mint == mint.key() && policy.creator == creator.key()
            @ ErrorCode::InvalidMintFeePolicyV3)]
    pub policy: Account<'info, MintFeePolicyV3>,
    #[account(mut, seeds = [MINT_VAULT_V3_SEED, mint.key().as_ref(), &[BUYBACK_CATEGORY]], bump)]
    pub vault: UncheckedAccount<'info>,
    #[account(mut)]
    pub funded_mint: UncheckedAccount<'info>,
    #[account(mut)]
    pub funded_token_account: UncheckedAccount<'info>,
    #[account(mut)]
    pub quote_token_account: UncheckedAccount<'info>,
    #[account(mut)]
    pub pool: UncheckedAccount<'info>,
    #[account(init, payer = authority, space = 8 + MintBuybackV3::INIT_SPACE,
        seeds = [MINT_BUYBACK_V3_SEED, mint.key().as_ref(), buyback_id.as_ref()], bump)]
    pub receipt: Account<'info, MintBuybackV3>,
    pub base_token_program: UncheckedAccount<'info>,
    pub quote_token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub pump_swap_program: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

fn amount_at(account: &AccountInfo, offset: usize) -> Result<u64> {
    let data = account.try_borrow_data()?;
    let raw: [u8; 8] = data.get(offset..offset + 8)
        .ok_or(ErrorCode::InvalidMintBuybackV3)?.try_into()
        .map_err(|_| ErrorCode::InvalidMintBuybackV3)?;
    Ok(u64::from_le_bytes(raw))
}

fn expected_ata(mint: &Pubkey, owner: &Pubkey, token_program: &Pubkey) -> Pubkey {
    anchor_spl::associated_token::get_associated_token_address_with_program_id(
        owner, mint, token_program)
}

fn require_pump_accounts(accounts: &[AccountInfo], ctx: &BuybackMintV3) -> Result<()> {
    // PumpSwap's SDK appends two fee accounts and up to two market-specific
    // accounts after the 23 IDL accounts.
    require!(accounts.len() >= BUY_ACCOUNTS + 2
        && accounts.len() <= BUY_ACCOUNTS + 4,
        ErrorCode::InvalidMintBuybackV3);
    let expected = [
        (0, ctx.pool.key()),
        (1, ctx.vault.key()),
        (3, ctx.funded_mint.key()),
        (4, anchor_spl::token::spl_token::native_mint::id()),
        (5, ctx.funded_token_account.key()),
        (6, ctx.quote_token_account.key()),
        (11, ctx.base_token_program.key()),
        (12, ctx.quote_token_program.key()),
        (13, ctx.system_program.key()),
        (14, ctx.associated_token_program.key()),
        (16, ctx.pump_swap_program.key()),
    ];
    for (index, key) in expected {
        require!(accounts[index].key() == key, ErrorCode::InvalidMintBuybackV3);
    }
    require!(accounts[1].is_writable && accounts[5].is_writable
        && accounts[6].is_writable && accounts[20].is_writable,
        ErrorCode::InvalidMintBuybackV3);
    Ok(())
}

pub fn handler<'info>(ctx: Context<'info, BuybackMintV3<'info>>,
    buyback_id: [u8; 32], spendable_quote_in: u64,
    min_base_amount_out: u64, max_total_debit: u64) -> Result<()> {
    assert_current_router_authority(&ctx.accounts.legacy_router.to_account_info(),
        &ctx.accounts.authority.key(), ctx.program_id)?;
    require!(spendable_quote_in > 0 && min_base_amount_out > 0
        && max_total_debit >= spendable_quote_in,
        ErrorCode::InvalidAmount);
    let funded_mint = Pubkey::from_str(FUNDED_MINT).map_err(|_| ErrorCode::InvalidMintBuybackV3)?;
    let pool = Pubkey::from_str(FUNDED_POOL).map_err(|_| ErrorCode::InvalidMintBuybackV3)?;
    let pump = Pubkey::from_str(PUMP_SWAP).map_err(|_| ErrorCode::InvalidMintBuybackV3)?;
    let vault = &ctx.accounts.vault;
    let mint = ctx.accounts.mint.key();
    let base_program = ctx.accounts.base_token_program.key();
    let quote_program = ctx.accounts.quote_token_program.key();
    let native_mint = anchor_spl::token::spl_token::native_mint::id();
    require!(ctx.accounts.funded_mint.key() == funded_mint
        && ctx.accounts.pool.key() == pool && ctx.accounts.pool.owner == &pump
        && ctx.accounts.pump_swap_program.key() == pump
        && ctx.accounts.pump_swap_program.executable
        && (base_program == anchor_spl::token::ID
            || base_program == anchor_spl::token_2022::ID)
        && ctx.accounts.funded_mint.owner == &base_program
        && vault.owner == &System::id() && vault.data_is_empty(),
        ErrorCode::InvalidMintBuybackV3);
    require!(ctx.accounts.funded_token_account.key()
        == expected_ata(&funded_mint, &vault.key(), &base_program)
        && ctx.accounts.quote_token_account.key()
            == expected_ata(&native_mint, &vault.key(), &quote_program),
        ErrorCode::InvalidMintBuybackV3);
    require_pump_accounts(ctx.remaining_accounts, &ctx.accounts)?;
    let policy = &ctx.accounts.policy;
    let remaining = policy.paid_lamports[6]
        .checked_sub(policy.withdrawn_lamports[6])
        .ok_or(ErrorCode::AmountOverflow)?;
    let reserve = Rent::get()?.minimum_balance(0);
    let before_lamports = vault.lamports();
    require!(remaining >= max_total_debit
        && before_lamports.saturating_sub(reserve) >= max_total_debit,
        ErrorCode::MintWithdrawalBudgetExceededV3);

    let category = [BUYBACK_CATEGORY];
    let bump = [ctx.bumps.vault];
    let signer: &[&[u8]] = &[MINT_VAULT_V3_SEED, mint.as_ref(), &category, &bump];
    let signers: &[&[&[u8]]] = &[signer];
    let ata_program = ctx.accounts.associated_token_program.to_account_info();
    let system = ctx.accounts.system_program.to_account_info();
    let base = ctx.accounts.base_token_program.to_account_info();
    let quote = ctx.accounts.quote_token_program.to_account_info();
    let funded_ata = ctx.accounts.funded_token_account.to_account_info();
    let wsol_ata = ctx.accounts.quote_token_account.to_account_info();
    let funded_mint_info = ctx.accounts.funded_mint.to_account_info();
    let native_mint_info = ctx.remaining_accounts[4].clone();

    // PumpSwap creates this user-volume PDA with the swap user as payer even
    // when track_volume is false. Create it first with the authority as payer
    // so its persistent rent never consumes category-6 fee funds.
    let volume = ctx.remaining_accounts[20].clone();
    let (expected_volume, _) = Pubkey::find_program_address(
        &[b"user_volume_accumulator", vault.key().as_ref()], &pump);
    require!(volume.key() == expected_volume, ErrorCode::InvalidMintBuybackV3);
    if volume.lamports() == 0 {
        let event = ctx.remaining_accounts[15].clone();
        let init_volume = Instruction { program_id:pump,
            accounts:vec![
                AccountMeta::new(ctx.accounts.authority.key(), true),
                AccountMeta::new_readonly(vault.key(), false),
                AccountMeta::new(volume.key(), false),
                AccountMeta::new_readonly(system.key(), false),
                AccountMeta::new_readonly(event.key(), false),
                AccountMeta::new_readonly(pump, false),
            ], data:INIT_USER_VOLUME.to_vec() };
        invoke(&init_volume, &[
            ctx.accounts.authority.to_account_info(), vault.to_account_info(),
            volume.clone(), system.clone(), event,
            ctx.accounts.pump_swap_program.to_account_info(),
        ])?;
    }
    require!(volume.owner == &pump && !volume.data_is_empty(),
        ErrorCode::InvalidMintBuybackV3);

    // Both ATAs are controlled by the category vault PDA. The authority fronts
    // temporary WSOL rent, then receives exactly that rent back after close.
    // Unspent quote returns to the vault and never escapes its fee budget.
    let create_base = anchor_spl::associated_token::spl_associated_token_account::instruction::create_associated_token_account_idempotent(
        &ctx.accounts.authority.key(), &vault.key(), &funded_mint, &base_program);
    invoke(&create_base, &[
        ctx.accounts.authority.to_account_info(), funded_ata.clone(), vault.to_account_info(),
        funded_mint_info.clone(), system.clone(), base.clone(), ata_program.clone(),
    ])?;
    require!(wsol_ata.lamports() == 0 && wsol_ata.data_is_empty(),
        ErrorCode::InvalidMintBuybackV3);
    let create_quote = anchor_spl::associated_token::spl_associated_token_account::instruction::create_associated_token_account_idempotent(
        &ctx.accounts.authority.key(), &vault.key(), &native_mint, &quote_program);
    invoke(&create_quote, &[
        ctx.accounts.authority.to_account_info(), wsol_ata.clone(), vault.to_account_info(),
        native_mint_info, system.clone(), quote.clone(), ata_program,
    ])?;
    let quote_rent = Rent::get()?.minimum_balance(wsol_ata.data_len());
    require!(amount_at(&funded_ata, 64)? == 0 && amount_at(&wsol_ata, 64)? == 0,
        ErrorCode::InvalidMintBuybackV3);
    let supply_before = amount_at(&funded_mint_info, 36)?;
    invoke_signed(&system_instruction::transfer(&vault.key(), &wsol_ata.key(), spendable_quote_in),
        &[vault.to_account_info(), wsol_ata.clone(), system], signers)?;
    let sync = anchor_spl::token::spl_token::instruction::sync_native(&quote_program,
        &wsol_ata.key())?;
    invoke(&sync, &[wsol_ata.clone(), quote.clone()])?;

    let mut data = Vec::with_capacity(25);
    data.extend_from_slice(&BUY_EXACT_QUOTE_IN);
    data.extend_from_slice(&spendable_quote_in.to_le_bytes());
    data.extend_from_slice(&min_base_amount_out.to_le_bytes());
    data.push(0); // PumpSwap OptionBool(false): no vault-funded volume accumulator.
    let metas = ctx.remaining_accounts.iter().enumerate().map(|(index, account)| {
        if account.is_writable { AccountMeta::new(account.key(), index == 1 || account.is_signer) }
        else { AccountMeta::new_readonly(account.key(), index == 1 || account.is_signer) }
    }).collect();
    invoke_signed(&Instruction { program_id:pump, accounts:metas, data },
        ctx.remaining_accounts, signers)?;
    let bought = amount_at(&funded_ata, 64)?;
    require!(bought >= min_base_amount_out, ErrorCode::MintBuybackBurnFailedV3);
    let decimals = funded_mint_info.try_borrow_data()?
        .get(44).copied().ok_or(ErrorCode::InvalidMintBuybackV3)?;
    let burn = anchor_spl::token_2022::spl_token_2022::instruction::burn_checked(
        &base_program, &funded_ata.key(), &funded_mint, &vault.key(), &[], bought, decimals)?;
    invoke_signed(&burn, &[
        funded_ata.clone(), funded_mint_info.clone(), vault.to_account_info(), base,
    ], signers)?;
    require!(amount_at(&funded_ata, 64)? == 0
        && supply_before.checked_sub(amount_at(&funded_mint_info, 36)?) == Some(bought),
        ErrorCode::MintBuybackBurnFailedV3);
    let close = anchor_spl::token::spl_token::instruction::close_account(
        &quote_program, &wsol_ata.key(), &vault.key(), &vault.key(), &[])?;
    invoke_signed(&close, &[
        wsol_ata, vault.to_account_info(), vault.to_account_info(), quote,
    ], signers)?;
    invoke_signed(&system_instruction::transfer(&vault.key(),
        &ctx.accounts.authority.key(), quote_rent), &[
        vault.to_account_info(), ctx.accounts.authority.to_account_info(),
        ctx.accounts.system_program.to_account_info(),
    ], signers)?;
    let spent = before_lamports.checked_sub(vault.lamports())
        .ok_or(ErrorCode::InvalidMintBuybackV3)?;
    require!(spent > 0 && spent <= max_total_debit,
        ErrorCode::InvalidMintBuybackV3);
    let policy = &mut ctx.accounts.policy;
    policy.withdrawn_lamports[6] = policy.withdrawn_lamports[6]
        .checked_add(spent).ok_or(ErrorCode::AmountOverflow)?;
    require!(policy.withdrawn_lamports[6] <= policy.paid_lamports[6],
        ErrorCode::MintWithdrawalBudgetExceededV3);
    let receipt = &mut ctx.accounts.receipt;
    receipt.buyback_id = buyback_id;
    receipt.source_mint = mint;
    receipt.funded_mint = funded_mint;
    receipt.pool = pool;
    receipt.spent_lamports = spent;
    receipt.burned_base_units = bought;
    receipt.created_at = Clock::get()?.unix_timestamp;
    emit!(MintBuybackV3Event { source_mint:mint, buyback_id,
        spent_lamports:spent, burned_base_units:bought });
    Ok(())
}

#[event]
pub struct MintBuybackV3Event {
    pub source_mint: Pubkey,
    pub buyback_id: [u8; 32],
    pub spent_lamports: u64,
    pub burned_base_units: u64,
}
