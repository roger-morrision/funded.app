# Clean Devnet end-to-end retest

The public `funded.vip` deployment is a Devnet app. The retest cut over to a new
PostgreSQL database (`funded_app_retest_20260929`) and a new reward ledger volume
(`fundedapp_funded_reward_ledger_retest_20260929`). Previous application records
remain in the old database and ledger for rollback; previous Solana transactions
remain on-chain. The nine immutable metadata records were retained so old mint
metadata URIs still resolve. No Mainnet application data or wallets were reset.

Use `compose.devnet-retest.yml` as the last overlay in **every** funded.vip Compose
command. Omitting it selects the old database and ledger. The ignored local secret
file `.secrets/database-url-retest-20260929` supplies the new database URL. Do not
commit that file or the backup in `audit-records/`.

The Devnet app and workers now use `fundedapp-app:trade-dialog-20260929`. The mobile
trade sheet had made its body-sibling review dialog inert, so Confirm Devnet trade
could not receive clicks. The UI fix leaves native dialogs interactive while the
sheet is open. The local mobile dialog regression and production build pass; a
user-signed trade and finalized balance delta are still required to confirm the
live transaction flow. Refresh an already-open tab before retrying.

For this deployment the full Compose file order is `compose.preview.yml`,
`compose.creator-devnet.yml`, `compose.funded-vip.yml`,
`compose.reward-worker.yml`, `compose.fee-collector.yml`,
`compose.receipt-worker.yml`, `compose.buyback-worker.yml`, then
`compose.devnet-retest.yml`. Profiles are `automatic-rewards`, `receipts`, and
`buyback-devnet`; environment files are `.env.deploy` and `.env.x`. Deploy a
reviewed image with `--no-build` and check that every app/worker service uses the
same image, database secret, and reward ledger volume.

## Fresh run

- Coin: `Cg95LJcnH18e34ivwTk71iexiFHKPwQ19MQC5LEBP5Ba` (FCQA).
- The issuer and referrer roles used existing Devnet test wallets. Volume trades
  used the Devnet claimant test wallet or a disposable in-memory wallet. No real
  user wallet or Mainnet asset was automated.
- A 30 million token community reserve was transferred to the verified reward
  vault with exact finalized source and destination deltas. Custody is verified;
  eligibility and claims remain closed.
- The fresh coin's two collections totaled 14,973,273 lamports. The public fee
  overview reconciles exactly 14,973,273 allocated lamports, including small
  scientific-notation settlement amounts. Creator payouts total 10,481,291
  lamports, direct referral payouts 299,465 lamports, and operations payouts to
  `B2Ns79FNQBseayg77fT7CvxQYs2NJ3DJBR3R1nDbwk3n` 2,096,258 lamports. Each
  has finalized payout records. Referral payments have exact recipient deltas.
  For creator and operations payments, the recipient also pays transaction fees
  and payment-account rent; the exact vault/cycle debit and the recipient delta
  plus those costs reconcile to each recorded payout. The 0.5% app-owner
  trade fee is transferred within each trade to the configured trade-fee wallet.
- Buyback accruals remain pending until the 0.25 SOL minimum batch or six-hour
  maximum wait is reached. A pending allocation is not a burn receipt.

## Migration mechanics fixture

The public FCQA coin was not migrated. A separate Pump Devnet coin
`JCdaTfvi38ah7jQPtMmKF6Dc7q9Y9EcA6kWGxNwRuqEH` was created only for
migration mechanics. Its metadata explicitly promises no community allocation,
and it is absent from the app launch registry. The issuer wallet bought the
remaining curve tokens, retained them, and migrated the completed curve. Launch
`A5XJUaGZPmNUdP53S8JvryQT5ZBFCvAVbYKwyZgA9zgC4mx2V3uihDTFcbHCVzGvGWNiwT2Zj5HvNUqBNwuswVB`,
finishing buy `F1AxQzWLAaqaKev961uX8vELNVFKvdCKkSX8oqSVZh8qLRR4DFaZqpnpprNpsNLcBBSoSunRYkc3zixfxodpRRd`,
and migration `3xpbuKoYD8JcW2n8pkeJZV4XrpNdhsMRuF38xJNThdrFEhVWWjvkaQponaWbSSMDgwaU2JJQhKpJxcam9suRm2Lr`
are finalized. The canonical pool `4wE9RXDSQSFt5W6FGKmPTm1Str5HoWme5esytcBFMSL1`
is owned by PumpSwap. A disposable wallet then completed a pool buy and sell;
the final token balance was zero, and the fee-owner wallet received 15,000 and
14,630 lamports in the finalized trade transactions. This proves Pump migration
and the graduated trading route, not the app's community claim lifecycle.

## Gates that a fresh database cannot remove

Migration of a community-promising coin must wait for independently verifiable,
finalized exact-migration-slot $FUNDED holder evidence, a reviewed allocation
manifest, and the deployed community claim program. Do not migrate the FCQA coin
without that evidence. The already-migrated historical Y5 coin lacks the required
snapshot, so its claims stay closed.

Daily holder rewards cannot be marked paid before their real cutoff and payout
time. X payouts require a verified X-linked recipient with an actual eligible
settlement. Buyback and burn require a finalized atomic purchase/burn receipt and
refund proof. These flows remain distinct from local or mocked checks.

An independent in-memory Devnet reward-contract fixture did finalize both a SOL
holder-style payout (`3UP1vQVxxzJ2jmp4kdWg3vUpHB5XGHHviy92nr7mnBBzMpEadHyQSymkBfC793SpfX3YfgaaUAVVQozxp56d1Vn1`)
and an SPL token payout (`4FYPvWqCiodEMdyhQYjH2VyoKEBibygFPcjbsFyqQ2c7of4p5GV9AWsqQFxuQsxxv2sFwJZFUxHBMWw3nuUAxbSG`)
with payment records and exact vault/recipient deltas. This verifies the reward
contract's payout path, not FCQA's real daily holder cycle.
