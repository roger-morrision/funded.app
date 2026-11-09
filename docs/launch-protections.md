# Launch protections

Product workflows: [all-page guide](product-guide.md). Documentation scope and dated evidence: [index](README.md).

New richpad.fun launches record a versioned protection policy using the verified
Pump creation transaction. Developer token locks do not delay creator SOL earnings, including
launches saved under the earlier version-1 fee-hold policy. Normal settlement,
minimum amounts, authorization and payout scheduling still apply.

- A ticker cannot be reused for 12 hours on richpad.fun, including different
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
  transaction as creation, purchase and community-reserve funding. Choose **6h,
  12h, 24h or 48h** beside Developer buy before signing; **12h is the default**.
  The merged router fixes the beneficiary, amount and deadline using the Solana
  clock at launch plus the selected duration. The saved deadline cannot be changed
  and there is no early-release instruction. Amounts above 20% of mint supply,
  mint/freeze authorities and custody-bypassing extensions are rejected. Only
  MetadataPointer and TokenMetadata mint extensions are accepted.
- For a developer purchase, the escrow instruction carries an eight-byte trailing
  service-quote nonce instead of a separate Memo instruction. The compiled Anchor
  handler ignores this receipt marker; the API verifies it against the saved quote
  and independently requires the exact SOL transfer and treasury balance increase.
  The launch lookup table must include current Pump fee and buyback recipients.
  New launch metadata uses the compact `https://richpad.fun/m/<mint>` alias; old
  metadata links and image origins remain valid. Packet-size checks keep creation,
  reserve, escrow and service payment atomic.
- After unlock, a permissionless instruction transfers the original allocation to
  the developer's associated token account. In Portfolio, open the coin, connect
  the original developer wallet and choose **Claim unlocked developer tokens**.
  Sign the release in your wallet; reaching the deadline does not itself send tokens.
  Public signatures are saved before broadcast; uncertain sends are reconciled
  without signing again. Finalized failure or expiry with absent historical status
  permits a new attempt. Success requires the exact release instruction, escrow
  state and matching token debits and credits.
- New Devnet launches use merged router `9H1r2nTZs6gQaheYTMaBWpH12JX6dCFj2Rvxg7Lno2Sm`.
  `FUNDED_DEVELOPER_LOCK_PROGRAM_ID` must match `FUNDED_V3_FEE_ROUTER_PROGRAM_ID`;
  both `FUNDED_DEVELOPER_LOCK_PROGRAM_DATA_SHA256` and `FUNDED_V3_PROGRAM_DATA_SHA256`
  must pin its complete finalized ProgramData hash. The embedded executable
  commitment must also match. Unsupported periods or unverified deployments stop
  preparation before a promotion burn or launch signing.
- The standalone legacy escrow `EPywNBhXu8QEeukKfwKwo7WPBw6KoSbUGyKgcMFPH9pT`
  still serves its existing 12h locks, pinned separately with
  `FUNDED_DEVELOPER_LOCK_LEGACY_PROGRAM_DATA_SHA256`. Release uses each launch's
  recorded program. Existing locks retain their original deadlines.
- The programs are upgradeable: their deployment authority can change program
  code. This is not immutable custody or an independent security audit.
- Existing launches are not retroactively escrowed. Zero developer purchases need
  no escrow. Extra tokens sent to escrow are outside the original allocation and
  cannot be claimed through this instruction. Later purchases and undisclosed
  wallets are outside this lock. It does not guarantee no dumping.

## Lock options and review

| Option | On-chain duration | Selection |
| --- | ---: | --- |
| 6h | 21,600 seconds | Optional |
| 12h | 43,200 seconds | Default |
| 24h | 86,400 seconds | Optional |
| 48h | 172,800 seconds | Optional |

The review and mobile signing summary show the chosen duration for a nonzero
developer buy. Changing it requires a fresh cost review. The signed launch policy
and recovery record preserve the selection; receipt verification checks the exact
instruction, allocation and saved duration. A zero developer buy creates no escrow,
regardless of the selected period. These options do not change ticker protection,
community-airdrop timing or creator SOL payment conditions.

`GET /api/launch-reserve-config` reports the default `lockSeconds: 43200` and the
verified `lockPeriodsSeconds: [21600, 43200, 86400, 172800]`. An older deployment
can support only 12h; the client must not submit an unsupported period.

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

Lock validation: `tests/developer-lock-periods.test.mjs`,
`tests/merged-escrow.test.mjs` and `tests/app-account-setup.test.mjs`. Compiled merged
escrow checks live in
`contracts/funded-fee-router/programs/funded-fee-router/tests/developer_escrow.rs`.
They cover all four periods, early withdrawal, exact unlock, replay, fixed
beneficiary, unsafe mints, invalid durations and legacy compatibility.
Simulated-clock tests do not represent waiting through a live lock period.
[Devnet deployment evidence](developer-lock-periods-2026-11-08.md) records the
finalized deposits and exact durations for all four options; early release was
rejected in simulation. Mainnet availability requires separate verification.
