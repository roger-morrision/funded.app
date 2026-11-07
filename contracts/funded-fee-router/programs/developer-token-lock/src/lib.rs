use anchor_lang::prelude::*;
use anchor_spl::{associated_token::AssociatedToken, token_interface::{self, Mint, TokenAccount, TokenInterface, TransferChecked}};
use anchor_spl::token_2022::spl_token_2022::{extension::{BaseStateWithExtensions, ExtensionType, StateWithExtensions}, state::Mint as SplMint};

declare_id!("EPywNBhXu8QEeukKfwKwo7WPBw6KoSbUGyKgcMFPH9pT");
pub const LOCK_SECONDS: i64 = 43_200;
pub const SEED: &[u8] = b"developer-lock-v1";

#[program]
pub mod developer_token_lock {
    use super::*;

    pub fn initialize_and_lock(ctx: Context<InitializeAndLock>, amount: u64) -> Result<()> {
        require!(amount > 0 && amount <= ctx.accounts.mint.supply / 5, LockError::InvalidAmount);
        require!(ctx.accounts.mint.mint_authority.is_none() && ctx.accounts.mint.freeze_authority.is_none(), LockError::UnsafeMint);
        require_keys_eq!(ctx.accounts.token_program.key(), anchor_spl::token_2022::ID, LockError::UnsafeMint);
        {
            let info = ctx.accounts.mint.to_account_info();
            let data = info.try_borrow_data()?;
            let mint = StateWithExtensions::<SplMint>::unpack(&data)?;
            for extension in mint.get_extension_types()? {
                require!(matches!(extension, ExtensionType::MetadataPointer | ExtensionType::TokenMetadata), LockError::UnsafeMint);
            }
        }
        // A pre-created ATA is permitted, but it must never delegate custody.
        require!(ctx.accounts.vault.delegate.is_none() && ctx.accounts.vault.close_authority.is_none(), LockError::UnsafeVault);
        let before = ctx.accounts.vault.amount;
        token_interface::transfer_checked(CpiContext::new(ctx.accounts.token_program.key(), TransferChecked {
            from:ctx.accounts.source.to_account_info(), mint:ctx.accounts.mint.to_account_info(),
            to:ctx.accounts.vault.to_account_info(), authority:ctx.accounts.creator.to_account_info(),
        }), amount, ctx.accounts.mint.decimals)?;
        ctx.accounts.vault.reload()?;
        require!(ctx.accounts.vault.amount.checked_sub(before) == Some(amount), LockError::InvalidAmount);
        let now = Clock::get()?.unix_timestamp;
        let lock = &mut ctx.accounts.lock;
        lock.mint = ctx.accounts.mint.key(); lock.creator = ctx.accounts.creator.key();
        lock.amount = amount; lock.locked_at = now;
        lock.unlock_at = now.checked_add(LOCK_SECONDS).ok_or(LockError::InvalidClock)?;
        lock.released_at = 0; lock.bump = ctx.bumps.lock;
        emit!(DeveloperTokensLocked { mint:lock.mint, creator:lock.creator, amount, unlock_at:lock.unlock_at });
        Ok(())
    }

    pub fn release(ctx: Context<Release>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        require!(now >= ctx.accounts.lock.unlock_at, LockError::StillLocked);
        require!(ctx.accounts.lock.released_at == 0, LockError::AlreadyReleased);
        let mint = ctx.accounts.lock.mint; let creator = ctx.accounts.lock.creator;
        let bump = [ctx.accounts.lock.bump]; let seeds = [SEED, mint.as_ref(), creator.as_ref(), &bump];
        let signers = [&seeds[..]];
        let vault_before = ctx.accounts.vault.amount;
        let recipient_before = ctx.accounts.destination.amount;
        token_interface::transfer_checked(CpiContext::new_with_signer(ctx.accounts.token_program.key(), TransferChecked {
            from:ctx.accounts.vault.to_account_info(), mint:ctx.accounts.mint.to_account_info(),
            to:ctx.accounts.destination.to_account_info(), authority:ctx.accounts.lock.to_account_info(),
        }, &signers), ctx.accounts.lock.amount, ctx.accounts.mint.decimals)?;
        ctx.accounts.vault.reload()?;
        ctx.accounts.destination.reload()?;
        require!(vault_before.checked_sub(ctx.accounts.vault.amount) == Some(ctx.accounts.lock.amount)
            && ctx.accounts.destination.amount.checked_sub(recipient_before) == Some(ctx.accounts.lock.amount),
            LockError::InvalidAmount);
        ctx.accounts.lock.released_at = now;
        emit!(DeveloperTokensReleased { mint, creator, amount:ctx.accounts.lock.amount });
        Ok(())
    }
}

#[derive(Accounts)]
pub struct InitializeAndLock<'info> {
    #[account(mut)] pub creator: Signer<'info>,
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(mut, token::mint=mint, token::authority=creator, token::token_program=token_program)]
    pub source: InterfaceAccount<'info, TokenAccount>,
    #[account(init, payer=creator, space=8+DeveloperTokenLock::INIT_SPACE,
        seeds=[SEED, mint.key().as_ref(), creator.key().as_ref()], bump)]
    pub lock: Account<'info, DeveloperTokenLock>,
    // The app creates the ATA earlier in the same transaction. Keep custody
    // and canonical-address checks here; account creation needs no PDA signer.
    #[account(mut, associated_token::mint=mint,
        associated_token::authority=lock, associated_token::token_program=token_program)]
    pub vault: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Release<'info> {
    #[account(mut)] pub payer: Signer<'info>,
    /// CHECK: Immutable beneficiary is bound by the lock's has_one constraint.
    pub creator: UncheckedAccount<'info>,
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(mut, seeds=[SEED, mint.key().as_ref(), creator.key().as_ref()], bump=lock.bump, has_one=mint, has_one=creator)]
    pub lock: Account<'info, DeveloperTokenLock>,
    #[account(mut, associated_token::mint=mint, associated_token::authority=lock, associated_token::token_program=token_program)]
    pub vault: InterfaceAccount<'info, TokenAccount>,
    #[account(mut, associated_token::mint=mint,
        associated_token::authority=creator, associated_token::token_program=token_program)]
    pub destination: InterfaceAccount<'info, TokenAccount>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[account]
#[derive(InitSpace)]
pub struct DeveloperTokenLock {
    pub mint: Pubkey, pub creator: Pubkey, pub amount: u64,
    pub locked_at: i64, pub unlock_at: i64, pub released_at: i64, pub bump: u8,
}
#[event]
pub struct DeveloperTokensLocked { pub mint:Pubkey, pub creator:Pubkey, pub amount:u64, pub unlock_at:i64 }
#[event]
pub struct DeveloperTokensReleased { pub mint:Pubkey, pub creator:Pubkey, pub amount:u64 }
#[error_code]
pub enum LockError {
    #[msg("Developer tokens remain locked for 12 hours.")] StillLocked,
    #[msg("Developer allocation was already released.")] AlreadyReleased,
    #[msg("Developer allocation must be positive and at most 20% of supply.")] InvalidAmount,
    #[msg("Mint authorities or extensions can bypass safe custody.")] UnsafeMint,
    #[msg("Vault custody is invalid.")] UnsafeVault,
    #[msg("Invalid chain clock.")] InvalidClock,
}
