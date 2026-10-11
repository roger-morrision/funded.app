# funded.app handoff integration checklist — 2026-10-11

Repository verified as `https://github.com/roger-morrision/funded.app`. The baseline for this worktree was `origin/main` at `0d1508bc8b682d024c385d382641fe46338f45d7`. The worktree is `codex/handoff-integration-20261011`; the conflicted `tmp/merge-main` checkout was not used. Statuses below compare source commits with that baseline, not with a similarly named chat or rendered page.

| Reported item | Source SHA / branch | Status | Commit and behavior evidence |
|---|---|---|---|
| Five percent buyback fee policy and v3 specification | `0d1508b` | Already included | Exact baseline HEAD; `config/protocol-fee-split.js` and policy verifiers carry the five percent allocation. Specification is not proof of deployed v3 bytecode. |
| Home favorites sync, wallet controls, Boost, launch tabs | `b09f689`, `83d2466`, `7df82c2`, `c34299f` | Already included | All ancestor commits of `origin/main`; Home and Favorites browser regressions run against the integration build. |
| Modular UI checks and finalized referral fixtures | `8a83d27` / `codex/explore-data-density` | Needs integration, integrated locally | Cherry-picked as `645a202`; stable patch and 63 local regressions passed after locked dependencies were installed. |
| Launch review dialog extraction | `5ce2c7e` | Already included | Ancestor of `origin/main`; launch review browser suite runs against integrated code. |
| Compact ticker | `f65dc90` | Already included | Ancestor of `origin/main`; Home browser coverage exercises ticker controls. |
| Rewards tabs, token About, referral steps on mobile | `82ac931`, `161b2b1`, `e234cb7` | Already included | Ancestors of `origin/main`; mobile and responsive browser coverage exercises current navigation. |
| Airdrop claim details and QA fixture | `abd7bdc`, `4c48b7b` | Already included | Ancestors of `origin/main`; fixture/browser tests are local or mocked, not an on-chain claim. |
| Listing RPC Devnet genesis method | `3c5ca07`, later `29b9906` | Already included | `origin/main` commit `fe2c556` allows `getGenesisHash`; the same verification script is present and `verify:listing-rpc` passes. The monolithic `29b9906` patch has a different patch ID but equivalent behavior. |
| Paid Listing Home tab | `1292475`, `b36e448` / `codex/paid-listing-live-20261011` | Needs integration, integrated locally | `b36e448` cherry-picked as `bd9224e`; focused listing tests passed. `1292475` is the earlier equivalent branch version. Main's compact Home shell was retained in the conflict. |
| Fee router settlement and accounting hardening | `78aeb6b` | Needs integration, integrated locally | Ported as `7337570` into modular server and client routes; Rust source and JS reward checks passed. |
| Net token funding and canonical accounts | `2ab81db` | Needs integration, integrated locally | Cherry-picked as `c9bf2ac`; focused funding and mocked reward verification passed. |
| Signed mint migration and creator-approved X payout | `e34de26` | Needs integration, integrated locally | Ported as `c483ec7` plus modular route wiring `2233d97`; local signed payout and X display tests passed. No actual Devnet program migration is evidenced. |
| Park unsigned automatic router rewards | `f387aa1` | Needs integration, integrated locally | Cherry-picked as `cdf137a`; prevents unsigned automatic settlement. |
| Interim pause of creator claims | `7d732ff` | Intentionally superseded | Later source `c66f72a` adds signed claims and `a4dce2f` adds recovery. The integrated readiness gate still fails closed without approved Devnet bytecode. |
| Signed creator claims and finalized payout proof | `c66f72a` | Needs integration, integrated locally | Ported as `502ca7e` and repaired in `2233d97`; local ephemeral creator/RPC test proves exact signed payout and mocked finalized balance deltas. |
| Interrupted creator settlement recovery | `a4dce2f` | Needs integration, integrated locally | `98c1467` carries retry and finalized delta helpers; local recovery tests pass. |
| Guest Favorites error feedback | `d4fcb78` / `codex/airdrop-balance-regression-20261010` | Needs integration, integrated locally | `ca7fe06` retains the source feedback fix while newer main QA assertions take precedence; Favorites browser test passes. |
| Referral sign-in and cancellation feedback | `30adcc8` | Needs integration, integrated locally | Ported into the shared sign-in controller as `39b0217`; cancellation, retry and private-data test passes. |
| Truthful navigation/leaderboard regression | `14cf5c7` | Needs integration, integrated locally | Cherry-picked as `46f918e`; new browser regression passes. |
| Older five percent policy | `1abfea7` | Intentionally superseded | Baseline `0d1508b` is the newer five percent policy; its fee allocation scripts and UI copy are present. |
| Airdrops FUNDED balance | `699b0ce` | Already included in newer form | Main `20dac39` shows the current wallet balance and snapshot eligibility; airdrop wallet browser regression passes. |
| Completed loading label fix | `191b73f` | Already included in newer form | Main `94acc4e` clears completed labels and empty feed state; current unit coverage is present. |
| Payment receipts compact/responsive | `e0ee958` | Already included in newer form | Main `153b4ca` has compact receipt CSS; `203e55b` extends date and payout filters. |
| Shared finalized payout history | `c16cba6` | Already included | Main `60470b7` is patch equivalent per `git cherry`; `203e55b` adds later history filters. |
| Wallet sign-in reuse | `29e6925` | Already included in newer form | Main `c1edefa` installs shared `wallet-signin.js`; current referral and token chat controllers use it. |
| Solana logo | `86e1d69` | Already included in newer form | Main `ef5dbff` adds the official SVG and UI references. |
| Page copy polish | `b9d5f63` | Intentionally superseded | Main `75ee8a8`, `d2f8c5c`, `fb99fc7` and later Home copy commits revise the same surfaces. |
| Proof assertion and responsive QA updates | `35ade64`, `92583a8` | Already included in newer form | Main `5bc649a` updates proof checks; `92583a8` touched path has identical current file content. |
| Airdrop discovery tabs and holder lists | `66c3434` | Already included in newer form | Main `b6ff4b5` contains the feature; attempted cherry-pick was empty after retaining newer claim card behavior. `tests/airdrop-discovery.test.mjs` passes. |
| Other older branch patches | `2de4809`, `40ce253`, `d706245`, `4f69d48`, `a727eed`, `ce2dff4`, `8cd2f9f`, `d6b794d`, `261b243`, `d857589` | Already included | `git cherry origin/main` marks these patch equivalent to baseline main. Their respective boost, airdrop, copy, launch, and X follow-up behaviors remain in current source. |
| Root checkout generated browser output | untracked `test-results/` | Intentionally excluded | Original checkout remains on `enhance/architecture-security-ops`; generated traces are not staged. |

