# Reward experience Devnet QA — 2026-10-01

## Deployed build

- Source commit: `de08b07` (`Add verified reward experience and proof views`).
- Public Devnet app container: `fundedapp-app:reward-experience-de08b07`, healthy on the host's port 8788. The existing Devnet database and workers were left in place.
- The image extends the previously running public image with the reward API and UI. This avoids replacing unrelated public UI changes from the mixed checkout. The deployment overlay and build context currently live under ignored `tmp/` files; a durable image build from a reconciled source tree is still needed before Mainnet.

## Verified here

- `node --test tests/reward-experience.test.mjs`: 5 passed.
- `node scripts/verify-proof-ui.mjs`: passed in the current working tree. This script and other UI files contain unrelated uncommitted edits; the QA assertion adjustment was not staged with this note.
- Public Devnet local ingress `http://127.0.0.1:8788/api/rewards/experience`: `devnet`, `onchain-indexed`, 5 token records, 14 evidence events. This does not independently verify the external `https://funded.vip` route.
- The test mint `FWmi66ecpuAYkcpjT86i2RsBKZhm2cJdnKXqcoreW8DH` shows 8,500,537 lamports collected, 850,054 lamports allocated to holders, and no finalized holder payout. The token proof panel displays the collection and one verified buy-and-burn receipt.
- Browser smoke checks on public port 8788 at 1440 px and 390 px: reward activity, alerts, buyback execution, and token proof were visible, with no page errors or horizontal overflow.
- Automatic reward status remained active with 19 schedules; the buyback API returned 4 finalized receipts. App, reward worker, receipt worker, fee collector, community claim worker, and database containers remained running after the app-only update.

## Limits and next gates

- No new on-chain transaction was submitted in this QA pass. A fee-funded holder payout was not proven end to end: the largest verified available holder pool was 3,576,239 lamports, below the current 10,000,000-lamport payout minimum.
- Community reward delivery still requires a verified migration snapshot and payable funded cycle.
- The Devnet buyback worker has verified atomic buy-and-burn receipts. Mainnet buyback custody still requires its dedicated PDA and independent program audit, as reported by the live route-readiness API.
- The reward proof endpoint limits requests to 30 per minute per client address. Rapid local QA exhausted the shared local test address; a fresh test address returned the expected records. This was a QA traffic artifact, not evidence of a failed public user flow.
