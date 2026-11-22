use std::str::FromStr;

use anchor_lang::prelude::*;
use anchor_lang::solana_program::{
    instruction::{AccountMeta, Instruction},
    program::{invoke, invoke_signed},
    system_instruction,
};
use anchor_spl::associated_token::AssociatedToken;

use crate::{constants::*, error::ErrorCode,
    state::{MintAgencyPolicyV3, MintSolCreditV3, MintTokenConversionV3, MintTokenLedgerV3}};
use super::agency_policy_v3::AGENCY_POLICY_SEED;
use super::rotate::assert_current_router_authority;

// A coin paired with a token settles its fees in that token. Its Daily bonus
// (5), buyback (6), and AI-agency (7) budgets are spent by the SOL flows, so the router converts
// them to SOL through one pinned PumpSwap WSOL/<paired token> pool. The SOL
// lands in the same category's SOL vault and is credited to that category's
// SOL budget; the credit is recorded so later SOL settlements stay consistent.
const PUMP_SWAP: &str = "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA";
const BUY_EXACT_QUOTE_IN: [u8; 8] = [198, 46, 21, 82, 180, 217, 232, 112];
const SELL_EXACT_BASE_IN: [u8; 8] = [51, 230, 133, 164, 1, 127, 131, 173];
const SELL_WRITABLE: [usize; 9] = [0, 1, 5, 6, 7, 8, 10, 17, 22];
const INIT_USER_VOLUME: [u8; 8] = [94, 6, 202, 115, 255, 96, 232, 183];
const BUY_ACCOUNTS: usize = 23;

// (paired token, WSOL-base / paired-token-quote PumpSwap pool). Devnet pins the
// QA USDC pool; Mainnet pools must pass review before they are added.
#[cfg(not(feature = "mainnet-v3-program"))]
const CONVERSION_POOLS: [(&str, &str); 1] = [
    ("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU", "BT8wc5m9pkTQ1wwVYTzsqrBwSYWxuPEQ4t8ZwHcwd7SR"),
];
#[cfg(feature = "mainnet-v3-program")]
include!(concat!(env!("OUT_DIR"), "/mainnet_conversion.rs"));

#[derive(Accounts)]
#[instruction(conversion_id: [u8; 32], category: u8)]
pub struct ConvertTokenBudgetV3<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    pub mint: UncheckedAccount<'info>,
    pub quote_mint: UncheckedAccount<'info>,
    #[account(seeds = [SEED], bump)]
    pub legacy_router: UncheckedAccount<'info>,
    #[account(mut, seeds = [AGENCY_POLICY_SEED, mint.key().as_ref()], bump = policy.bump,
        constraint = policy.mint == mint.key() @ ErrorCode::InvalidAgencyPolicyV3)]
    pub policy: Account<'info, MintAgencyPolicyV3>,
    #[account(mut, seeds = [MINT_TOKEN_LEDGER_V3_SEED, mint.key().as_ref(), quote_mint.key().as_ref()], bump = ledger.bump,
        constraint = ledger.mint == mint.key() && ledger.quote_mint == quote_mint.key() @ ErrorCode::InvalidMintFeePolicyV3)]
    pub ledger: Account<'info, MintTokenLedgerV3>,
    /// CHECK: The category's SOL vault PDA; it is the PumpSwap swap user.
    #[account(mut, seeds = [MINT_VAULT_V3_SEED, mint.key().as_ref(), &[category]], bump)]
    pub vault: UncheckedAccount<'info>,
    /// CHECK: The vault's paired-token associated account (verified in the handler).
    #[account(mut)]
    pub vault_token: UncheckedAccount<'info>,
    /// CHECK: The vault's temporary WSOL associated account (verified in the handler).
    #[account(mut)]
    pub wsol_token: UncheckedAccount<'info>,
    #[account(init_if_needed, payer = authority, space = 8 + MintSolCreditV3::INIT_SPACE,
        seeds = [MINT_SOL_CREDIT_V3_SEED, mint.key().as_ref()], bump)]
    pub credit: Account<'info, MintSolCreditV3>,
    #[account(init, payer = authority, space = 8 + MintTokenConversionV3::INIT_SPACE,
        seeds = [MINT_TOKEN_CONVERSION_V3_SEED, mint.key().as_ref(), conversion_id.as_ref()], bump)]
    pub receipt: Account<'info, MintTokenConversionV3>,
    /// CHECK: SPL Token (WSOL's program).
    pub token_program: UncheckedAccount<'info>,
    /// CHECK: The paired token's program (SPL Token or Token-2022).
    pub quote_token_program: UncheckedAccount<'info>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    /// CHECK: Pinned PumpSwap program.
    pub pump_swap_program: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

