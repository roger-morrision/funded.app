# Devnet acceptance — October 4, 2026

**Update:** Subsequent user-funded wallets enabled five fresh public Devnet transactions; see [funded follow-up](devnet-funded-followup-2026-10-04.md). The initial run below is retained as historical evidence.

**Initial result: blocked for a fresh full application journey.** Public Devnet chain reads and seventeen historical transaction checks passed. No new funded transaction was submitted. Historical receipt checks do not establish that the current app, workers, current source, or public website work end to end.

## Current live checks

The run at 04:32 UTC verified the official RPC's Devnet genesis `EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG` and finalized slot `507242461`. The deployed fee-router and Pump programs are executable. The shared router has its expected policy layout and rotated authority `7epA9KQ5wkwo5wZ5kcY8CfVUvpwVJoAMz2RNqt2ZwK5Y`; the retired exposed authority is absent.

Program `2tRrwGFzRCDmrVY7U6dny4Ea1RqVm7cSrCYFULmK7tik` has:

- ProgramData account: `DrQmTSxHsRACofnAA6oLgfrSxQfLZFDvNmnu3Rz37EVA`
- Complete ProgramData SHA-256: `9ce7c1137d250ffa84668e65b53546b7c1d4239eaf888957c41316708cda977b`
- Executable SHA-256: `e9da7cd43232f0997786112c97f339c7b53d425881b66baf6b9dccf7bf85bc16`
- Upgrade authority: `3NMjsHsau8uw598UKZqbKq8dhFjGMEYpdx5wU72Kfh1P`

These hashes match the later [October 1 Pump fee rollout](devnet-pump-fee-e2e-2026-10-01.md), superseding the earlier community-claim rollout hash. They have **not** been matched to a reproducible build of the current checkout, which includes subsequent contract changes. No upgrade or authority change was attempted.

## Blocking external dependencies

1. `https://funded.vip/api/health` returned HTTP 530; a separate direct request returned Cloudflare error 1033. The public origin was not available for metadata publication, launch registration, indexing, wallet claims, or UI signing tests.
2. An initial isolated faucet probe returned JSON-RPC `-32603 Internal error`. The recorded harness then requested 1 Devnet SOL for a new in-memory payer and received HTTP/RPC 429 on both bounded attempts, five seconds apart. The faucet response says the daily limit was reached or faucet ran dry. Requests stopped; no alternate wallet/faucet scheme bypassed the limit.
3. The runtime reports no application secret bindings, RPC credentials or configured custody signers. Existing saved wallets were not loaded. Router-authorized payouts, operator buybacks, X OAuth and worker schedules require a configured isolated Devnet deployment.

Keys were created only in process memory. No secret was written, logged or committed. Public addresses and safe evidence are in [live-acceptance.json](audit/devnet-2026-10-04/live-acceptance.json). The unfunded temporary keypairs are discarded when the process ends.

## Historical finalized receipts independently rechecked

The official Devnet RPC returned each October 1 transaction at `finalized` commitment with no execution error and the expected account changes. Full signatures, account addresses, token deltas and slots are in [historical-receipts.json](audit/devnet-2026-10-04/historical-receipts.json).

| Historical flow | Exact observation rechecked | Result |
| --- | --- | --- |
| Fresh token launch | Pump CreateV2 execution, expected new mint and positive minted token balances | Passed |
| Post-graduation buy and sell | Equal source/recipient changes of 471,552,674,318 base units; trader credit on buy and debit on sell | Passed |
| Boost, Pro and Premier launches | Pump CreateV2 and same-transaction FUNDED BurnChecked for 25,000, 100,000 and 250,000 tokens | Passed |
| Paid listing burn | FUNDED BurnChecked for 25,000 tokens with matching aggregate token debit | Passed |
| Creator-fee collection | Mint router credited 8,500,537 lamports | Passed |
| Holder allocation funding | Router debited and holder vault credited 850,054 lamports | Passed |
| Three holder payouts | Exact recipient credits and vault debits of 23,437, 795,348 and 31,267 lamports | Passed |
| Community reserve funding | Equal source debit and recipient credit of 30,000,000,000,000 token base units | Passed |
| Community drop opening | Equal source debit and recipient credit of 30,000,000,000,000 token base units | Passed |
| Community wallet claim | Equal source debit and recipient credit of 42,353,538 token base units | Passed |
| Buyback and burn | Parsed `BurnChecked` of 2,232,461 base units; aggregate token-account debit equals burn | Passed |
| Buyback refund | Mint router credited exactly 834 lamports | Passed |

