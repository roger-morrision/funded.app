# RICH Devnet buyback activation work

The user authorized upgrading the existing Devnet contract and testing buy-and-burn before and after Pump.fun migration. This is not Mainnet authorization or evidence that the automatic fee-vault worker has executed successfully.

## Contract correction and validation

Review found reversed owner/mint arguments in the curve helper's wallet and bonding-curve associated-token-account derivations. Valid purchases would have been rejected before CPI. Both derivations now use the SPL Rust API's owner-first order. A native regression uses independently verified Devnet token-account addresses, accepts the canonical accounts through the address checks, and rejects the wrong curve token account. It stops at the unavailable native Rent sysvar; it does not mock a successful swap.

The corrected executable is 919,544 bytes, SHA-256 `cf11bbe12479fc931ec97479707b3912f5c0d99bf7815c40ebcef775f824a36c`. The ten existing LiteSVM account-setup and developer-lock tests passed against these exact bytes, including legacy-lock release compatibility. The address regression and all 315 application JavaScript tests passed. A second build from the final source reproduced the same hash.

The upgrade finalized at slot **520311193** in [transaction 5q9cMw9…](https://explorer.solana.com/tx/5q9cMw9CvEK8qLhymjMPabPuY9UQDYtDurgdJBQPRrgGhZXRQxNG64PfhPKZTLupqQgcH9AknA7Kes2vehgRf5F4?cluster=devnet). Exact executable bytes, zero padding, unchanged allocation and retained upgrade authority were verified. Full ProgramData SHA-256 is `da4ffff61db136d8aae0cc9528e61ecf6a24cc43e8b73bacfb81b20062b0b1ee`. The 4,672,162,360-lamport upload buffer was closed and refunded to the authority; the upgrade transaction fee was 5,000 lamports. [Upgrade evidence](evidence/rich-devnet-contract-upgrade-2026-11-09.json).

Runtime trust records were updated only after these deployed bytes were verified. The existing production-build fixture remains historical evidence and is not a reviewed current Mainnet artifact.

## Finalized isolated market lifecycle

Test mint: `BFrpkRScmF3xAmPsBKevVBzcXeALha8TGoyRA9gfWYQm`, symbol **RICH**, created through Pump.fun on Devnet. Its canonical migrated pool is `ALHSQzXX64tx623D8E7eMKPXsrvmYL5hWyksnhPTw24W`. The app's existing configured RICH mint and balances were not replaced.

| Check | Result |
| --- | --- |
| Curve buy and atomic BurnChecked | Finalized; exact supply decrease and zero receiving-token balance verified |
| Curve completion | Finalized purchase of the remaining curve supply and atomic burn |
| Completed-curve quote | Rejected; no stale curve quote used |
| PumpSwap migration | Finalized; canonical pool resolved by app market code |
| Migrated buy and atomic BurnChecked | Finalized; exact supply decrease and zero receiving-token balance verified |
| Fee-vault automatic execution | Not tested; independent signer is absent |

The [machine-readable evidence](evidence/rich-devnet-lifecycle-2026-11-09.json) contains signatures, slots, amounts and independently checked top-level BurnChecked instructions. These are isolated wallet transactions, not router-vault executions or worker receipts.

The first test runner stopped at an incorrect BN numeric comparison in its graduation budget check; the corrected test continued using the same mint. Its refund also failed the rent-exemption check. Another test runner was interrupted by a concurrent app container redeployment after the post-migration burn was verified. Their ephemeral private keys were never saved; 1.255384960 Devnet SOL remains in those two disposable wallets and is not recoverable. The middle runner refunded its unused SOL successfully. No Mainnet funds were used.

## Activation gate

Local app configuration has the upgrade authority and worker signers, but neither `FUNDED_DEVNET_BUYBACK_PRICE_SIGNER` nor `FUNDED_DEVNET_BUYBACK_PRICE_SIGNER_URL`. The on-chain price-signer configuration account is also absent. The existing authority or worker key must not be substituted for the independent custodian.

An operator must provide the independent public signer and HTTPS endpoint or their existing configuration-file reference. Both the upgrade authority and that signer must approve `configure_buyback_price_signer`. Then verify actual router-vault purchases, exact vault debits, supply reductions, immutable receipts and replay rejection before enabling curve automation. The current app mint has no Pump bonding curve; the isolated new mint above is not automatically substituted into the contract's approved-asset identity. A fee-vault lifecycle test needs an explicitly reviewed test deployment bound to that fixture.

The 5 SOL aggregate trigger, order limits, price checks, protected authority reserve and Mainnet gates remain in place. The curve flag remains disabled until the above checks pass.
