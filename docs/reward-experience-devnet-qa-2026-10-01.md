# Reward experience Devnet QA — 2026-10-01

## Deployed build

- Source commit: `de08b07` (`Add verified reward experience and proof views`).
- Public Devnet app container: `fundedapp-app:reward-experience-de08b07`, healthy on the host's port 8788. The existing Devnet database and workers were left in place.
- The image extends the previously running public image with the reward API and UI. This avoids replacing unrelated public UI changes from the mixed checkout. `compose.reward-experience-devnet.yml` and `deploy/reward-experience-devnet/` now reproduce the deployed application content from the pinned base image: 48 built UI and server entry files had the same combined SHA-256, `429231020035e6fc57394c857c4fa040fb44587fb604aff2bfbda60ad36fcc0e`. The pinned base image must be retained on this host; a self-contained build from a reconciled source tree is still needed before Mainnet.

## Verified here

- `node --test tests/reward-experience.test.mjs`: 5 passed.
- `node scripts/verify-proof-ui.mjs`: passed in the current working tree. This script and other UI files contain unrelated uncommitted edits; the QA assertion adjustment was not staged with this note.
- Public Devnet local ingress and `https://funded.vip/api/rewards/experience`: `devnet`, `onchain-indexed`, 5 token records, 14 evidence events. The external health endpoint returned HTTP 200. A later external-browser check loaded reward activity at 1440 px and the test token's proof at 390 px, with no page errors or horizontal overflow.
- The test mint `FWmi66ecpuAYkcpjT86i2RsBKZhm2cJdnKXqcoreW8DH` shows 8,500,537 lamports collected, 850,054 lamports allocated to holders, and no finalized holder payout. The token proof panel displays the collection and one verified buy-and-burn receipt.
- Browser smoke checks on public port 8788 at 1440 px and 390 px: reward activity, alerts, buyback execution, and token proof were visible, with no page errors or horizontal overflow.
- Automatic reward status remained active with 19 schedules; the buyback API returned 4 finalized receipts. App, reward worker, receipt worker, fee collector, community claim worker, and database containers remained running after the app-only update.

## Limits and next gates

- No new on-chain transaction was submitted in this QA pass. A fee-funded holder payout was not proven end to end: the largest verified available holder pool was 3,576,239 lamports, below the current 10,000,000-lamport payout minimum.
- Community reward delivery still requires a verified migration snapshot and payable funded cycle.
- The Devnet buyback worker has verified atomic buy-and-burn receipts. Mainnet buyback custody still requires its dedicated PDA and independent program audit, as reported by the live route-readiness API.
- The reward proof endpoint limits requests to 30 per minute per client address. Rapid local QA exhausted the shared local test address; a fresh test address returned the expected records. This was a QA traffic artifact, not evidence of a failed public user flow.

## Rebuild and deploy this Devnet overlay

Run `pwsh -NoProfile -File scripts/release-reward-experience-devnet.ps1 build`, then the same script with `deploy`. It validates the committed Compose stack, the local Devnet inputs, and the pinned base image. The deploy step recreates only `app`; it does not rebuild or replace workers or database volumes. The checked-in recipe was rebuilt under a separate QA tag and matched the public image across every built `dist` file, `bootstrap.js`, `server/index.mjs`, and `server/reward-experience.mjs`.
