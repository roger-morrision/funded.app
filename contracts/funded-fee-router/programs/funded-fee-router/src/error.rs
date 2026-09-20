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
}
