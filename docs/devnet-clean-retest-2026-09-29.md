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
- Creator and referral settlement must be checked by finalized payout signatures
  and exact recipient deltas. The app-owner trade fee is transferred within each
  trade. The operations share uses a separate reward-vault payout to the configured
  reward authority.
- Buyback accruals remain pending until the 0.25 SOL minimum batch or six-hour
  maximum wait is reached. A pending allocation is not a burn receipt.

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
