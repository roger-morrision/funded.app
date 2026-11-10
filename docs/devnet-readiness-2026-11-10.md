# Devnet readiness update — 10 November 2026

Code revision `82983bd23e4d8e4103eeb41b4debd8d6d92fa543` is deployed to richpad.fun on Devnet. Mainnet remains disabled. Missing production values remain placeholders. The [verification record](evidence/devnet-readiness-2026-11-10.json) distinguishes live results from unverified work.

## Upgradeability

Finalized reads verified all three existing app-owned programs: the active merged router/escrow `9H1r…o2Sm`, legacy escrow `EPyw…H9pT`, and legacy router `61EQ…wYYa`. Each retains upgrade authority `7epA9KQ5wkwo5wZ5kcY8CfVUvpwVJoAMz2RNqt2ZwK5Y`. Their deployed bytes were unchanged. Pump and SPL dependencies are separate third-party programs; this check does not give the app authority over them.

The deployment helper now rejects a post-deploy authority or identity mismatch. Mainnet preflight checks canonical ProgramData ownership/address, retained and approved authority, and the actual hash of the bytes. The cost planner rejects an immutable deployment plan. Negative tests cover revoked/changed authority, malformed account headers, substituted ProgramData, forged hashes and the wrong network.

The production plan still requires an upgradeable merged program with upgrade authority `ER7zhtSwfSu7B5Wb7uFwnWSZPLMmezmSXieY5JyLFzXC`. No Mainnet program was deployed, no authority was changed, and no contract was made immutable. Removing the authority permanently prevents upgrades: [Solana deployment documentation](https://solana.com/docs/core/programs/program-deployment).

## Fixed and verified

- RICH history now scans its configured, independently verified pool instead of assuming the canonical Pump pool. Before migration, an absent future pool still permits curve-history reads. The live scan found 48 historical trades with partial all-time coverage and complete coverage for the last 24 hours, when there were no trades. Desktop and 390px mobile views now show the verified empty state instead of an unavailable-history error.
- Trending labels no longer present unavailable wallet observations as zero.
- RCAT automatically delivered `34,281,146.476108` tokens to its original creator. The finalized receipt and expected token deltas were reverified.
- The actual 48-hour fixture delivered `100` test tokens after the on-chain deadline. Its transaction finalized, a duplicate simulation was rejected with error 6001, and journal replay returned the existing signature. Fee: `0.000005` Devnet SOL. This completes the elapsed-time check previously scheduled for 09:23:54 Bangkok on 10 November.
- The existing admin Operations withdrawal receipt was reverified: `0.005` SOL to the admin, with the admin paying `0.00001` SOL. This was a read-only recheck, not another withdrawal or a fresh Phantom/OTP test.
- A fresh PostgreSQL snapshot restored into a network-isolated temporary database. All 26 tables and 948 row counts matched the exported snapshot; the temporary container was removed. Live database contents were not changed. Reward-volume and off-host restoration remain unverified.
- Launch configuration, Devnet RPC routing, signer health, unauthorized signing rejection and a fresh buyback worker cycle passed. The worker is waiting for sufficient eligible fee funding; this release does not claim a new buyback/burn.

## Verification and remaining work

389 JavaScript tests passed locally. The isolated image passed 380 runtime tests; the nine Git-dependent planning tests ran locally. Frontend and read-only Mainnet preview builds passed, along with source-size and syntax checks. Contracts were unchanged, so previous Rust/VM evidence was not rerun or presented as new evidence.

The fresh launch/trade/payout test stopped before funding: its QA wallet has 14.846431821 test SOL, below the script's 15 SOL reserve. The single RPC faucet request returned 410. A bounded 0.22 test-SOL run with a 14 SOL reserve is awaiting the owner's answer; no launch or transfer was submitted by that attempt.

Mainnet is **not ready for activation**. Remaining work includes production RICH mint/pool and program identity, isolated custody/infrastructure references, remaining production entry-point verification, full current-release financial acceptance, reward/off-host backup recovery, independent exact-bytecode/custody review, and a bounded canary. Existing hosting/TLS, selected admin/upgrade wallet and 5 SOL spending cap do not need to be supplied again. See the evidence record and [production preparation notes](mainnet-placeholder-preparation-2026-11-09.md) for the remaining scope.

Other uncommitted bonus-page edits in the shared workspace were left untouched and excluded from this release.
