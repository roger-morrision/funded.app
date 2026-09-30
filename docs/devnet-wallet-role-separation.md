# Devnet wallet roles

The Devnet QA set has 15 distinct keypairs. Ten app and recipient roles are in the ignored
`.env.devnet-app-roles.local`; their public addresses are in the ignored
`.secrets/devnet-app-roles-20260930/public.json`. The five existing participant wallets
remain in `.env.devnet-qa-wallets.local`. Never load either QA key file on Mainnet.

| Purpose | Devnet QA role | Actual custody or recipient |
| --- | --- | --- |
| App owner | `app_owner` | Offline owner/admin wallet; not a transaction payer in the app. |
| Pump.fun creator fee collection | `pump_fee_keeper` | Keeper pays network fees to collect; each coin's Pump fees accrue in its mint router PDA. |
| App revenue from Pump fees | `pump_revenue_treasury` | Receives the protocol operations allocation through a verified reward payout. |
| App revenue from trading | `trading_fee_treasury` | Public fee owner passed to PumpSwap trades. |
| Router settlement and reward vault authority | `router_authority` | Signs router settlements and reward cycles; each reward vault is a program derived address. |
| Creator rewards | Existing `creator` | The actual coin creator's verified launch wallet, distinct for each creator. |
| $FUNDED holder reward test | `funded_holder` | QA recipient only; real recipients come from finalized eligible holder snapshots. |
| Coin holder reward test | `coin_holder` | QA recipient only; real recipients come from finalized eligible holder snapshots. |
| Referral rewards | Existing three `referrer` roles | Each verified inviter receives its level's payout. |
| Manual referral payout funding | `referral_payout_funder` | Dedicated signer and SOL source for referral payouts. |
| X rewards | `x_partner` | QA recipient; a real X account owner must verify and link their own wallet. |
| Buyback execution | `buyback_operator` | Separate transaction signer; protocol buyback allocation remains in the mint router until execution. |
| Community reserve | No wallet key | Program vault or reserved token account, not an app owned EOA. |

The ten new QA keys are unique among themselves and the five participant keys. The private
file is ACL restricted on Windows. `node scripts/provision-devnet-role-wallets.mjs`
rechecks the key to public address mapping without printing private keys.

Runtime configuration is deliberately separate from provisioning. The API now requires an
explicit `SOLANA_KEEPER_SECRET_KEY` or `SOLANA_KEEPER_KEYPAIR_PATH` for Pump collection,
an explicit `FUNDED_ROUTER_AUTHORITY_SECRET_KEY` or `FUNDED_ROUTER_AUTHORITY_KEYPAIR_PATH`
for settlement, `FUNDED_PUMP_REVENUE_WALLET` for the protocol operations payout, and an
explicit `SOLANA_REFERRAL_PAYOUT_SECRET_KEY` or `SOLANA_REFERRAL_PAYOUT_KEYPAIR_PATH`
for manual referral transfers, with `SOLANA_REFERRAL_PAYOUT_CONFIGURED=true` only after
that wallet is funded and payout verification is ready. Trading uses the public `VITE_FUNDED_TRADE_FEE_OWNER`
and `FUNDED_TRADE_FEE_OWNER` address. These settings must not reuse addresses.

**Activation gate:** the current Devnet legacy router still has its older authority on
chain. A newly generated authority cannot sign for that router. Do not point the live
worker at the new authority or assert that the new treasury is receiving funds until
a reviewed Devnet router migration or deployment and finalized payout tests are complete.
Existing obligations keep their original recipient; new allocations use the dedicated
Pump revenue wallet once configured. Fund the fee keeper and referral payout funder
separately before their live tests. Mainnet requires new, independently controlled
production keys and a separate custody review.