The holder payouts sum to 850,052 lamports, leaving the documented two-lamport allocation remainder. Launch and trade evidence is from the September 30 fresh-token and October 1 burn audits. Promotion launches were standalone chain tests in the original audit, not full UI launches. The paid-listing burn recheck does not verify current listing registration, memo binding, or replay handling. These checks verify historical transaction contents, not the current off-chain allocation ledger, a fresh scheduled worker run, exact snapshot reconstruction, current total mint supply, or current website state. The burn check verifies the instruction and token-account conservation in that transaction; it does not reconstruct mint supply before and after from current account reads.

## Reproducible commands and safeguards

```sh
# Managed proxy environments need Node's standard fetch proxy support.
NODE_USE_ENV_PROXY=1 node scripts/devnet-acceptance.mjs --read-only
NODE_USE_ENV_PROXY=1 node scripts/devnet-acceptance-history.mjs
node --test tests/devnet-acceptance.test.mjs

# Only when the faucet and required services are available:
NODE_USE_ENV_PROXY=1 node scripts/devnet-acceptance.mjs --execute
```

The acceptance harness checks a hard-coded Devnet genesis before funding and before every transaction, never loads saved wallet secrets, limits faucet attempts to two, uses public HTTP polling for finalized receipts, and journals the signed signature before submission so an ambiguous response cannot trigger a newly signed replacement. An isolated low-level Pump launch/buy/sell/fee-collection path is available after faucet funding, but was **not executed** in this run. That path uses disposable test metadata and is explicitly not the app's atomic-reserve launch flow. Its fee recipient is funded above rent exemption before trades. All on-chain signing code remains unvalidated live here because funding failed.

The focused tests cover network rejection before any wallet/faucet action, rejection of incomplete/failed finality, and acceptance of the expected Devnet genesis. They do not stand in for successful Devnet transactions.

## Fresh isolated local-chain result

The newly built current contract binary passed a fresh transaction journey on an isolated loopback Agave 4.1.2 validator, with program SHA-256 `0f7eaa00e61da306e38b8833af3dac829fe38321eae8555247e7bd6efa4241e4`:

- Created new authority, creator and recipient wallets and fresh token mints using local faucet funding.
- Funded the reward escrow with 100 tokens and opened the community drop without a creator signature.
- Independently read the finalized opening receipt at local slot 22; the server reserve parser reported the exact verified active drop and Merkle root.
- Claimed exactly 100 tokens for the recipient and independently read the finalized claim at local slot 55. Escrow and drop token accounts finished at zero.
- Rejected an incorrect reserve amount, a replayed opening, and a duplicate claim.

[Local transaction evidence](audit/devnet-2026-10-04/local-community-acceptance.json) includes finalized receipts and exact token balances. The validator used its own `/tmp` ledger, no public cluster accounts, and was stopped afterward. These signatures exist only in that local ledger and are not public explorer links. This does not verify real Pump graduation, historical snapshot reconstruction, public RPC behavior, or Mainnet readiness.

The existing `scripts/verify-community-router-local.mjs` fixture initially lacked the required `remainderAmount` and failed before opening. The fixture now sets the exact zero remainder, and the claim check now waits for finalization. The corrected harness passed against a fresh ledger. Reproduction requires a reviewed current SBF build loaded into a local Agave validator at port 18899, then `node scripts/verify-community-router-local.mjs`.

## Required before calling Devnet ready

Restore the public Devnet origin and provide an isolated funded test setup, then run fresh launch with atomic reserve → registration → curve buy/sell → fee collection/allocation → creator/referral/holder claims → graduation → post-graduation trade → community snapshot/open/claim → fee-funded buyback/burn, including replay, wrong-recipient, expiry and uncertain-submission cases. Exercise paid listing/Boost with dedicated Devnet FUNDED inventory and X claims with a consenting OAuth-linked test account. Independently test real mobile wallet handoff and restoration. Verify the deployed binary against the reviewed release build before attributing new source fixes to public Devnet.

No Mainnet transaction, deployment, funding or authority change occurred. This evidence does not establish Mainnet readiness or a next-day go-live date.
