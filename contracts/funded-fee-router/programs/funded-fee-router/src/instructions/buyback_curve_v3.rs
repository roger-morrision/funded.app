use anchor_lang::prelude::*;
use anchor_lang::solana_program::{instruction::{AccountMeta, Instruction}, program::{invoke, invoke_signed}};
use crate::error::ErrorCode;

pub const PUMP: Pubkey = pubkey!("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");
const BUY: [u8; 8] = [102, 6, 61, 18, 1, 218, 235, 234];
const CURVE: [u8; 8] = [23, 183, 248, 55, 96, 216, 172, 96];

fn amount(account: &AccountInfo, offset: usize) -> Result<u64> {
    let data = account.try_borrow_data()?;
    Ok(u64::from_le_bytes(data.get(offset..offset + 8)
        .ok_or(ErrorCode::InvalidMintBuybackV3)?.try_into()
        .map_err(|_| ErrorCode::InvalidMintBuybackV3)?))
}

pub struct CurveAccounts<'info> {
    pub authority: AccountInfo<'info>, pub vault: AccountInfo<'info>,
    pub mint: AccountInfo<'info>, pub ata: AccountInfo<'info>,
    pub curve: AccountInfo<'info>, pub base: AccountInfo<'info>,
    pub associated: AccountInfo<'info>, pub system: AccountInfo<'info>,
    pub pump: AccountInfo<'info>,
}

// Shared by both immutable fee-policy layouts. The caller binds the approved
// RICH mint, category-6 vault PDA, authority, price cosigner and remaining budget.
// No SOL is released to a worker wallet. Failure rolls back purchase and burn.
pub fn execute<'info>(ctx: CurveAccounts<'info>, accounts: &[AccountInfo<'info>],
    signer: &[&[u8]], remaining: u64, quote: u64, minimum: u64, limit: u64) -> Result<(u64,u64)> {
    let (curve, _) = Pubkey::find_program_address(&[b"bonding-curve", ctx.mint.key.as_ref()], &PUMP);
    let base = ctx.base.key();
    require!(ctx.pump.key() == PUMP && ctx.pump.executable && ctx.curve.key() == curve
        && ctx.curve.owner == &PUMP && ctx.mint.owner == &base
        && (base == anchor_spl::token::ID || base == anchor_spl::token_2022::ID)
        && ctx.vault.owner == &System::id() && ctx.vault.data_is_empty()
        && quote > 0 && minimum > 0 && limit >= quote, ErrorCode::InvalidMintBuybackV3);
    {
        let data = ctx.curve.try_borrow_data()?;
        require!(data.len() >= 81 && data[..8] == CURVE && data[48] == 0
            && (data.len() <= 81 || data[81] == 0)
            && (data.len() <= 82 || data[82] == 0), ErrorCode::InvalidMintBuybackV3);
        if data.len() >= 115 {
            let quote_mint = Pubkey::new_from_array(data[83..115].try_into().unwrap());
            require!(quote_mint == Pubkey::default() || quote_mint == anchor_spl::token::spl_token::native_mint::id(),
                ErrorCode::InvalidMintBuybackV3);
        }
    }
    require!(minimum < amount(&ctx.curve, 24)?, ErrorCode::InvalidMintBuybackV3);
    let ata = anchor_spl::associated_token::get_associated_token_address_with_program_id;
    require!(accounts.len() == 18 && ctx.ata.key() == ata(&ctx.mint.key(), &ctx.vault.key(), &base),
        ErrorCode::InvalidMintBuybackV3);
    let expected = [(0, Pubkey::find_program_address(&[b"global"], &PUMP).0),
        (2, ctx.mint.key()), (3, curve), (4, ata(&ctx.mint.key(), &curve, &base)),
        (5, ctx.ata.key()), (6, ctx.vault.key()), (7, ctx.system.key()), (8, base), (11, PUMP)];
    for (index, key) in expected { require!(accounts[index].key() == key, ErrorCode::InvalidMintBuybackV3); }
    require!(accounts.iter().enumerate().all(|(i,a)| !a.is_signer || i == 6), ErrorCode::InvalidMintBuybackV3);
    let before = ctx.vault.lamports();
    require!(remaining >= limit && before.saturating_sub(Rent::get()?.minimum_balance(0)) >= limit,
        ErrorCode::MintWithdrawalBudgetExceededV3);
    let volume = &accounts[13];
    require!(volume.key() == Pubkey::find_program_address(&[b"user_volume_accumulator", ctx.vault.key.as_ref()], &PUMP).0,
        ErrorCode::InvalidMintBuybackV3);
    if volume.lamports() == 0 {
        let ix = Instruction { program_id:PUMP, accounts:vec![
            AccountMeta::new(ctx.authority.key(), true), AccountMeta::new_readonly(ctx.vault.key(), false),
            AccountMeta::new(volume.key(), false), AccountMeta::new_readonly(ctx.system.key(), false),
            AccountMeta::new_readonly(accounts[10].key(), false), AccountMeta::new_readonly(PUMP, false)],
            data:vec![94,6,202,115,255,96,232,183] };
        invoke(&ix, &[ctx.authority.clone(),ctx.vault.clone(),volume.clone(),ctx.system.clone(),accounts[10].clone(),ctx.pump.clone()])?;
    }
    require!(volume.owner == &PUMP && !volume.data_is_empty(), ErrorCode::InvalidMintBuybackV3);
    let create = anchor_spl::associated_token::spl_associated_token_account::instruction::create_associated_token_account_idempotent(
        &ctx.authority.key(), &ctx.vault.key(), &ctx.mint.key(), &base);
    invoke(&create, &[ctx.authority.clone(),ctx.ata.clone(),ctx.vault.clone(),ctx.mint.clone(),ctx.system.clone(),ctx.base.clone(),ctx.associated.clone()])?;
    require!(amount(&ctx.ata,64)? == 0, ErrorCode::InvalidMintBuybackV3);
    let supply = amount(&ctx.mint,36)?;
    let mut data = BUY.to_vec(); data.extend_from_slice(&minimum.to_le_bytes());
    data.extend_from_slice(&quote.to_le_bytes()); data.push(0);
    let metas = accounts.iter().enumerate().map(|(i,a)| if a.is_writable {
        AccountMeta::new(a.key(), i == 6) } else { AccountMeta::new_readonly(a.key(), i == 6) }).collect();
    invoke_signed(&Instruction { program_id:PUMP, accounts:metas, data }, accounts, &[signer])?;
    let bought = amount(&ctx.ata,64)?;
    require!(bought >= minimum, ErrorCode::MintBuybackBurnFailedV3);
    let decimals = *ctx.mint.try_borrow_data()?.get(44).ok_or(ErrorCode::InvalidMintBuybackV3)?;
    let burn = anchor_spl::token_2022::spl_token_2022::instruction::burn_checked(
        &base, &ctx.ata.key(), &ctx.mint.key(), &ctx.vault.key(), &[], bought, decimals)?;
    invoke_signed(&burn, &[ctx.ata.clone(),ctx.mint.clone(),ctx.vault.clone(),ctx.base.clone()], &[signer])?;
    require!(amount(&ctx.ata,64)? == 0 && supply.checked_sub(amount(&ctx.mint,36)?) == Some(bought),
        ErrorCode::MintBuybackBurnFailedV3);
    let spent = before.checked_sub(ctx.vault.lamports()).ok_or(ErrorCode::InvalidMintBuybackV3)?;
    require!(spent > 0 && spent <= quote && spent <= limit, ErrorCode::MintWithdrawalBudgetExceededV3);
    Ok((spent,bought))
}
