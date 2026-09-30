use anchor_lang::prelude::*;
use anchor_lang::solana_program::bpf_loader_upgradeable;
use crate::{constants::*, error::ErrorCode};

#[derive(Accounts)]
pub struct RotateAuthority<'info> {
    pub old_authority: Signer<'info>,
    pub new_authority: Signer<'info>,
    pub app_owner: Signer<'info>,
    #[account(mut, seeds = [SEED], bump)]
    pub legacy_router: UncheckedAccount<'info>,
    /// CHECK: Must be this executable program under the upgradeable loader.
    pub program: UncheckedAccount<'info>,
    /// CHECK: Must be the ProgramData account named by this program.
    pub program_data: UncheckedAccount<'info>,
}

fn assert_upgrade_owner(program: &AccountInfo, program_data: &AccountInfo, app_owner: &Pubkey, program_id: &Pubkey) -> Result<()> {
    let loader = bpf_loader_upgradeable::id();
    require!(program.key == program_id && program.owner == &loader && program.executable, ErrorCode::InvalidRotationAuthority);
    require!(program_data.owner == &loader, ErrorCode::InvalidRotationAuthority);
    let program_bytes = program.try_borrow_data()?;
    let data_bytes = program_data.try_borrow_data()?;
    require!(program_bytes.len() >= 36 && program_bytes[0..4] == 2u32.to_le_bytes()
        && program_bytes[4..36] == program_data.key.to_bytes(), ErrorCode::InvalidRotationAuthority);
    require!(data_bytes.len() >= 45 && data_bytes[0..4] == 3u32.to_le_bytes()
        && data_bytes[12] == 1 && data_bytes[13..45] == app_owner.to_bytes(), ErrorCode::InvalidRotationAuthority);
    Ok(())
}

pub fn assert_current_router_authority(router: &AccountInfo, authority: &Pubkey, program_id: &Pubkey) -> Result<()> {
    require!(router.owner == program_id, ErrorCode::InvalidRouterHeader);
    let data = router.try_borrow_data()?;
    require!(data.len() == ROUTER_DATA_LEN && &data[0..8] == MAGIC && data[8] == VERSION
        && data[9..41] == POLICY_HASH && data[41..73] == authority.to_bytes(), ErrorCode::InvalidRouterHeader);
    let (expected, bump) = Pubkey::find_program_address(&[SEED], program_id);
    require!(router.key() == expected && data[73] == bump, ErrorCode::InvalidRouterHeader);
    Ok(())
}

pub fn handler(ctx: Context<RotateAuthority>) -> Result<()> {
    let old = ctx.accounts.old_authority.key();
    let new = ctx.accounts.new_authority.key();
    let owner = ctx.accounts.app_owner.key();
    require!(old != new && old != owner && new != owner && new != Pubkey::default(), ErrorCode::InvalidRotationAuthority);
    assert_upgrade_owner(&ctx.accounts.program.to_account_info(), &ctx.accounts.program_data.to_account_info(), &owner, ctx.program_id)?;

    let legacy = ctx.accounts.legacy_router.to_account_info();
    require!(legacy.owner == ctx.program_id, ErrorCode::InvalidRouterHeader);
    let mut legacy_data = legacy.try_borrow_mut_data()?;
    require!(legacy_data.len() == ROUTER_DATA_LEN && &legacy_data[0..8] == MAGIC && legacy_data[8] == VERSION
        && legacy_data[9..41] == POLICY_HASH, ErrorCode::InvalidRouterHeader);
    let current = &legacy_data[41..73];
    require!(current == old.as_ref() || current == new.as_ref(), ErrorCode::InvalidRotationAuthority);
    let (_, bump) = Pubkey::find_program_address(&[SEED], ctx.program_id);
    require!(legacy_data[73] == bump, ErrorCode::InvalidRouterHeader);

    for router in ctx.remaining_accounts {
        require!(router.is_writable && router.owner == ctx.program_id, ErrorCode::InvalidMintRouter);
        let mut data = router.try_borrow_mut_data()?;
        require!(data.len() == MINT_ROUTER_DATA_LEN && &data[0..8] == MINT_ROUTER_MAGIC
            && data[8] == MINT_ROUTER_VERSION && data[9..41] == POLICY_HASH, ErrorCode::InvalidMintRouter);
        require!(data[41..73] == old.to_bytes() || data[41..73] == new.to_bytes(), ErrorCode::InvalidRotationAuthority);
        let mint = Pubkey::new_from_array(data[73..105].try_into().map_err(|_| error!(ErrorCode::InvalidMintRouter))?);
        let (expected, mint_bump) = Pubkey::find_program_address(&[MINT_ROUTER_SEED, mint.as_ref()], ctx.program_id);
        require!(router.key() == expected && data[105] == mint_bump, ErrorCode::InvalidMintRouter);
        data[41..73].copy_from_slice(new.as_ref());
    }
    legacy_data[41..73].copy_from_slice(new.as_ref());
    emit!(RouterAuthorityRotated { old_authority: old, new_authority: new, mint_router_count: ctx.remaining_accounts.len() as u32 });
    Ok(())
}

#[event]
pub struct RouterAuthorityRotated {
    pub old_authority: Pubkey,
    pub new_authority: Pubkey,
    pub mint_router_count: u32,
}
