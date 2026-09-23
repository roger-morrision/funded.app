use anchor_lang::prelude::*;

#[error_code]
pub enum ErrorCode {
    #[msg("Router account is already initialized")]
    AlreadyInitialized,
    #[msg("Router account policy header is invalid")]
    InvalidRouterHeader,
    #[msg("Claim record already exists")]
    ClaimAlreadyUsed,
    #[msg("Destination count must equal amount count")]
    DestinationAmountMismatch,
    #[msg("Payout amount must be positive")]
    InvalidAmount,
    #[msg("Payout amounts exceed the available router balance")]
    InsufficientRouterBalance,
    #[msg("Claim amount overflow")]
    AmountOverflow,
    #[msg("The mint router does not match the expected mint and policy")]
    InvalidMintRouter,
    #[msg("Settlement destination is not allowed")]
    InvalidDestination,
    #[msg("Reward cycle timing is invalid")]
    InvalidRewardTiming,
    #[msg("Reward cycle asset does not match this payout")]
    InvalidRewardAsset,
    #[msg("Reward proof does not match the committed cycle manifest")]
    InvalidRewardProof,
    #[msg("Reward cycle is not payable yet")]
    RewardCycleNotPayable,
    #[msg("Reward payout exceeds the committed cycle total")]
    RewardTotalExceeded,
    #[msg("Reward token account does not match the recipient and mint")]
    InvalidRewardTokenAccount,
}
