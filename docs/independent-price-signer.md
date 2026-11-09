# Devnet price signer

The signer uses its own key and process. It independently fetches finalized chain and market data; it does not accept a price, reserve balance or RPC endpoint supplied by the app. This is service/key separation under the same operator, not an externally operated custodian or independent security audit.

`scripts/run-price-signer.mjs` starts the service. `compose.price-signer.yml` isolates its key from the app and workers. The endpoint must be behind HTTPS; it has no published container port. A dedicated 32-byte authentication token is required. Mount only this token in the app using `FUNDED_DEVNET_BUYBACK_PRICE_SIGNER_TOKEN_FILE`; never mount the signing key there.

## Allowlist

The JSON file selected by `PRICE_SIGNER_CONFIG_FILE` contains `cluster: "devnet"`, a decimal `maxDailyLamports`, and a `programs` array. Each entry requires the exact `programId`, `programDataSha256`, `authority`, `upgradeAuthority`, approved RICH `mint` and `pool`, decimal `maxOrderLamports`, and boolean `allowCurve`. There are no identity defaults. Startup and each request check deployed ProgramData bytes and retained upgrade authority. An upgrade stops signing until its verified hash is reviewed and updated.

The service permits at most 1 SOL per order and 5 SOL of reservations over a rolling 24 hours; deployment configuration may set lower limits. These are service ceilings, not changes to the app's 5 SOL aggregate trigger, older-fee eligibility, liquidity clipping or protected authority reserve.

## Approval checks

- Devnet genesis and recent finalized RPC time.
- Exactly the approved transaction payer and separate price signer.
- One approved category-6 RICH buy-and-burn instruction. Own-coin agency execution is deliberately unsupported by this service.
- Exact policy, category vault, token accounts, receipt PDA and current router authority.
- Finalized policy budget equals vault custody above rent; the receipt does not already exist.
- Current Pump curve or approved PumpSwap pool, canonical accounts and allowlisted fee recipients.
- Missing canonical Pump creator-vault rent is paid by the authority before a curve purchase, outside the category's purchase budget. The signer independently checks the exact rent deficit; receipt verification binds the setup transfer.
- At most 0.25% of quote liquidity per order, current minimum-output protection, bounded compute and priority fees.
- Independently simulated vault debit, mint supply reduction, empty receiving ATA, immutable receipt and matching policy debit.
- The existing 3 SOL authority reserve.

Only after these checks does the service durably reserve its budget and sign the exact message. It never submits transactions. The app verifies the detached signature and adds the transaction payer signature.

`PRICE_SIGNER_JOURNAL` must be persistent and writable only by the signer user. Run one instance against each journal. Reservations are fsynced before signing, survive restarts, and conservatively consume the daily budget even when a transaction is not submitted. A different transaction for the same fee vault waits until the previous signed blockhash expires. Never delete the journal to work around these checks.

## Activation sequence

1. Provision the separate key, authentication token, protected state directory and reviewed allowlist.
2. Configure the public key on-chain with `configure_buyback_price_signer`, signed by both the program upgrade owner and incoming price signer; verify the finalized configuration account.
3. Test actual category-vault buy-and-burn before and after migration on an isolated Devnet fixture. Record finality, exact SOL and supply deltas, receipts and replay rejection.
4. Deploy the signer behind HTTPS. Check unauthorized requests fail and use the matching token file in the app.
5. Configure `FUNDED_DEVNET_BUYBACK_PRICE_SIGNER` and `FUNDED_DEVNET_BUYBACK_PRICE_SIGNER_URL`. Enable curve automation only after its verification gate passes. Observe the worker's finalized execution or accurately report that it is waiting for eligible funds.

Mainnet signing is rejected. A healthy HTTP endpoint alone does not establish successful fee-vault automation.

## November 9 fee-vault acceptance

Actual isolated category-6 executions passed before and after Pump migration. See [finalized evidence](evidence/rich-devnet-fee-vault-lifecycle-2026-11-09.json). The curve spent 99,000 lamports and burned 349,598.355159 RICH; the migrated pool spent 100,000 lamports and burned 16,797.911822 RICH. Both receiving token accounts ended at zero, policy debits matched, weak-output requests were refused, and receipt replays failed.

The AMM quote now applies the existing 1% output floor explicitly: the SDK's `buyQuoteInput.base` is the estimated output, while its slippage parameter increases maximum input. The router fixes input, so using that estimate directly had incorrectly allowed zero output slippage. SOL limits are unchanged.

Pump automatically migrated this fixture immediately after curve completion. The test's expectation of an observable migration gap was therefore invalid; finalized market reads selected the real pool. The live app's mint was not replaced with the fixture.

An earlier fixture runner exited during public-RPC throttling before cleanup. Its unsaved disposable key left 2.411283520 Devnet SOL and 4.672162360 SOL of program-data rent unrecoverable, plus small fixture account rents. Subsequent funded runners refunded unused balances and verified zero disposable-wallet balances. No Mainnet funds were used.

## Active remote deployment

Activated November 9 on `https://richpad.fun`, Devnet only, release `e7a40513bc3e42dffef82568867305f303111d6c`. The remote-only signer public key is `6GStEooNK4PwNL1c4fqf5yUSt91mkZMuD5pJEL2qVywU`; its finalized configuration is at slot 520327631. The app receives only the authentication token, never the price-signing key. Runtime inspection confirmed separate key mounts, a read-only signer container and no published signer port. HTTPS identity, unauthorized-request rejection and authenticated invalid-transaction rejection passed from the actual app network.

All eight active services are healthy. The buyback worker completed a matching-build ready cycle; public launch readiness and price-signer readiness are true. Verified live fee funding is 17,687 lamports, so automation is enabled and waiting for eligible funds. No live automatic purchase is claimed. The 5 SOL aggregate trigger and older-fee rules remain unchanged. The isolated fee-vault burns establish both market paths separately.

Own-coin agency execution remains disabled, and its worker is stopped in the `disabled-own-coin-buyback` Compose profile. Disabled optional agency actions do not block normal launches or RICH buybacks; enabling agency actions or active X publishing still requires matching worker evidence. Mainnet remains disabled. [Activation evidence](evidence/rich-devnet-auto-buyback-activation-2026-11-09.json).

The final release passed 340 local tests, syntax checks for 983 JavaScript files, source-size checks and remote container tests. It also includes the coordinated browser read-RPC recovery fix. The final cutover preserved the running RPC gateway and database. An earlier rollout rolled back because the disabled agency process was still supervised; the resulting short app interruption was reconciled in the other chat before the final cutover.
