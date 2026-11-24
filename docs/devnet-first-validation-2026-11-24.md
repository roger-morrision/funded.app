# Devnet-first release validation — 24 November 2026

The owner directed this work to Devnet before any Mainnet deployment. Mainnet
activation remains disabled. The admission changes are committed in
`7e66010202f87e759a8084de57c3811062932a15` and have a
[scoped Claude Desktop approval](reviews/admission-followup-claude-2026-11-24.md).
That follow-up independently passed 11 focused tests; it is the AI review the
owner accepted, not a human audit or operational activation approval.

The reviewed admission commit was deployed to `https://funded.vip` on Devnet as
release `7e66010202f87e759a8084de57c3811062932a15-c96587db-602b-434f-be80-a472813d5a4a`,
image `sha256:ce88fa11126653ba57d040c0faf0f4fb4882f62299c82c863918b6eeb9a5342b`.
All six application services passed image/revision, cluster and health checks;
the public frontend and API matched the release. Full configuration comparison
allowed only the application image/revision and frontend identity to change.
Rollback to the previous accepted release is available. Concurrent UI work in
later commits is outside this particular deployment.

## Software checks

- Linux Node 24: 174 production integration tests and 67 security tests passed,
  with zero failures or skips. Chain responses in these suites are mocked.
- CI [45412660675](https://github.com/roger-morrision/funded.app/actions/runs/45412660675)
  succeeded for the exact admission commit.
- Local syntax and size checks passed for 1,257 JavaScript files and 1,526
  maintained files respectively. These workspace checks include concurrent work;
  the CI result above is bound to the committed revision.
- Against `https://funded.vip`, 36 public-page checks and 24 mocked
  navigation/outage checks passed. Two recent-caller-wallet checks skipped
  because no wallet was available in that directory. An initial run encountered
  missing Playwright trace files during cleanup; the isolated artifact run
  completed with 60 passes, two skips and no failures.

## Live Devnet financial evidence

The financial flows ran against application revision
`bfa004c61b214db7c8723d76ac274cc721c2db21`, program
`9H1r2nTZs6gQaheYTMaBWpH12JX6dCFj2Rvxg7Lno2Sm`, and full ProgramData SHA-256
`ac28f8e9002e6d42efd6e8bd320665192900b3232e00503edb7f757299456425`.
The final fixture mint is `9Fq77vh87p8vbQY8XbduHdK6Td2um1dFernhRcuDVvVg`.

The [evidence record](evidence/devnet-first-validation-2026-11-24.json)
preserves the original runs and their failures, their recovery, and a separate
read-only re-verification. It establishes:

- Finalized launch and registration, 30 million community reserve tokens,
  developer token escrow, and the exact 20 million lamport launch service fee.
- Buy and sell with exact 1% trade-fee credits of 30,000 and 29,260 lamports.
- Collection of 46,809 lamports and exact settlement allocation. Repeating the
  settlement returned its original signature.
- All three referral claims through signed wallet sessions, exact recipient
  credits and replay of each original signature.
- Creator wallet payment, creator reward funding, community funding and
  operations payout. The independent verifier reconstructs the allocation and
  checks all seven payout instructions, expected recipients, vault debits,
  recipient credits and on-chain withdrawal receipts at finalized commitment.
- All unused balances in generated fixture wallets refunded. Their private
  keys existed only in process memory; the existing Devnet QA funder was used
  only to fund and receive refunds from the fixtures.

Across all five fixtures, the QA funder's net balance decrease after refunds was
236,935,750 lamports (0.236935750 Devnet SOL).

The old harness expected additional recipient challenges and a creator-signed
202 response. The current app uses a signed wallet session and returns the
finalized protected payout with HTTP 200. The final raw run therefore records a
harness failure even though the creator payment completed; the separate chain
verification establishes the actual result. No launch or payout was duplicated
to reconcile that result. The creator SOL fee hold is retired; the 12-hour rule
protects ticker names, and developer token escrow is a separate mechanism.

Three existing paired-token conversions and ten existing agency buybacks were
also reverified against finalized chain receipts. They are historical receipt
checks, not newly executed conversions or buybacks.

The reusable read-only verifier is
[`scripts/verify-devnet-acceptance-payouts.mjs`](../scripts/verify-devnet-acceptance-payouts.mjs).
It accepts an explicit mint and collection signature in the configured Devnet
application environment. Its database transaction is read-only; it never loads
a signing key or submits a transaction.

## Remaining release conditions

These checks do not establish creator payout replay, matured developer escrow
withdrawal, holder/community end-user claims or graduation. They also do not
establish all 14 Mainnet financial acceptance cases. The deployed Devnet binary
and selected Mainnet candidate have different identities; successful Devnet
transactions are not proof of the candidate's live execution.

Before the owner redirected work to Devnet, both configured Mainnet readers
reported the selected program absent and the selected deployment payer had zero
SOL. No Mainnet transaction was signed or submitted. Actual deployed-candidate
verification, live production-role admission and Mainnet financial acceptance
remain required before Mainnet activation.
