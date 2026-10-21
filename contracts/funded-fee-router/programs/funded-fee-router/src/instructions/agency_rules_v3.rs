use anchor_lang::prelude::*;
use crate::{constants::*, error::ErrorCode, state::AgencyConfigV3};
use super::{agency_policy_v3::{agency_category_targets, AGENCY_CONFIG_SEED}, rotate::assert_current_router_authority};

// Append-only extensions preserve all existing account offsets and policies.
pub const RULES_LEN: usize = 40;
const MAGIC: &[u8; 8] = b"FUNDRUL1";
pub const CONFIG_BASE: usize = 77;
pub const POLICY_BASE: usize = 383;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct AgencyRules {
    pub market_caps: [u64; 2], // USD micros, authority-attested; not a USD oracle.
    pub community_window_seconds: i64,
    pub promotion_interval_seconds: i64,
}
impl Default for AgencyRules {
    fn default() -> Self { Self { market_caps: [100_000_000_000, 300_000_000_000],
        community_window_seconds: COMMUNITY_WINDOW_SECONDS, promotion_interval_seconds: 86_400 } }
}
impl AgencyRules {
    pub fn validate(&self) -> Result<()> {
        require!(self.market_caps[0] >= 1_000_000 && self.market_caps[1] > self.market_caps[0]
            && self.market_caps[1] <= 1_000_000_000_000_000
            && self.market_caps.iter().all(|n| n % 1_000_000 == 0)
            && (300..=31_536_000).contains(&self.community_window_seconds)
            && (86_400..=2_592_000).contains(&self.promotion_interval_seconds), ErrorCode::InvalidAgencyPolicyV3);
        Ok(())
    }
}
pub fn read_rules(data: &[u8], base: usize) -> Result<AgencyRules> {
    if data.len() == base { return Ok(AgencyRules::default()); }
    require!(data.len() == base + RULES_LEN && &data[base..base+8] == MAGIC, ErrorCode::InvalidAgencyPolicyV3);
    let rule = AgencyRules {
        market_caps: [u64::from_le_bytes(data[base+8..base+16].try_into().unwrap()),
            u64::from_le_bytes(data[base+16..base+24].try_into().unwrap())],
        community_window_seconds: i64::from_le_bytes(data[base+24..base+32].try_into().unwrap()),
        promotion_interval_seconds: i64::from_le_bytes(data[base+32..base+40].try_into().unwrap()),
    };
    rule.validate()?; Ok(rule)
}
pub fn write_rules(data: &mut [u8], base: usize, rules: AgencyRules) -> Result<()> {
    rules.validate()?;
    require!(data.len() == base + RULES_LEN, ErrorCode::InvalidAgencyPolicyV3);
    data[base..base+8].copy_from_slice(MAGIC);
    data[base+8..base+16].copy_from_slice(&rules.market_caps[0].to_le_bytes());
    data[base+16..base+24].copy_from_slice(&rules.market_caps[1].to_le_bytes());
    data[base+24..base+32].copy_from_slice(&rules.community_window_seconds.to_le_bytes());
    data[base+32..base+40].copy_from_slice(&rules.promotion_interval_seconds.to_le_bytes());
    Ok(())
}

#[derive(Accounts)]
pub struct ConfigureAgencyRulesV3<'info> {
    #[account(mut)] pub authority: Signer<'info>,
    /// CHECK: Current authority is verified against the router.
    #[account(seeds = [SEED], bump)] pub legacy_router: UncheckedAccount<'info>,
    #[account(mut, seeds = [AGENCY_CONFIG_SEED], bump = config.bump,
        realloc = CONFIG_BASE + RULES_LEN, realloc::payer = authority, realloc::zero = true)]
    pub config: Account<'info, AgencyConfigV3>,
    pub system_program: Program<'info, System>,
}
pub fn configure(ctx: Context<ConfigureAgencyRulesV3>, units: [u32; 7], recipient: Pubkey,
    expected_revision: u64, market_caps: [u64; 2], community_window_seconds: i64,
    promotion_interval_seconds: i64) -> Result<()> {
    assert_current_router_authority(&ctx.accounts.legacy_router.to_account_info(), &ctx.accounts.authority.key(), ctx.program_id)?;
    agency_category_targets(10_000_000, units)?;
    require!(recipient != Pubkey::default() && ctx.accounts.config.revision == expected_revision, ErrorCode::InvalidAgencyPolicyV3);
    let rules = AgencyRules { market_caps, community_window_seconds, promotion_interval_seconds };
    rules.validate()?;
    let config = &mut ctx.accounts.config;
    config.protocol_units = units; config.promotion_recipient = recipient;
    config.revision = config.revision.checked_add(1).ok_or(ErrorCode::AmountOverflow)?;
    write_rules(&mut config.to_account_info().try_borrow_mut_data()?, CONFIG_BASE, rules)
}

pub fn community_window(program: &Pubkey, mint: &Pubkey, accounts: &[AccountInfo]) -> Result<i64> {
    let account = accounts.first().ok_or(ErrorCode::InvalidAgencyPolicyV3)?;
    let expected = Pubkey::find_program_address(&[b"mint-agency-policy-v3", mint.as_ref()], program).0;
    require!(account.key() == expected, ErrorCode::InvalidAgencyPolicyV3);
    if account.owner == program {
        use crate::state::MintAgencyPolicyV3;
        let data = account.try_borrow_data()?;
        let policy = MintAgencyPolicyV3::try_deserialize(&mut &data[..])?;
        require!(policy.mint == *mint, ErrorCode::InvalidAgencyPolicyV3);
        return Ok(read_rules(&data, POLICY_BASE)?.community_window_seconds);
    }
    require!(account.owner == &System::id() && account.data_is_empty(), ErrorCode::InvalidAgencyPolicyV3);
    Ok(COMMUNITY_WINDOW_SECONDS)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn extension_roundtrip_and_legacy_defaults() {
        assert_eq!(read_rules(&vec![0; POLICY_BASE], POLICY_BASE).unwrap(), AgencyRules::default());
        let rule = AgencyRules { market_caps:[1_000_000,2_000_000], community_window_seconds:300, promotion_interval_seconds:172_800 };
        let mut bytes = vec![0; POLICY_BASE + RULES_LEN];
        write_rules(&mut bytes,POLICY_BASE,rule).unwrap(); assert_eq!(read_rules(&bytes,POLICY_BASE).unwrap(),rule);
        bytes[POLICY_BASE] ^= 1; assert!(read_rules(&bytes,POLICY_BASE).is_err());
        assert!(read_rules(&vec![0; POLICY_BASE+1],POLICY_BASE).is_err());
    }
    #[test] fn invalid_settings_fail_closed() {
        let base=AgencyRules::default();
        assert!(AgencyRules { market_caps:[2,1], ..base }.validate().is_err());
        assert!(AgencyRules { community_window_seconds:299, ..base }.validate().is_err());
        assert!(AgencyRules { promotion_interval_seconds:86_399, ..base }.validate().is_err());
    }
}
