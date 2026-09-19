use anchor_lang::prelude::*;
use crate::{constants::*, error::ErrorCode};

#[derive(Accounts)]
pub struct RepairHeader<'info> {
    pub authority: Signer<'info>,
    #[account(mut, seeds = [SEED], bump)]
    pub router: UncheckedAccount<'info>,
}

pub fn handler(ctx: Context<RepairHeader>) -> Result<()> {
    let router = &ctx.accounts.router;
    let mut data = router.try_borrow_mut_data()?;
    require!(data.len() == ROUTER_DATA_LEN, ErrorCode::InvalidRouterHeader);
    require!(&data[41..73] == ctx.accounts.authority.key.as_ref(), ErrorCode::InvalidRouterHeader);
    data[0..8].copy_from_slice(MAGIC);
    data[8] = VERSION;
    data[9..41].copy_from_slice(&POLICY_HASH);
    Ok(())
}
