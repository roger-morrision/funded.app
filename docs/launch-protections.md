# Launch protections

New funded.vip launches record a versioned protection policy using the verified
Pump creation transaction. Creator SOL earnings have no 12-hour hold, including
launches saved under the earlier version-1 fee-hold policy. Normal settlement,
minimum amounts, authorization and payout scheduling still apply.

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
- New launches escrow the declared initial developer token purchase in the same
  transaction as creation, purchase and community-reserve funding. The standalone
  Token-2022 program fixes the beneficiary, amount and Solana clock plus 43,200
  seconds. There is no early-release instruction. Amounts above 20% of mint supply,
  mint/freeze authorities and custody-bypassing extensions are rejected. Only
  MetadataPointer and TokenMetadata mint extensions are accepted.
- For a developer purchase, the escrow instruction carries an eight-byte trailing
  service-quote nonce instead of a separate Memo instruction. The compiled Anchor
  handler ignores this receipt marker; the API verifies it against the saved quote
  and independently requires the exact SOL transfer and treasury balance increase.
  The launch lookup table must include current Pump fee and buyback recipients.
  New launch metadata uses the compact `https://funded.vip/m/<mint>` alias; old
  metadata links and image origins remain valid. Packet-size checks keep creation,
  reserve, escrow and service payment atomic.
- After unlock, a permissionless instruction transfers the original allocation to
  the developer's associated token account. The coin page offers a claim button.
  Public signatures are saved before broadcast; uncertain sends are reconciled
  without signing again. Finalized failure or expiry with absent historical status
  permits a new attempt. Success requires the exact release instruction, escrow
  state and matching token debits and credits.
- Program `EPywNBhXu8QEeukKfwKwo7WPBw6KoSbUGyKgcMFPH9pT` requires a pinned complete
  ProgramData hash in `FUNDED_DEVELOPER_LOCK_PROGRAM_DATA_SHA256`. Missing or changed
  deployments fail closed before launch. It is upgradeable: the deployment
  authority can change program code. This is not immutable custody or an independent
  security audit. The existing fee router is unchanged.
- Existing launches are not retroactively escrowed. Zero developer purchases need
  no escrow. Extra tokens sent to escrow are outside the original allocation and
  cannot be claimed through this instruction. Later purchases and undisclosed
  wallets are outside this lock. It does not guarantee no dumping.

## Bundle-wallet signals

`GET /api/tokens/:mint/launch-protection` reports verified escrow state and cached
risk evidence. `?scan=1` starts a rate-limited finalized-receipt scan. Limits: first
60 seconds, 200 signature references, 24 trade receipts, eight wallets, six prior
funding references and three funding receipts per wallet. Funding checks cover
direct signed native SOL transfers of at least 0.01 SOL in the previous 24 hours.
Same-slot funding must precede the buy in the block's transaction order.

Three distinct buyers sharing a funding source produce a shared-funder signal;
buys within ten seconds additionally produce suspected coordination. Same-slot
buys alone are only timing signals. Exchanges and services can fund unrelated
wallets. These labels never establish a Jito bundle or common ownership. Known
shared sources can be excluded with `FUNDED_BUNDLE_SHARED_SERVICE_FUNDERS`.

The panel displays receipt links, scan limits, incomplete coverage and unknown
holdings. No indicators in scanned data does not mean bundle-free. This detector
observes activity; it does not block trading or defeat undisclosed wallets.

Validation: `tests/developer-token-lock.test.mjs`, `tests/bundle-wallet-detection.test.mjs`,
`tests/launch-protections.test.mjs`, `tests/v3-reward-funding-route.test.mjs`, and
browser fixtures. The compiled escrow is tested in LiteSVM by
`contracts/funded-fee-router/programs/developer-token-lock/tests/escrow.rs`, including
early withdrawal, exact unlock, replay, beneficiary mismatch and unsafe mints.
Simulated-clock tests do not represent a live 12-hour Devnet wait. Deployment and
live Devnet receipt evidence must be recorded separately.
