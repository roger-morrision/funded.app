# Usability and reliability review — October 4, 2026

This second six-agent review improves daily use of the Devnet application and fixes additional payment, API and contract defects. It does not deploy the application or update the public on-chain program.

## User-facing changes

- Primary navigation has one link per destination. Portfolio and Rewards remain accessible across routes and intermediate desktop widths. Search has a readable mobile label; the network indicator explains that Devnet uses test SOL.
- Main actions use consistent typography and keyboard focus indicators. Important mobile actions have 44-pixel touch targets. Header layouts reserve space for the page label and wallet button.
- Optional launch social links are collapsed to shorten the first step, then open automatically when validation or a restored draft needs them. Existing input values, IDs and validation are preserved.
- Home and directory outages offer retry actions. Unavailable reward data stays unavailable instead of being mislabeled as an empty policy list.
- Saved searches explain their device scope and provide name validation, save/update/delete feedback, a copy-link action, and a selected manual-copy fallback when clipboard access fails.
- Receipt history keeps the last verified page visible after a failed refresh. CSV exports retain matching verified records and exact SOL amounts. Service status explains storage/network checks and when they were observed.

## Correctness fixes

Boost checkout validates quote identity and payment details, prevents replacing a saved unresolved payment, and coordinates journal writes across browser tabs where Web Locks are available. A new quote is offered only after matching finalized on-chain failure proof is checked and archived. An expired quote or missing transaction history alone never unlocks another payment. Backend receipt-storage failures instruct users to retry verification of the same signature and do not disclose internal paths.

API validation errors are distinguished from unavailable dependencies. Static files now use correct WebP, AVIF, JPEG and font MIME types. Unsupported chat-report methods advertise the allowed method.

A third party could previously prevent router initialization by depositing SOL into the empty router address first. Initialization now preserves the deposit and adds only the missing rent before allocating the account. ABI, account layout and signer requirements are unchanged. New bytecode tests cover prefunding, replay and header-repair authorization. See [contract evidence](contract-readiness-2026-10-04.md).

## Delivery and performance

Six lossless WebPs replace active PNG artwork references with identical decoded pixels, saving 3,579,180 bytes. Builds omit 55,223,785 bytes of unused archival PNG posters while preserving repository originals and referenced assets. The resulting browser distribution is approximately 16 MB instead of 73 MB. The existing large JavaScript chunk warning remains visible.

Build settings now record compiled network configuration and a browser-source digest. Release manifests reject changed browser source after build, mismatched networks and enabled server-held test wallets. Environment-file settings now correctly affect the mainnet read-only proxy configuration. See [build evidence](build-performance-2026-10-04.md).

## Verification and limits

- Final unit/integration run: 131 passed.
- Explicit local regression allowlist: 65 passed.
- Current contract: 13 tests passed, including 9 SBF integration tests. The prefunded-router regression failed before the fix.
- Production build, isolated HTTP release contract, build-settings and release-manifest checks passed.
- Integrated browser suite: 14 passed, covering navigation hit testing, keyboard focus, saved searches, clipboard fallback, draft validation/restoration, wallet handling, service status and receipt retention. A focused mobile connected-wallet check also passed.
- Final responsive sweep: 48 route/viewport combinations passed. Source syntax checked 417 files. Details and fixture scope are recorded in the [QA report](qa-e2e-2026-10-04.md).

No new public Devnet transaction was required for this presentation/backend review. Earlier fresh public launch/trade/collection results remain in [the funded Devnet follow-up](devnet-funded-followup-2026-10-04.md). They tested the existing deployed contract, not the newly rebuilt bytecode. The new current artifact SHA-256 is `f2fe2b160a861c74ddcff7aa74e79874191c2dc2c9d21b6ef5b1b4529daca470`.

Remaining external gates: restore public ingress (last probe HTTP 530), configure service/custody/OAuth integrations, verify the intended deployed artifacts and run full public application acceptance. GitHub publication remains blocked by repository write permissions. Mainnet remains disabled and is not certified ready.