Dependencies and evidence: locked `npm ci` installed 124 packages in the isolated worktree; no generated files or secrets were staged. The production build, JS source/size check, local unit tests, browser regressions, and Rust contract tests are release gates. Local mocked RPC and browser fixture results cannot establish a live Devnet transaction or balance change.

Release gate: Do not push main or deploy until the final test sweep is green, `origin/main` is fetched again, the exact diff is reviewed against this checklist, and the deployed Devnet program/configuration permits the signed settlement paths. After deployment, verify the image commit, Devnet genesis/program/PDA and bytecode hash, public health, affected UI, and finalized state/balance deltas separately.

## Verification at this worktree revision

- `node --test` for every cross-platform unit file: **638 tests, 632 passed, 0 failed, 6 skipped**. Three new skips are the existing downstream per-mint fee-collection tests, which are unreachable while creator-approved payout paths are deliberately disabled; a new test asserts that collection fails closed without broadcasting. The six `maintenance-run-lock` tests require Linux `flock`; all six passed separately under WSL. The initial Windows all-files command failed those six with `ENOENT` because Windows has no `flock`.
- Focused signed creator test: 7/7 passed using in-memory ephemeral keys and a local fake RPC. It asserted a 20,000,000-lamport router debit and creator credit, matching finalized receipt, claim account, and replay. This is **mocked local evidence**.
- Focused UI, reward service and X claim tests: 19/19 passed. The Rust fee-router library tests: 4/4 passed under WSL. The source handoff reports broader LiteSVM results, but these have not been rerun against a freshly built SBF binary in this worktree.
- Affected Chrome browser regressions: 23/23 and 27/27 passed with the locally installed Chrome. They cover Home, listing recovery, Favorites, airdrops, launch previews, navigation, wallet reconnection, and payment history. Browser API/RPC fixtures are mocked; page rendering is not proof of settlement.
- `verify:local-regressions` 63/63, `verify:mint-router-v2`, `verify:creator-fee-claim`, `verify:listing-rpc`, `npm run check`, and production `npm run build` passed after the readiness correction. The final source/build gate should be rerun after any later source change.

## Unverified and release-blocking state

- A read-only public check on 2026-10-11 found `https://funded.vip/api/status` serving baseline `0d1508b` with Devnet cluster. `/api/health` returned 200 and `/build-settings.json` reported Devnet with Mainnet disabled. `/api/readiness` reported `ready:false`, `verification:unavailable`, and `settlementVerified:false` is explicit in `/api/status`. These are live service observations, not payment evidence.
- A fresh read-only finalized Devnet RPC query on 2026-10-11 verified genesis `EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG`, executable router program `2tRrwGFzRCDmrVY7U6dny4Ea1RqVm7cSrCYFULmK7tik`, and deployed ProgramData SHA-256 `9ce7c1137d250ffa84668e65b53546b7c1d4239eaf888957c41316708cda977b`. This is the pre-migration hash recorded in the security audit, not the reviewed source binary. Existing mint routers, reward cycles, and historical settlements still need reconciled signed migration. The audit's balance inventory is dated 2026-10-08 and was **not** accepted as current balance evidence here.
- General launch and automatic-payout readiness remains fail-closed while other creator-signing paths and Devnet migration are incomplete. The distinct signed creator-claim endpoint uses `creatorSigned:true`, but it still requires approved deployed bytecode and verified mint ledger.
- No Devnet program upgrade, signed migration, creator-approved payout, funded.vip image deployment, finalized transaction, or live balance/state delta was performed by this integration worktree. The user-required one-time main push and exact-SHA preview deployment remain gated.
