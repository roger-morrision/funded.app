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
    #[msg("Community snapshot or migration evidence is invalid")]
    InvalidCommunitySnapshot,
    #[msg("Community claim window has expired or is closed")]
    CommunityClaimClosed,
    #[msg("Community claim window has not expired")]
    CommunityClaimStillOpen,
    #[msg("Community remainder route is not permitted")]
    InvalidCommunityRemainder,
    #[msg("Router authority rotation is not approved by the program upgrade owner")]
    InvalidRotationAuthority,
    #[msg("Wrapped SOL account is not the mint router's native mint ATA")]
    InvalidWrappedSolAccount,
    #[msg("Mint fee ledger does not match the authorized creator and mint")]
    InvalidMintFeeLedger,
    #[msg("Settlement exceeds the on-chain 80/20 fee allocation")]
    FeeShareExceeded,
    #[msg("Settlement fee share must be creator or protocol")]
    InvalidFeeShare,
    #[msg("Legacy shared-router settlement is disabled until funds are migrated")]
    LegacySettlementDisabled,
    #[msg("Reward cycle commitments exceed the unreserved vault balance")]
    RewardReserveExceeded,
    #[msg("Community snapshot was not approved by the program upgrade owner")]
    CommunitySnapshotNotApproved,
    #[msg("The v3 protocol rates must total exactly 2,000,000 of 10,000,000 units")]
    InvalidProtocolFeeRates,
    #[msg("The v3 policy does not match this mint, creator, or authority")]
    InvalidMintFeePolicyV3,
    #[msg("The v3 settlement must include the seven category vaults in order")]
    InvalidMintFeeVaultV3,
    #[msg("The v3 withdrawal category or recipient is not permitted")]
    InvalidMintWithdrawalV3,
    #[msg("The v3 category vault lacks the requested amount")]
    InsufficientMintVaultV3,
    #[msg("The v3 router balance does not match the verified collection amount")]
    MintClaimAmountMismatchV3,
}
