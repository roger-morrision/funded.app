use anchor_lang::prelude::*;
use super::rotate::assert_upgrade_owner;
use crate::error::ErrorCode;

pub const PRICE_SIGNER_SEED: &[u8] = b"buyback-price-signer-v1";

#[account]
#[derive(InitSpace)]
pub struct BuybackPriceConfig {
    pub price_signer: Pubkey,
}

#[derive(Accounts)]
pub struct ConfigureBuybackPriceSigner<'info> {
    #[account(mut)]
    pub upgrade_owner: Signer<'info>,
    #[account(constraint = new_price_signer.key() != upgrade_owner.key() @ ErrorCode::InvalidRotationAuthority)]
    pub new_price_signer: Signer<'info>,
    /// CHECK: Bound to this program and its ProgramData by assert_upgrade_owner.
    pub program: UncheckedAccount<'info>,
    /// CHECK: The upgrade owner must match the loader's current authority.
    pub program_data: UncheckedAccount<'info>,
    #[account(init_if_needed, payer=upgrade_owner, space=8+BuybackPriceConfig::INIT_SPACE,
        seeds=[PRICE_SIGNER_SEED], bump)]
    pub price_config: Account<'info, crate::instructions::buyback_price::BuybackPriceConfig>,
    pub system_program: Program<'info, System>,
}

pub fn configure(ctx: Context<ConfigureBuybackPriceSigner>) -> Result<()> {
    assert_upgrade_owner(&ctx.accounts.program, &ctx.accounts.program_data,
        &ctx.accounts.upgrade_owner.key(), ctx.program_id)?;
    ctx.accounts.price_config.price_signer = ctx.accounts.new_price_signer.key();
    Ok(())
}
