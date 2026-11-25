# Vault and treasury security audit — 2026-11-16

Scope: `contracts/funded-fee-router` (fee router program, ~5,100 lines of Rust), the server code that holds signing keys, and the admin withdrawal path. This was a focused review of every way funds can leave a vault, not a full line-by-line audit; a professional audit is still needed before any program reaches Mainnet.

**Current exposure.** richpad.fun on Mainnet runs in non-program mode: no Richpad program vaults exist there, and the server refuses to start with any signing key (`server/environment.mjs`). The Mainnet treasury wallet `M1HfA8vPXwGGn8uv5p9BZSYjsh4jhxhoMfDx2sGsj4M` is a plain wallet whose key is not on the server. The findings below matter today for Devnet (funded.vip) and become critical the day the programs go to Mainnet.

## What is already done well

- **Program-owned vaults.** Vaults are PDAs; funds move only through program instructions.
- **Withdrawal budgets.** Each category is capped on-chain: `withdrawn_lamports ≤ paid_lamports` per category, and directed shares are capped by their targets.
- **One-time approvals.** Withdrawal approvals are single-use PDAs (`consumed` flag) bound to mint, category, beneficiary, recipient and amount.
- **Recipients can't be vaults.** A vault can't pay into another vault or into its own router. Reward-vault destinations are PDA-checked.
- **No double payouts.**
  - Reward payouts need a Merkle proof.
  - One `RewardPayment` PDA per cycle and recipient blocks double payment.
  - `distributed_amount ≤ total_amount`.
  - Reserves are tracked with `outstanding`.
- **Pinned swap programs.** Swap CPIs are pinned to the Pump and PumpSwap program IDs and their PDAs, and conversion pools are hard-coded.
- **Buyback protections.** Buybacks need a separate price signer, which can't be the authority. Bought tokens are burned.
- **Authority rotation.** Rotation needs the old, new and program-upgrade-owner signatures.
- **QA recovery pinned.** The QA recovery path is fixed to the Devnet program ID, mint, creator and amounts.
- **Admin withdrawals.** These can only go to the signed-in admin wallet, the admin wallet must co-sign, and the server rebuilds and compares the exact transaction. The admin JWT and email confirmation are in front of this.

## Findings (most severe first)

### 1. Critical — the public web app holds the program authority and treasury keys
On Devnet, the internet-facing `app` container (published port 8789) is given:
- `FUNDED_ROUTER_AUTHORITY_SECRET_KEY_FILE`, `FUNDED_V3_ROUTER_AUTHORITY_SECRET_KEY_FILE` (the program's root authority);
- `SOLANA_KEEPER_SECRET_KEY_FILE`;
- the treasury signers `FUNDED_ADMIN_BOOST_SIGNER_FILE`, `FUNDED_ADMIN_OPERATIONS_SIGNER_FILE`, `FUNDED_ADMIN_PUMP_REVENUE_SIGNER_FILE`, `FUNDED_ADMIN_TRADE_FEE_SIGNER_FILE`;
- `SOLANA_DEVNET_CREATOR_SECRET_KEY_FILE`.

`server/fee-router-service.mjs` loads them into the web process. Any remote-code bug, malicious npm package or container escape in the web app exposes every key at once, and with it everything findings 2–5 let the authority do.

**Fix.** Move all signing into separate signer services:
- no public port, reachable only by the workers;
- each service holds one key and enforces its own rules (allowed instruction, recipient, amount, daily cap);
- the web app only asks for a signature and never holds a key.

The existing `price-signer` service is the right pattern to copy.

### 2. High — one hot key is the on-chain root of trust
The router authority alone can:
- **Create reward cycles** with any Merkle root, up to the whole vault balance, payable immediately. The only rule is `payout_at ≥ cutoff_at > 0`, so there is no minimum delay.
- **Approve category 1–4 withdrawals** to any system account (`approve_protected_withdrawal_v3`), together with an automation record or a creator signature.
- **Initialize the automation record** that fixes category 1–4 recipients permanently (`initialize_mint_automation_v3`). This needs only the authority, not the creator.
- **Run token conversions** (see finding 4).

If that key leaks, the attacker can publish a cycle that pays them and claim it in the same minute.

**Fix.**
1. Make the authority a Squads multisig (e.g. 2-of-3 on hardware wallets).
2. Have hot workers use a narrower operator key, and add those roles to the program.
3. In the program, require `payout_at ≥ now + 24h` for new cycles so there is time to notice and stop a bad one.
4. Cap each cycle at a share of the vault.

### 3. High — no on-chain pause and no withdrawal rate limit
No pause or circuit breaker exists in the program, and there is no per-day outflow cap per vault. Once a key or a bug is abused, nothing on-chain slows it down.

**Fix.** Add a pause flag, checked by every outflow instruction and controlled by a separate guardian key. Add per-vault daily outflow caps.

### 4. Medium — token conversion has no independent price check
`convert_token_budget_v3` uses a `min_sol_out` chosen by the authority alone. Buybacks need the separate price signer; conversions don't. A wrong or malicious `min_sol_out` (e.g. 1) lets the conversion budget be sandwiched or sold at any price.

**Fix.** Require the same independent price signer, or an on-chain maximum price impact.

### 5. Medium — upgrade authority not confirmed
Whoever holds the program's upgrade authority can replace the program and take every vault. I did not check on-chain who holds it.

**Fix.** Before Mainnet, put the upgrade authority behind a multisig with a timelock. Once the program is stable, make it immutable.

### 6. Medium — admin treasury withdrawals have no cap, delay or second approver
The destination is locked to the signed-in admin wallet and that wallet must co-sign, which is good. But one admin wallet plus its confirmation email can withdraw a full treasury balance at once.

**Fix.**
- A per-withdrawal and per-day cap.
- A 24-hour delay above a threshold.
- A second admin's approval for large amounts.
- An alert on every withdrawal.

### 7. Low — monitoring not verified
I didn't find real-time alerts on vault and treasury outflows, or a daily reconciliation of on-chain balances against the ledger. There is some financial-health reporting, but I didn't verify it pages anyone.

**Fix.**
- Alert (Telegram or email) on any outflow above a threshold, any authority or upgrade-authority change, or an unexpected signer.
- Reconcile on-chain balances against the database ledger daily.

### 8. AI agent and bonus paths (not reviewed in depth)
The agency (AI agent) disbursements and buybacks use the same router authority and approval pattern, so findings 1–3 apply to them. The daily bonus and referral payouts are signed by server-held keys (finding 1). Untrusted text the agent reads (X posts, token metadata, chat) must never be able to pick a recipient or an amount. This needs its own review.

## Suggested order

1. Signer isolation (finding 1) and a multisig authority and upgrade authority (findings 2 and 5). Treat these as Mainnet blockers.
2. On-chain changes, done together as one program upgrade:
   - pause and daily caps (finding 3);
   - a minimum delay before a new reward cycle pays out (finding 2);
   - an independent price check on conversions (finding 4).
3. Admin withdrawal caps, delay and second approver (finding 6). This is server-only and quick.
4. Monitoring and reconciliation (finding 7).
5. A professional audit of the program, plus a focused review of the AI-agent and bonus paths.