fn amount_at(account: &AccountInfo, offset: usize) -> Result<u64> {
    let data = account.try_borrow_data()?;
    let raw: [u8; 8] = data.get(offset..offset + 8).ok_or(ErrorCode::InvalidMintBuybackV3)?
        .try_into().map_err(|_| ErrorCode::InvalidMintBuybackV3)?;
    Ok(u64::from_le_bytes(raw))
}

fn pinned_pool(quote: &Pubkey) -> Result<Pubkey> {
    for (mint, pool) in CONVERSION_POOLS.iter() {
        if Pubkey::from_str(mint).map_err(|_| ErrorCode::InvalidMintBuybackV3)? == *quote {
            return Pubkey::from_str(pool).map_err(|_| ErrorCode::InvalidMintBuybackV3.into());
        }
    }
    err!(ErrorCode::InvalidMintBuybackV3)
}

// This reviewed pair uses classic SPL USDC as base and WSOL as quote.
#[cfg(feature = "mainnet-v3-program")]
fn is_reviewed_sell(quote: Pubkey, pool: Pubkey) -> Result<bool> {
    Ok(quote == Pubkey::from_str("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v").map_err(|_| ErrorCode::InvalidMintBuybackV3)?
        && pool == Pubkey::from_str("Gf7sXMoP8iRw4iiXmJ1nq4vxcRycbGXy5RL8a8LnTd3v").map_err(|_| ErrorCode::InvalidMintBuybackV3)?)
}

fn validate_sell_accounts(accounts: &[AccountInfo], base: Pubkey, native: Pubkey, pump: Pubkey) -> Result<()> {
    let pool = accounts[0].try_borrow_data()?;
    require!(pool.len() >= 245 && pool[..8] == [241,154,109,4,17,177,109,188]
        && pool[43..75] == base.to_bytes() && pool[75..107] == native.to_bytes()
        && pool[139..171] == accounts[7].key.to_bytes() && pool[171..203] == accounts[8].key.to_bytes()
        && pool[211..243] == [0; 32] && pool[243..245] == [0, 0], ErrorCode::InvalidMintBuybackV3);
    let spl = anchor_spl::token::ID;
    for (index, mint, owner) in [(5, base, accounts[1].key()), (7, base, accounts[0].key()), (8, native, accounts[0].key())] {
        let account = &accounts[index];
        let data = account.try_borrow_data()?;
        require!(account.owner == &spl && data.len() == 165 && data[..32] == mint.to_bytes()
            && data[32..64] == owner.to_bytes(), ErrorCode::InvalidMintBuybackV3);
    }
    let pda = |seed: &[u8]| Pubkey::find_program_address(&[seed], &pump).0;
    require!(accounts[2].key() == pda(b"global_config") && accounts[15].key() == pda(b"__event_authority"),
        ErrorCode::InvalidMintBuybackV3);
    // PumpSwap checks recipient membership in its current fee configuration.
    for (owner, account) in [(9,10), (18,17), (21,22)] {
        let ata = anchor_spl::associated_token::get_associated_token_address_with_program_id(accounts[owner].key, &native, &spl);
        require!(accounts[account].key() == ata && accounts[owner].key() != accounts[1].key(), ErrorCode::InvalidMintBuybackV3);
    }
    Ok(())
}

