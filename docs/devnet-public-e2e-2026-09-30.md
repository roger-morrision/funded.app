# Public Devnet end-to-end audit — 2026-09-30

Scope: the public `funded.vip` Devnet app after deployment of image
`fundedapp-app:qa-final-20260930` (`sha256:97c0d59913b41e69a72e91b64653241eac726b926d958c074acb2046192ae029`).
This is not a Mainnet readiness approval. No Mainnet transaction was attempted.

## Confirmed on the public deployment

- The app is healthy with zero restarts. Public HTTPS health, capabilities,
  readiness, and metadata default image requests returned 200. The public
  `#list` page rendered its 25,000 $FUNDED Devnet burn fee. The listing config,
  listing index, and burn-board APIs returned 200 on the container's public
  origin port `127.0.0.1:8788`.
- The release-contract verifier passed against local and public endpoints,
  including five assets and deep links, wallet-signed chat contract checks,
  and 20 parallel reads. Public and local API data matched: one verified launch,
  two fee collections, and two settlements. Receipt evidence checked both
  collections and both payouts. PostgreSQL accepted connections.
- The **verifier copied from the deployed image** passed 154/154 read-only
  browser checks against the public app. It blocked mutating API calls and
  transaction submissions. Evidence is under
  `.tmp-ui-evidence/public-frozen-verifier-20260930/`.
- The changed workspace verifier passed 143 checks and failed nine against
  both the public container and the frozen QA container. Its SHA-256 differs
  from the deployed verifier; those identical selector/layout failures are
  test drift, not a public-only deployment regression. These changed tests
  need reconciliation before they are used as a release gate.
- App, database, reward, receipt, and fee-collector containers were healthy.
  The buyback worker was running without a Docker health check. The reward
  worker reported one active program and zero blocked schedules; the receipt
  worker's last pass verified 4/4 records with zero unresolved records, but
  complete coverage was false.

## Transaction evidence and safety incident

A Devnet 0.003 SOL buy/sell round trip was submitted to the existing public FCQA
mint. Funding, buy, sell, token-account close, and refund all finalized without
chain errors. The ephemeral trader gained 1,807,422,756,525 token base units
on buy and held zero after sell. The configured app trading-fee destination
gained 15,000 and 14,703 lamports. Buy signature:
`4N9LCaMmSZcomrQZuf3f52eH3KMxaSZLL9wCPFsezLbfGDpkHqLTptFvcMdLBbyakaixXrF2SfJBaWtpc7qXvfVx`;
sell signature:
`5idbV2pkudgDWWVjY1fcLfbZo5ha3aFdbStTA5djYYvLUwnUsfsrk6nq6a6N2ZfvLzfBVsotVxrHvGhADEiuZS7G`.

**Do not count this round trip as clean release QA.** The test helper loaded
`.env.local`, whose claimant still resolved to the held `928ud…GUF` wallet,
and that key signed the 0.025 SOL funding transfer. No further transaction
was submitted after discovery. The three participant entries in `.env.local`
were synchronized to the already rotated QA wallet file and their public
addresses checked against the QA manifest. `run-devnet-trade-cycle.mjs` now
requires an explicit `--execute`, rejects a claimant that does not match the
rotated QA manifest, and offers a read-only `--preflight`. That preflight passed
for the rotated claimant and active FCQA curve. The old-key rejection was
observed before synchronization and before any transaction could be sent by
the guarded script.

## Blocking gaps

- **Legacy community vault:** FCQA's old program vault still holds exactly
  30,000,000 tokens and its funding receipt has a finalized, exact deposit
  delta. The public reserve API now derives a different, absent vault from
  the rotated router authority and reports `unfunded`. The original vault
  binds the retired authority, while the program's new-cycle instruction also
  requires the current router authority. Neither signer alone can create a
  new cycle for that vault. A reviewed on-chain migration or recovery path is
  required; do not re-fund it or rotate back to the exposed key.
- Public FCQA holder schedules are still indexing. Community claims are not
  activated. The indexer reports `waiting-for-sync` and receipt coverage is
  partial. No current holder or community claim was paid in this run.
- Pump's current FCQA vault accrual is 1,221,705 lamports, below the keeper's
  10,000,000-lamport collection threshold. The two public collections and
  their settlement/payout receipts predate this run; no new public collection,
  creator claim, referral payout, or buyback execution was verified here.
- No real X identity and linked wallet with a positive allocation was
  available, so X OAuth enrollment and payout remain unverified. No public
  migration-time $FUNDED holder claim or expiry sweep was exercised.
- The public paid-listing index is empty. A 25,000 $FUNDED listing burn and
  index entry were finalized and verified earlier on an isolated QA database,
  but a new listing payment was not submitted to the public database here.
- The app image differs from the currently running reward, receipt,
  fee-collector, and buyback worker images. The observed read-only worker
  checks passed, but image parity and new end-to-end worker payouts remain
  unverified after the app swap.

The isolated QA journey recorded in `docs/devnet-qa-2026-09-30.md` has
finalized Devnet creator, holder, SOL/token reward, listing, and three-level
referral deltas against disposable storage. Those are useful contract evidence,
not proof that the same flows currently complete on the public ledger.

**Status:** Public page/API deployment verified; full public Devnet transaction
and reward readiness blocked. Mainnet remains no-go.
