# $RICH before and after Pump.fun migration

The app resolves the configured $RICH mint's on-chain market on each fresh quote. It does not interpret a failed RPC request as migration.

| Flow | Active bonding curve | After migration |
| --- | --- | --- |
| Buy $RICH | Pump bonding-curve quote and wallet purchase | Verified PumpSwap pool quote and wallet purchase |
| Promotion and paid-listing burn pricing | Curve reserves and current SOL/USD quote | Pool reserves and current SOL/USD quote |
| $RICH price and market-cap display | Curve spot price and live mint supply | Pool spot price and live mint supply |
| Manual burn and launch/listing burn proof | SPL/Token-2022 mint and wallet balances; no pool required | Same mint and balance verification |
| Holder eligibility and airdrop snapshots | Token holdings; no $RICH migration requirement | Same holdings verification |
| Fee-funded automatic buyback | New atomic curve-buy-and-burn contract path, pending activation | Existing atomic PumpSwap-buy-and-burn path |

A completed curve with no usable migrated pool returns unavailable and retains pending funds. It never falls back to the completed curve's old price. Existing directly created PumpSwap markets with no bonding curve can still use their configured verified pool.

## Automatic buyback activation

The source now includes a curve path for category-6 $RICH budgets in both V3 fee-policy layouts. The vault remains the buyer; the authority fronts account rent. The router reconstructs the bounded purchase, burns the received tokens in the same transaction, checks the vault debit and supply reduction, and records its normal immutable receipt with the curve address as the market. The normal 5 SOL aggregate trigger, smaller protected orders, independent price cosigner, daily budget and retry/reconciliation rules remain in force.

`FUNDED_V3_CURVE_BUYBACK_ENABLED` defaults to false. This is intentional: the currently accepted on-chain bytecode only understands PumpSwap. Building or deploying the web app does not upgrade the Solana program.

Before enabling it:

1. Review the new contract candidate and independent price signer's curve handling.
2. Exercise a pre-migration purchase and burn on Devnet with confirmed vault debit, token receipt, supply reduction and replay rejection. Test the completed-curve/migration boundary and the migrated pool too.
3. Upgrade the approved fee-router, update its reviewed bytecode hash and verify/extend the buyback lookup table for curve accounts. Preserve the existing independent price signer and protected operator reserve.
4. Enable the flag only for that reviewed deployment. A Mainnet release also needs the real $RICH mint and canonical future/migrated pool in its reviewed manifest; placeholders cannot execute.

Current verification is local SDK fixtures, receipt-verifier fixtures, Rust compilation and an SBF build candidate. These are not evidence of a new finalized on-chain curve buyback. Existing Mainnet activation gates remain unchanged.

Pump reference: [bonding-curve buy and migration instructions](https://github.com/pump-fun/pump-public-docs/blob/main/docs/PUMP_PROGRAM_README.md).
