pub mod constants;
pub mod error;
pub mod instructions;
pub mod state;

use anchor_lang::prelude::*;

pub use constants::*;
pub use instructions::*;
pub use state::*;

declare_id!("2tRrwGFzRCDmrVY7U6dny4Ea1RqVm7cSrCYFULmK7tik");

#[program]
pub mod mnt_c_data_dev_apps_funded_app_contracts_funded_fee_router {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        initialize::handler(ctx)
    }
}
