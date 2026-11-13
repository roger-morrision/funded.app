#![allow(ambiguous_glob_reexports)]

pub mod initialize;
#[cfg(not(any(feature = "devnet-v3-program", feature = "mainnet-v3-program")))]
pub mod settle;
#[cfg(not(any(feature = "devnet-v3-program", feature = "mainnet-v3-program")))]
pub mod repair;
pub mod reward;
pub mod community;
pub mod rotate;
#[cfg(not(any(feature = "devnet-v3-program", feature = "mainnet-v3-program")))]
pub mod recover_wrapped_sol;
pub mod policy_v3;
pub mod protected_v3;
pub mod automation_v3;
pub use automation_v3::*;
#[cfg(any(feature = "devnet-v3-program", feature = "mainnet-v3-program"))]
pub mod agency_policy_v3;
#[cfg(any(feature = "devnet-v3-program", feature = "mainnet-v3-program"))]
pub mod agency_disburse_v3;
#[cfg(any(feature = "devnet-v3-program", feature = "mainnet-v3-program"))]
pub mod agency_buyback_v3;
#[cfg(any(feature = "devnet-v3-program", feature = "mainnet-v3-program"))]
pub mod buyback_v3;
#[cfg(any(feature = "devnet-v3-program", feature = "mainnet-v3-program"))]
pub mod buyback_curve_v3;
#[cfg(feature = "historical-qa-recovery")]
pub mod recover_qa_v3;
#[cfg(any(feature = "devnet-v3-program", feature = "mainnet-v3-program"))]
pub mod buyback_price;

pub use initialize::*;
#[cfg(not(any(feature = "devnet-v3-program", feature = "mainnet-v3-program")))]
pub use settle::*;
#[cfg(not(any(feature = "devnet-v3-program", feature = "mainnet-v3-program")))]
pub use repair::*;
pub use reward::*;
pub use community::*;
pub use rotate::*;
#[cfg(not(any(feature = "devnet-v3-program", feature = "mainnet-v3-program")))]
pub use recover_wrapped_sol::*;
pub use policy_v3::*;
pub use protected_v3::*;
#[cfg(any(feature = "devnet-v3-program", feature = "mainnet-v3-program"))]
pub use agency_policy_v3::*;
#[cfg(any(feature = "devnet-v3-program", feature = "mainnet-v3-program"))]
pub use agency_disburse_v3::*;
#[cfg(any(feature = "devnet-v3-program", feature = "mainnet-v3-program"))]
pub use agency_buyback_v3::*;
#[cfg(any(feature = "devnet-v3-program", feature = "mainnet-v3-program"))]
pub use buyback_v3::*;
#[cfg(feature = "historical-qa-recovery")]
pub use recover_qa_v3::*;
#[cfg(any(feature = "devnet-v3-program", feature = "mainnet-v3-program"))]
pub use buyback_price::*;

#[cfg(any(feature = "devnet-v3-program", feature = "mainnet-v3-program"))]
pub mod agency_rules_v3;
#[cfg(any(feature = "devnet-v3-program", feature = "mainnet-v3-program"))]
pub use agency_rules_v3::*;
#[cfg(any(feature = "devnet-v3-program", feature = "mainnet-v3-program"))]
pub mod token_fees_v3;
#[cfg(any(feature = "devnet-v3-program", feature = "mainnet-v3-program"))]
pub use token_fees_v3::*;
