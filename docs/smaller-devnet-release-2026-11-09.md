# Smaller Devnet program release

The user authorized upgrading the existing Devnet program to the tested smaller candidate, retaining its upgrade authority and testing the application. The source release pins the 900,144-byte executable with SHA-256 `03749b95dd6f4cd67e77eb9932012bcd7ee61d34a3da0171a2fc48b3a9d99a24`, replacing the 1,095,080-byte commitment. This is a reduction of 194,936 bytes (17.8%).

Program: `9H1r2nTZs6gQaheYTMaBWpH12JX6dCFj2Rvxg7Lno2Sm`. Upgrade authority: `7epA9KQ5wkwo5wZ5kcY8CfVUvpwVJoAMz2RNqt2ZwK5Y`.

The candidate manifest is a reproducibility record, not an automatic deployment authorization. Its retained runtime commitment now describes this authorized release. The separate production-feature artifact still uses a public test identity and is not a Mainnet deployment artifact. Missing production configuration remains placeholders and Mainnet writes remain blocked.

Before cutover, all ten existing LiteSVM contract tests passed against these exact bytes. The finalized upload buffer was independently compared with the local executable. The release requires finalized upgrade receipt, exact executable plus zero padding, retained authority, unchanged legacy escrow and matching app/worker ProgramData pins. Live acceptance evidence is recorded separately; VM success does not imply that every financial journey has passed on Devnet.

The existing ProgramData allocation is retained. This upgrade does not reclaim its existing rent. Upload-buffer rent returns to the same Devnet authority on upgrade; no Mainnet SOL is spent.

## Finalized upgrade

Upgrade transaction: `eG7Eg56XgL4qW7UyceYWqkzUAhwfVZmsb2n4ow6M6GRgKtbnUugwCaSVYttYubQDaE5XUbufvo6CJCHaos6fDSn`, finalized slot `520225491`. Full ProgramData SHA-256: `8238170ec0f484837494985148bc0104bc32506cfa09057fdfc938a85b7cb8b5`. Exact binary, zero padding and retained authority were verified. Upload-buffer refund: 4,573,569,720 lamports; upgrade transaction fee: 5,000 lamports. No allocation extension was needed.

The coordinated app release `b2744cd54f9bd952b30991421d9f91a73836b7f4` passed public and four-service health checks. No Devnet data reset was needed. Matured 6h and 12h legacy fixtures under this same router released exactly 100,000,000 token base units each to their original beneficiaries and rejected repeat release. A 24h fixture rejected early release.

Fresh live launch, registration, 30-million-token reserve, developer escrow, buy/sell fees, collection, category conservation and settlement replay checks passed. A concurrent worker finalizing the same settlement exposed a spurious conflict response; the follow-up fix accepts only the already-proven same signature, network, program and category amounts. Regression tests also reject concurrent foreign or altered records. This does not authorize resubmission.

## Application release and verification

The deployed follow-up revision is `447b7b6d1d804e04a82e8f4e62100faa206fb381`, image `sha256:3b797a053cc927a72a78f30463c7e59453a4257bbfad582ad790569b1a627288`. Final verification found the app and all three workers healthy on this revision, with public release checks passing. Worker health does not prove that an unconfigured financial flow has executed.

All 251 application tests passed inside the exact deployed image with networking disabled. All ten existing compiled-contract tests passed against the optimized Devnet executable. Source checks passed for 942 JavaScript files and budgets for 1,165 maintained files. These counts describe the existing suites, not complete instruction or financial-journey coverage.

Reward custody was exercised separately on Devnet with an isolated token: 100,000 lamports and 1,000 token base units were funded and paid through Merkle cycles. Finalized receipts proved exact recipient credits, duplicate suppression, invalid-proof rejection and zero outstanding reserves. The test tokens were burned and their token accounts closed. This does not test the full hourly holder eligibility and snapshot pipeline.

