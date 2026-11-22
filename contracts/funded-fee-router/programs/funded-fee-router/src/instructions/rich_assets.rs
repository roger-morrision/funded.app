//! Owner-controlled primary asset. Revisions are immutable audit records; the
//! current account prevents queued orders surviving an asset/venue switch.
use anchor_lang::prelude::*;
use anchor_spl::token_interface::Mint;
use super::rotate::assert_upgrade_owner;

pub const RICH_ASSETS_SEED: &[u8] = b"rich-assets-v1";
pub const RICH_REVISION_SEED: &[u8] = b"rich-assets-revision-v1";
pub const PUMP_SWAP: Pubkey = pubkey!("pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA");

#[account]
#[derive(InitSpace)]
pub struct RichAssetConfig {
    pub mint: Pubkey,
    pub market: Pubkey,
    pub token_program: Pubkey,
    pub revision: u64,
    pub venue: u8, // 0: PumpSwap SOL pool, 1: Pump SOL bonding curve
    pub authority: Pubkey,
    pub pending_authority: Pubkey,
}

#[error_code(offset = 6200)]
pub enum RichAssetError {
    #[msg("Invalid primary RICH asset or unsupported market")]
    InvalidMarket,
    #[msg("RICH configuration changed; request a new quote")]
    StaleRevision,
    #[msg("Only the current RICH administrator or nominated successor may perform this action")]
    InvalidAuthority,
}

#[derive(Accounts)]
#[instruction(revision: u64)]
pub struct ConfigureRichAssets<'info> {
    #[account(mut)]
    pub asset_authority: Signer<'info>,
    /// CHECK: Upgrade owner bootstrap verified on first configuration only.
    pub program: UncheckedAccount<'info>,
    /// CHECK: Verified loader state, not a caller-supplied authority.
    pub program_data: UncheckedAccount<'info>,
    #[account(init_if_needed, payer = asset_authority, space = 8 + RichAssetConfig::INIT_SPACE,
        seeds = [RICH_ASSETS_SEED], bump)]
    pub config: Account<'info, RichAssetConfig>,
    #[account(init, payer = asset_authority, space = 8 + RichAssetConfig::INIT_SPACE,
        seeds = [RICH_REVISION_SEED, &revision.to_le_bytes()], bump)]
    pub history: Account<'info, RichAssetConfig>,
    pub mint: InterfaceAccount<'info, Mint>,
    /// CHECK: Owner, discriminator, mint, quote and venue checked below.
    pub market: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

pub fn configure(ctx: Context<ConfigureRichAssets>, revision: u64, venue: u8) -> Result<()> {
    let authority = ctx.accounts.asset_authority.key();
    if ctx.accounts.config.revision == 0 {
        assert_upgrade_owner(&ctx.accounts.program.to_account_info(), &ctx.accounts.program_data.to_account_info(),
            &authority, ctx.program_id)?;
    } else {
        require!(ctx.accounts.config.authority == authority, RichAssetError::InvalidAuthority);
    }
    require!(ctx.accounts.config.revision.checked_add(1) == Some(revision), RichAssetError::StaleRevision);
    validate_market(&ctx.accounts.mint.key(), &ctx.accounts.market.to_account_info(), venue)?;
    let old_mint = ctx.accounts.config.mint;
    let pending_authority = ctx.accounts.config.pending_authority;
    for state in [&mut ctx.accounts.config, &mut ctx.accounts.history] {
        state.set_inner(RichAssetConfig { mint:ctx.accounts.mint.key(), market:ctx.accounts.market.key(),
            token_program:*ctx.accounts.mint.to_account_info().owner, revision, venue, authority, pending_authority });
    }
    emit!(RichAssetChanged { old_mint, mint:ctx.accounts.mint.key(), market:ctx.accounts.market.key(), revision, venue });
    Ok(())
}

#[derive(Accounts)]
pub struct ManageRichAuthority<'info> {
    pub authority: Signer<'info>,
    #[account(mut, seeds = [RICH_ASSETS_SEED], bump)]
    pub config: Account<'info, RichAssetConfig>,
}