/// SOL credited to each category by token conversions; zero when the coin has
/// none. Settlements of a coin with conversions pass its credit record as the
/// ninth remaining account.
pub fn read_credit(program_id: &Pubkey, mint: &Pubkey, account: Option<&AccountInfo>) -> Result<[u64; 8]> {
    let Some(info) = account else { return Ok([0; 8]); };
    let (expected, bump) = Pubkey::find_program_address(&[MINT_SOL_CREDIT_V3_SEED, mint.as_ref()], program_id);
    require!(info.key() == expected && info.owner == program_id, ErrorCode::InvalidAgencyPolicyV3);
    let record = MintSolCreditV3::try_deserialize(&mut &info.try_borrow_data()?[..])?;
    require!(record.mint == *mint && record.bump == bump, ErrorCode::InvalidAgencyPolicyV3);
    Ok(record.credited)
}

pub fn handler<'info>(ctx: Context<'info, ConvertTokenBudgetV3<'info>>, conversion_id: [u8; 32], category: u8,
    amount_in: u64, min_sol_out: u64) -> Result<()> {
    assert_current_router_authority(&ctx.accounts.legacy_router.to_account_info(), &ctx.accounts.authority.key(), ctx.program_id)?;
    require!((5..=7).contains(&category), ErrorCode::InvalidMintWithdrawalV3);
    require!(amount_in > 0 && min_sol_out > 0, ErrorCode::InvalidAmount);
    let mint = ctx.accounts.mint.key();
    let quote = ctx.accounts.quote_mint.key();
    let pump = Pubkey::from_str(PUMP_SWAP).map_err(|_| ErrorCode::InvalidMintBuybackV3)?;
    let pool = pinned_pool(&quote)?;
    let native = anchor_spl::token::spl_token::native_mint::id();
    let token_program = ctx.accounts.token_program.key();
    let quote_program = ctx.accounts.quote_token_program.key();
    let vault = &ctx.accounts.vault;
    require!(token_program == anchor_spl::token::ID
        && (quote_program == anchor_spl::token::ID || quote_program == anchor_spl::token_2022::ID)
        && ctx.accounts.quote_mint.owner == &quote_program
        && ctx.accounts.pump_swap_program.key() == pump && ctx.accounts.pump_swap_program.executable
        && vault.owner == &System::id() && vault.data_is_empty(), ErrorCode::InvalidMintBuybackV3);
    let ata = |owner: &Pubkey, mint: &Pubkey, program: &Pubkey|
        anchor_spl::associated_token::get_associated_token_address_with_program_id(owner, mint, program);
    require!(ctx.accounts.vault_token.key() == ata(&vault.key(), &quote, &quote_program)
        && ctx.accounts.wsol_token.key() == ata(&vault.key(), &native, &token_program), ErrorCode::InvalidMintBuybackV3);
    #[cfg(feature = "mainnet-v3-program")] let remaining = super::guard::split_price_signer(ctx.program_id, ctx.remaining_accounts, &ctx.accounts.authority.key())?; #[cfg(not(feature = "mainnet-v3-program"))] let remaining = ctx.remaining_accounts;
    #[cfg(feature = "mainnet-v3-program")]
    let sell = is_reviewed_sell(quote, pool)?;
    #[cfg(not(feature = "mainnet-v3-program"))]
    let sell = false;
    let (base, dex_quote, user_base, user_quote, base_program, dex_quote_program) = if sell {
        require!(remaining.len() == 23 && quote_program == token_program, ErrorCode::InvalidMintBuybackV3);
        (quote, native, ctx.accounts.vault_token.key(), ctx.accounts.wsol_token.key(), quote_program, token_program)
    } else {
        require!((BUY_ACCOUNTS + 2..=BUY_ACCOUNTS + 4).contains(&remaining.len()), ErrorCode::InvalidMintBuybackV3);
        (native, quote, ctx.accounts.wsol_token.key(), ctx.accounts.vault_token.key(), token_program, quote_program)
    };
    for (index, key) in [(0, pool), (1, vault.key()), (3, base), (4, dex_quote), (5, user_base),
        (6, user_quote), (11, base_program), (12, dex_quote_program), (13, ctx.accounts.system_program.key()),
        (14, ctx.accounts.associated_token_program.key()), (16, pump)] {
        require!(remaining[index].key() == key, ErrorCode::InvalidMintBuybackV3);
    }
    require!(remaining[0].owner == &pump && remaining[1].is_writable && remaining[5].is_writable
        && remaining[6].is_writable, ErrorCode::InvalidMintBuybackV3);
    if sell {
        validate_sell_accounts(remaining, base, native, pump)?;
    } else {
        require!(remaining[20].is_writable, ErrorCode::InvalidMintBuybackV3);
    }

    // Budget: the category's settled paired-token fees not yet spent.
    let index = usize::from(category);
    let budget = ctx.accounts.ledger.paid[index].checked_sub(ctx.accounts.ledger.withdrawn[index]).ok_or(ErrorCode::AmountOverflow)?;
    let token_before = amount_at(&ctx.accounts.vault_token, 64)?;
    require!(amount_in <= budget && amount_in <= token_before, ErrorCode::MintWithdrawalBudgetExceededV3);

    let system = ctx.accounts.system_program.to_account_info();
    let authority = ctx.accounts.authority.to_account_info();
    // The SOL vault keeps its rent reserve outside the spendable budget, as
    // SOL settlements do; the authority funds it if the vault is new.
    let reserve = Rent::get()?.minimum_balance(0);
    if vault.lamports() < reserve {
        invoke(&system_instruction::transfer(&authority.key(), &vault.key(), reserve - vault.lamports()),
            &[authority.clone(), vault.to_account_info(), system.clone()])?;
    }
    let category_seed = [category];
    let bump = [ctx.bumps.vault];
    let signer: &[&[u8]] = &[MINT_VAULT_V3_SEED, mint.as_ref(), &category_seed, &bump];
    let signers: &[&[&[u8]]] = &[signer];

    // PumpSwap's per-user volume record is paid by the authority, never the budget.
    if !sell {
        let volume = remaining[20].clone();
        let (expected_volume, _) = Pubkey::find_program_address(&[b"user_volume_accumulator", vault.key().as_ref()], &pump);
        require!(volume.key() == expected_volume, ErrorCode::InvalidMintBuybackV3);
        if volume.data_is_empty() && volume.owner == &System::id() {
            let event = remaining[15].clone();
            invoke(&Instruction { program_id:pump, accounts:vec![
                AccountMeta::new(authority.key(), true), AccountMeta::new_readonly(vault.key(), false),
                AccountMeta::new(volume.key(), false), AccountMeta::new_readonly(system.key(), false),
                AccountMeta::new_readonly(event.key(), false), AccountMeta::new_readonly(pump, false),
            ], data:INIT_USER_VOLUME.to_vec() }, &[authority.clone(), vault.to_account_info(), volume.clone(), system.clone(), event,
                ctx.accounts.pump_swap_program.to_account_info()])?;
        }
        require!(volume.owner == &pump && !volume.data_is_empty(), ErrorCode::InvalidMintBuybackV3);
    }

    // Temporary WSOL account controlled by the vault; the authority fronts its
    // rent and receives exactly that rent back after the close.
    let wsol = ctx.accounts.wsol_token.to_account_info();
    let quote_prefund = wsol.lamports();
    let payer_before_quote = authority.lamports();
    invoke(&anchor_spl::associated_token::spl_associated_token_account::instruction::create_associated_token_account_idempotent(
        &authority.key(), &vault.key(), &native, &token_program), &[authority.clone(), wsol.clone(), vault.to_account_info(),
        remaining[if sell { 4 } else { 3 }].clone(), system.clone(), ctx.accounts.token_program.to_account_info(),
        ctx.accounts.associated_token_program.to_account_info()])?;
    let wsol_rent = payer_before_quote.checked_sub(authority.lamports())
        .ok_or(ErrorCode::InvalidMintBuybackV3)?;
    let wsol_before = amount_at(&wsol, 64)?;
    let lamports_before = vault.lamports();

    let mut data = Vec::with_capacity(25);
    data.extend_from_slice(if sell { &SELL_EXACT_BASE_IN } else { &BUY_EXACT_QUOTE_IN });
    data.extend_from_slice(&amount_in.to_le_bytes());
    data.extend_from_slice(&min_sol_out.to_le_bytes());
    if !sell { data.push(0); } // OptionBool(false): no volume tracking.
    let metas = remaining.iter().enumerate().map(|(i, account)| {
        let writable = if sell { SELL_WRITABLE.contains(&i) } else { account.is_writable };
        let signer = i == 1 || (!sell && account.is_signer);
        if writable { AccountMeta::new(account.key(), signer) } else { AccountMeta::new_readonly(account.key(), signer) }
    }).collect();
    invoke_signed(&Instruction { program_id:pump, accounts:metas, data }, remaining, signers)?;
    let bought = amount_at(&wsol, 64)?.checked_sub(wsol_before)
        .ok_or(ErrorCode::InvalidMintBuybackV3)?;
    require!(bought >= min_sol_out, ErrorCode::MintBuybackBurnFailedV3);
    invoke_signed(&anchor_spl::token::spl_token::instruction::close_account(&token_program, &wsol.key(), &vault.key(), &vault.key(), &[])?,
        &[wsol, vault.to_account_info(), vault.to_account_info(), ctx.accounts.token_program.to_account_info()], signers)?;
    invoke_signed(&system_instruction::transfer(&vault.key(), &authority.key(), wsol_rent),
        &[vault.to_account_info(), authority, system], signers)?;

    let spent = token_before.checked_sub(amount_at(&ctx.accounts.vault_token, 64)?).ok_or(ErrorCode::InvalidMintBuybackV3)?;
    let received = vault.lamports().checked_sub(lamports_before)
        .and_then(|delta| delta.checked_sub(quote_prefund))
        .ok_or(ErrorCode::InvalidMintBuybackV3)?;
    require!(spent > 0 && spent <= amount_in && received == bought, ErrorCode::InvalidMintBuybackV3);

    if sell { require!(spent == amount_in, ErrorCode::InvalidMintBuybackV3); }

    let ledger = &mut ctx.accounts.ledger;
    ledger.withdrawn[index] = ledger.withdrawn[index].checked_add(spent).ok_or(ErrorCode::AmountOverflow)?;
    require!(ledger.withdrawn[index] <= ledger.paid[index], ErrorCode::MintWithdrawalBudgetExceededV3);
    let policy = &mut ctx.accounts.policy;
    policy.paid_lamports[index] = policy.paid_lamports[index].checked_add(received).ok_or(ErrorCode::AmountOverflow)?;
    let credit = &mut ctx.accounts.credit;
    require!(credit.mint == Pubkey::default() || credit.mint == mint, ErrorCode::InvalidAgencyPolicyV3);
    credit.mint = mint; credit.bump = ctx.bumps.credit;
    credit.credited[index] = credit.credited[index].checked_add(received).ok_or(ErrorCode::AmountOverflow)?;
    let receipt = &mut ctx.accounts.receipt;
    receipt.conversion_id = conversion_id; receipt.mint = mint; receipt.quote_mint = quote; receipt.pool = pool;
    receipt.category = category; receipt.spent_quote = spent; receipt.received_lamports = received;
    receipt.created_at = Clock::get()?.unix_timestamp;
    emit!(MintTokenConversionV3Event { mint, quote_mint:quote, conversion_id, category, spent_quote:spent, received_lamports:received });
    Ok(())
}

#[event]
pub struct MintTokenConversionV3Event {
    pub mint: Pubkey,
    pub quote_mint: Pubkey,
    pub conversion_id: [u8; 32],
    pub category: u8,
    pub spent_quote: u64,
    pub received_lamports: u64,
}