The final fresh financial run passed all 24 recorded checks for mint `5JD7MVWqvtJegDofVcBToQAf1UbtBN6vQJErEWy74i6Q`. It covered launch/registration, buy/sell, collection of 46,853 lamports, eight-category conservation, settlement replay, all three referral levels, creator-reward and community funding, 3,748 lamports of Operations funding and a creator-signed payout of 32,796 lamports. The creator payout finalized as `4caHCgdcoc91ZbRtzDLwG8grvDV3a1hpZzaA7yZaS9Twag121pvNJcabh3MBKoaQNsDQig2kn15XP7pWrstFB5vZ`; replay returned the same signature. Unused liquid SOL from this run's payer and three referrers was returned with finalized receipts. This was an ephemeral test signer, not a Phantom UI test.

The 24h developer-lock fixture subsequently matured and released exactly 100,000,000 token base units to its original beneficiary. Its repeat release was rejected. The 48h fixture rejected early release; matured 48h release remains covered only by compiled-contract tests in this release.

Read-only browser checks covered Home, Explore, a newly launched token, Create and Rewards. Token data and trading history rendered, and disconnected-wallet gates remained in place. This was not an authenticated browser transaction or exhaustive page-performance audit.

## Remaining acceptance and Mainnet blockers

The [acceptance evidence](evidence/smaller-devnet-release-2026-11-09.json) separates live, local-only, VM-only, partial and blocked cases. No Devnet data reset was required.

- Admin Operations withdrawal still requires the real admin email OTP and the same allowlisted Phantom wallet signing as fee payer and receiving the SOL. Funding the Operations treasury does not prove this withdrawal flow.
- Buyback execution remains blocked because its independent price-signer configuration account is absent. No substitute signer or verification bypass was configured.
- Real X OAuth and bound-wallet claims, full holder scheduling, live migration/community claims, paid-promotion recovery and the complete restart fault campaign remain unverified on this release.
- Mainnet launch/registration, metadata activation, payout/worker entry points and indexing/reconciliation integration remain gated. The reward sender now verifies network and approved program evidence before signing; this fix does not complete the remaining integrations.
- Production identity, infrastructure, signer references and spending limits remain placeholders. Independent contract/custody review and a capped Mainnet canary are still required. The offline preflight returns `no-go`; Mainnet writes remain disabled.

Earlier financial test attempts are not represented as successful full runs. They exposed a settlement race (fixed), a transient readiness failure and stale test-helper assumptions about creator claims. Two disposable wallets from a rate-limited cleanup retain a total of 0.002 Devnet SOL; their ephemeral keys were not persisted. The uncertain refund was reconciled as expired and absent before recording this limitation.

At 09:37 on 9 November 2026 (UTC+7), the user's selected wallet `ER7zhtSwfSu7B5Wb7uFwnWSZPLMmezmSXieY5JyLFzXC` was confirmed in the deployed admin allowlist. Its Operations withdrawal intent for 13,415,977 lamports has a matching recorded email approval and the same admin destination/fee payer, but remained `awaiting-admin-signature` without a saved transaction signature or finalized receipt. A read-only Devnet search found no recent matching transfer. The user reported completion; verification remains pending their signature or Explorer link. No replacement transfer was submitted.

## Withdrawal RPC correction

The subsequent user-confirmed Phantom approval exposed a missing browser RPC method: `isBlockhashValid` returned HTTP 400 / `Unsupported Solana RPC request.` The withdrawal client calls this read after signing and before recording or broadcasting the transaction. This explains why a successful wallet approval could leave only the review text and no submitted signature. The latest observed intent was 13,419,725 lamports and had expired by the time it was inspected; no matching finalized transfer was found.

The server allowlist now permits this read, and the non-centralized proxy does not cache its mutable validity result. The centralized gateway already leaves it uncached. An actual isolated Devnet HTTP server regression test verifies valid-to-expired responses reach the caller, preserves exact parameters and rejects unknown methods. Existing tests retain admin destination/fee-payer binding, one-OTP continuation, exact signatures and Mainnet write restrictions. These checks do not replace the final real Phantom withdrawal verification after deployment.