pub fn propose_authority(ctx: Context<ManageRichAuthority>, successor: Pubkey) -> Result<()> {
    require!(ctx.accounts.config.authority == ctx.accounts.authority.key(), RichAssetError::InvalidAuthority);
    // Proposing the current authority cancels a pending transfer. Never permit
    // a zero administrator: recovery requires a new, explicitly accepted owner.
    require!(successor != Pubkey::default(), RichAssetError::InvalidAuthority);
    ctx.accounts.config.pending_authority = if successor == ctx.accounts.config.authority { Pubkey::default() } else { successor };
    emit!(RichAuthorityProposed { authority:ctx.accounts.config.authority, successor });
    Ok(())
}

pub fn accept_authority(ctx: Context<ManageRichAuthority>) -> Result<()> {
    let successor = ctx.accounts.authority.key();
    require!(successor != Pubkey::default() && ctx.accounts.config.pending_authority == successor,
        RichAssetError::InvalidAuthority);
    let prior = ctx.accounts.config.authority;
    ctx.accounts.config.authority = successor;
    ctx.accounts.config.pending_authority = Pubkey::default();
    emit!(RichAuthorityAccepted { prior, successor });
    Ok(())
}

#[event]
pub struct RichAuthorityProposed { pub authority: Pubkey, pub successor: Pubkey }
#[event]
pub struct RichAuthorityAccepted { pub prior: Pubkey, pub successor: Pubkey }

pub(crate) fn validate_market(mint: &Pubkey, market: &AccountInfo, venue: u8) -> Result<()> {
    let data = market.try_borrow_data()?;
    let native = anchor_spl::token::spl_token::native_mint::id();
    if venue == 0 {
        require!(market.owner == &PUMP_SWAP && data.len() >= 243
            && data[..8] == [241,154,109,4,17,177,109,188]
            && data[43..75] == mint.to_bytes() && data[75..107] == native.to_bytes(), RichAssetError::InvalidMarket);
        require!(data.get(243).copied().unwrap_or(0) == 0 && data.get(244).copied().unwrap_or(0) == 0,
            RichAssetError::InvalidMarket);
    } else if venue == 1 {
        let pump = super::buyback_curve_v3::PUMP;
        let expected = Pubkey::find_program_address(&[b"bonding-curve", mint.as_ref()], &pump).0;
        require!(market.key() == expected && market.owner == &pump && data.len() >= 81
            && data[..8] == [23,183,248,55,96,216,172,96] && data[48] == 0,
            RichAssetError::InvalidMarket);
        require!(data.get(81).copied().unwrap_or(0) == 0 && data.get(82).copied().unwrap_or(0) == 0,
            RichAssetError::InvalidMarket);
        if data.len() > 83 {
            require!(data.len() >= 115 && (data[83..115] == [0;32] || data[83..115] == native.to_bytes()),
                RichAssetError::InvalidMarket);
        }
    } else { return err!(RichAssetError::InvalidMarket); }
    Ok(())
}

pub(crate) fn resolve<'a, 'info>(program: &Pubkey, remaining: &'a [AccountInfo<'info>], revision: u64,
    mint: &Pubkey, market: &AccountInfo, token_program: &Pubkey, venue_program: &Pubkey, own_coin: bool)
    -> Result<(RichAssetConfig, &'a [AccountInfo<'info>])> {
    let (account, swap) = remaining.split_last().ok_or(RichAssetError::StaleRevision)?;
    let expected = Pubkey::find_program_address(&[RICH_ASSETS_SEED], program).0;
    require!(account.key() == expected && account.owner == program, RichAssetError::StaleRevision);
    let config = RichAssetConfig::try_deserialize(&mut &account.try_borrow_data()?[..])?;
    require!(revision > 0 && config.revision == revision, RichAssetError::StaleRevision);
    if !own_coin {
        require!(config.mint == *mint && config.market == market.key() && config.token_program == *token_program
            && *venue_program == if config.venue == 0 { PUMP_SWAP } else { super::buyback_curve_v3::PUMP },
            RichAssetError::InvalidMarket);
        validate_market(mint, market, config.venue)?;
    }
    Ok((config, swap))
}

#[event]
pub struct RichAssetChanged { pub old_mint: Pubkey, pub mint: Pubkey, pub market: Pubkey, pub revision: u64, pub venue: u8 }
