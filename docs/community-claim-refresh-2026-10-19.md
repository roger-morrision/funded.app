# Community claim and airdrop detail refresh

## Finalized Devnet claim

Under deployed revision `83bec8b304e28744c5c20553548b51fd7338862b`, the dedicated QA claimant `Gv3uSJu2Ki7eqC6V4H1Fc31MMXLih6TJR19a5sydPfr7` claimed **323,861,731 base units** of mint `52TdgMLp41CtiLrAqqZ1N889RPfWMMzxwpF8MoaZFvN1`.

- Finalized transaction: `5jEKC3PNganCrnMiHV36Ex68SgwGJ2W8VJuzxJoKex3VdTsRLsKSpui17gnQZDd7rxDbqDnQumTRvf5QGutLN3Sx`, slot `512798376`.
- Recipient token increase and drop-vault decrease both equal the exact allocation. The payment PDA binds the recipient, drop, amount and leaf index.
- The exact migration-slot snapshot was independently reconstructed from its archive: migration slot `512511237`, nine reverse-replayed blocks, root `4046dcf9804cde38ba83c2640f5b2a72d406b25bf6052e718aa1bb19ece89d46`.
- The public proof changed from `claimable` to `claimed`; the API rejected another claim instruction. The recipient paid 2,636,440 Devnet lamports, below the 10,000,000-lamport bound. The upgrade payer was not used.
- This used the dedicated QA SDK signer. It does not verify an actual wallet-extension approval or a fresh X OAuth claim.

## UI defect found by the real test

The public reserve API correctly reported **870.114755 tokens claimed across three wallets**, but opening the detail panel before reserve verification completed left its claimed total at an unavailable dash. The background loader refreshed the directory without refreshing its already-open detail panel.

The correction refreshes the selected visible panel from the new verified state. Explicit wallet claim/funding interactions retain their controls and receipt messages while background refresh updates statistics. A different connected wallet does not inherit that preserved interaction. Closed panels stay closed.

Validation before publication: **1,046 unit tests passed, 10 existing skips**, six production-browser fixture cases passed, production build passed, all five critical gates passed, 1,084 JavaScript syntax checks and 1,277 source-size checks passed. The browser cases include deliberately delayed reserve responses at desktop/mobile widths, connected-wallet allocation labels, mobile keyboard navigation and the mocked X-claim wallet gate. Fixture tests are not on-chain evidence. The local development-server attempt timed out; the six passing browser cases used the production preview with browser development signing disabled.

Final image revision and actual public desktop/mobile acceptance must be recorded separately in ignored QA evidence after deployment. Generated proofs, screenshots, transaction journals and keys are not source files.

## Remaining limits

The agency contract upgrade and new-launch 0.6% / 0.25% / 0.15% referral rates remain unactivated. At the funding check the payer had 6.303105476 Devnet SOL against an 8.8399198 SOL requirement preserving its 3 SOL reserve. The latest single CLI faucet request failed. Existing mint policies retain their saved rates. No new agency execution or fresh X OAuth/extension claim is asserted here.
