# Launch protections

New funded.vip launches record a versioned protection policy using the verified
Pump creation transaction's block time. Existing saved launches retain their
original fee payout rules.

- A ticker cannot be reused for 12 hours on funded.vip, including different
  capitalization. Archived launches still count. This does not reserve a ticker
  across Solana or prevent lookalike names or artwork.
- Signed metadata takes an atomic, durable 30-minute reservation before wallet
  transaction approval. Another mint cannot take that ticker concurrently. The
  browser stops a delayed approval with less than five minutes left on the lease.
- On lease expiry, the server checks both the proposed mint and the prior mint.
  Existing accounts cannot start a new reservation. RPC failure blocks reuse. An
  on-chain mint whose registration is missing conservatively holds its ticker
  until 12 hours after the reservation deadline; recovering registration uses
  the exact verified launch time instead.
- Registration rechecks the ticker inside the same ledger transaction that saves
  the launch. PostgreSQL uses the existing advisory lock; the file ledger uses
  its serialized update queue. Registration retries preserve the original policy.
- When the creator wallet share is positive, creator SOL payouts are blocked for
  12 hours after launch. Fees can accrue and settle during the lock. Manual,
  signed, automatic, and audited residual payout requests all use the same guard.
  Other beneficiaries remain eligible. At expiry, normal payout prerequisites,
  minimums and keeper scheduling still apply; payment is not promised at the
  exact unlock second.
- This is an application authority signing restriction, not a new smart-contract
  timelock. The current contract requires the platform authority for these
  payouts. It does not prevent the creator from selling tokens they hold and does
  not constitute a guarantee against dumping.

Validation: `tests/launch-protections.test.mjs`,
`tests/launch-executor.test.mjs`, `tests/v3-reward-funding-route.test.mjs`,
`tests/postgres-repositories.test.mjs`, and
`tests/browser/launch-protections.spec.js`. Clock-boundary and payout fixtures
are local/mocked; they do not represent a live 12-hour on-chain payout test.
