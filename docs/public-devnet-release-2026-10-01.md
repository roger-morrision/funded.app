# funded.vip public Devnet release — 2026-10-01

- Build ID: `public-devnet-20261001b`
- App image: `fundedapp-app:public-devnet-20261001b` (`sha256:467bc1612100cceaf3ea798772f0da66b0cc45d00d0b945b85c8291c3208e38e`)
- Previous app image: `fundedapp-app:wolf-style-20261001a` (`sha256:53d2e8f4f4956dc33bfa1c4fa80d3c745a7ca9ca73031a0f98e1e8a65bd482eb`)
- Scope: replace only the app container in the existing Devnet Compose stack; retain the database, tunnel, and worker images.
- Build flags: Devnet, Mainnet disabled, developer wallet autoconnect disabled, same-origin API.
- Database: a readable pre-release PostgreSQL archive is retained locally at `.tmp-deploy-20261001/pre-public-devnet.dump` and excluded from Git and Docker context.

## Verification

- Local build, release contract, production policy, fee policy, fee router, reward allocation, community reserve, jackpot model, share UI, and 17 focused share/leaderboard/trade tests passed. Mocked chain checks are not on-chain payout proof.
- The built image passed server syntax and fee policy checks. Its `server/index.mjs` hash matched the workspace source used for the build.
- `https://funded.vip/` returned HTTP 200. The public API reported `build=public-devnet-20261001b`, `cluster=devnet`, and PostgreSQL as its data source.
- Public jackpot status and burn-board endpoints responded. Desktop and mobile browser smoke checks opened Overview, Explore, Launch, Payments, My projects, Buy & Burn, Capital flow, and a verified token deep link without page errors or mobile horizontal overflow.
- The app container and database remained healthy; the reward, community-claim, receipt, fee-collector, and buyback workers remained running.
- Mainnet readiness remained blocked. No new financial transaction was submitted for this release check.

## Source and rollback

The image was built from the working tree at `2e88edc` with uncommitted application changes. The image digest identifies the deployed artifact; the Git commit alone does not reproduce it. Do not push the mixed working tree without reviewing those changes.

To restore the prior app image, run the same 16 Compose files recorded in the current app container's `com.docker.compose.project.config_files` label, omit `deploy/public-devnet-20261001b.yml`, enable the `automatic-rewards` profile, and recreate only `app` with `--no-deps --no-build`. Review the database before restoring data from the backup.
