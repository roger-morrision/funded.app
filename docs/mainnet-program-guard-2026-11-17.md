# Mainnet program: trimmed build and protocol guard (2026-11-17)

This change answers the on-chain findings of the [vault audit](security/vault-audit-2026-11-16.md) for the Mainnet build (`--features mainnet-v3-program`) and moves non-custody work out of that build. Devnet (`devnet-v3-program`) and legacy builds keep their account layouts and behavior; their compiled-bytecode suites pass unchanged. Nothing was deployed.

## One program on Mainnet

Mainnet needs one program: the merged `funded-fee-router` (fee router with the developer-token escrow inside it). The standalone `developer-token-lock` only serves old Devnet locks.

The Mainnet build no longer contains:

| Removed from Mainnet | Why | Where the work lives now |
|---|---|---|
| `initialize_mint_v3`, `disburse_mint_v3` (unprotected policy) | The authority alone could pay categories 1-4 to any wallet | Protected policies only (`initialize_protected_mint_v3`, approval + disbursement) |
| Legacy v2 settle, repair, migrations, QA recovery | Already excluded before this change | — |

The AI agency (budgets, agent buybacks, promotion billing) and token-budget conversion **are included** on Mainnet. On Mainnet, conversion also requires the independent price signer (audit finding 4); the caller appends the price config PDA and the price signer after the swap accounts. Allowed conversion pools are a build input, `FUNDED_MAINNET_CONVERSION_POOLS="<paired mint>:<pool>,..."`, empty until reviewed. Agency payouts are counted against the daily outflow cap.

Holder snapshots, reward amounts and Merkle trees, referral eligibility and the daily bonus were already computed by the app; the program only checks proofs and moves funds.

Mainnet build-check size: **1,037,448 bytes** with the agency and no conversion pool (CI fixture identity), against 1,043,400 bytes before this change. With one conversion pool configured the build is 1,292,128 bytes (about 6.6 SOL of locked rent at 5,080 lamports per byte). The Devnet build keeps its 1,066,000-byte size; only embedded source line numbers changed.

## Protocol guard (audit findings 2 and 3)

The Mainnet router header is the 74-byte legacy header followed by 57 guard bytes: guardian (32), paused (1), daily cap in lamports (u64), current UTC day (i64), lamports already counted that day (u64). The JavaScript view is [protocol-guard.js](../protocol-guard.js).

Roles:

- **Router authority**: the hot operator key used by workers through the internal signer service. It cannot change the guard.
- **Guardian**: a separate key kept off the server (for example a hardware wallet). It can **pause** and **cancel unpaid reward cycles**. It cannot unpause or change limits, and it can never be the router authority (checked at configuration and at rotation).
- **Upgrade owner**: the wallet that holds the program's upgrade authority (a single wallet; no multisig is required). It configures the guardian and the daily cap and is the only key that can unpause.

Rules enforced on chain:

1. **Pause.** While paused, every instruction that checks the router authority fails: settlements, approvals, disbursements, reward cycles, buybacks, community openings. Proof-based claims of already-approved community drops are not paused; their snapshots are approved by the upgrade owner.
2. **Daily outflow cap.** External SOL outflows approved by the authority count against a per-UTC-day cap: protected disbursements that leave the protocol (moves into the program's own reward vault are internal) and every new SOL reward cycle (counted when it is created). The cap is **zero after initialization**, so nothing can leave until the upgrade owner sets it. Token-denominated payouts are covered by the pause but not by the lamport cap.
3. **Review delay for reward cycles.** A new cycle's `payout_at` must be at least 24 hours after creation. During that window the guardian can call `cancel_reward_cycle`; the unpaid commitment returns to the vault and no leaf of that cycle can be paid.
4. **Buybacks** still require the separate price signer.

New instructions (Mainnet build only): `configure_protocol_guard(daily_cap_lamports)`, `set_protocol_pause(paused)`, `cancel_reward_cycle()`. The app signer refuses to sign all three (`server/signer-policy.mjs`). `node scripts/protocol-guard-instruction.mjs …` prints them unsigned for the upgrade owner or guardian to sign.

## App changes

- Reward planning on Mainnet sets `payout_at` to at least now + 24 h + 15 min (`plannedRewardPayoutAt`). The scheduler commits frozen cycles on chain as soon as their manifest is ready (`server/reward-cycle-commit.mjs`) and pays them after `payout_at`. Devnet timing is unchanged.
- The daily bonus stores the chosen Mainnet `payout_at` with its payout record.
- Reward-cycle creation and protected disbursements pass the router header writable (required for cap accounting; harmless on Devnet).
- Router verification accepts the 131-byte Mainnet header and reports `protocol-paused`; the reward chain reports it as a readiness reason.
- Outflow alerts also report changes of guardian, pause state and daily cap.

Findings 1 (keys out of the web app), 6 (admin withdrawal caps, second approver, delay) and 7 (outflow alerts) were addressed on 2026-11-16 by the internal signer service, admin withdrawal policy and outflow alerts.

## Verification

- Compiled-bytecode tests (LiteSVM), Mainnet build: `protocol_guard` 3 passed (closed until configured, guardian cannot be the operator, 24 h delay, cap and daily reset, writable header, pause/unpause roles, guardian cancel, normal payout after the delay), `app_account_setup` 2 passed, `developer_escrow` 7 passed.
- Devnet build: `app_account_setup` 3, `reward_cycle_expiry` 1, `developer_escrow` 7 passed. Default build: 2, 1, 7 passed.
- JavaScript: full unit suite plus `tests/protocol-guard.test.mjs`.
- CI (`contracts.yml`) now also runs `protocol_guard` against the Mainnet build-check binary.

## Admin limits and withdrawals

Admin withdrawals need the code emailed to the admin address, every time. The second-admin approval and its delay are off by default (`FUNDED_ADMIN_WITHDRAW_REVIEW_LAMPORTS` unset); the per-withdrawal and 24-hour caps stay. The admin page's **App limits** panel edits these caps and the outflow alert thresholds (`server/app-limits.mjs`); saving needs the emailed code like every other admin write and is recorded in the admin audit.

## What remains before a Mainnet deployment (owner actions)

1. Keep the program upgrade authority in a wallet that is not on the server, and choose a separate guardian key.
2. Choose the Mainnet program ID, $RICH mint and pool; build with `scripts/build-mainnet-contract.sh` and record the candidate.
3. Commission an independent professional audit of the exact Mainnet binary.
4. After deployment: `initialize`, then `configure_protocol_guard` from the upgrade owner with a daily cap sized to expected creator and holder payouts, then the price signer. Verify the header with `verifyFeeRouterAccount` before enabling any worker.
5. Lifting Mainnet write gates (`server/network-write-policy.mjs`) and the launch guard stays a separate, explicit decision.
