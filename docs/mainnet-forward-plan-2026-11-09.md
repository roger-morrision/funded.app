# Mainnet preparation with placeholders

Latest: [placeholder implementation and verification](mainnet-placeholder-preparation-2026-11-09.md). Historical deployment and test snapshots below do not override that report.

For the latest owner inputs, completed safeguards and remaining implementation gates, see [Mainnet handoff](mainnet-handoff-2026-11-09.md). The user reconfirmed placeholder-first preparation on 9 November; that does not authorize activating an incomplete Mainnet release.

The user requested completion of the go-live work. The selected admin and upgrade authority is `ER7zhtSwfSu7B5Wb7uFwnWSZPLMmezmSXieY5JyLFzXC`, with a maximum total spend of 5 SOL. Mainnet data providers are free Helius RPC, public Solana Mainnet RPC as backup, and Birdeye for indexed market metrics. Remaining production inputs still use placeholders. Mainnet transactions remain disabled; a budget and provider selection do not establish deployment or financial acceptance.

## Current preparation and live checks

- Public identities and the 5,000,000,000-lamport cap are recorded in the deployment and acceptance plans. The private staging configuration uses secret-file references, including the verified Mainnet Helius endpoint and existing Birdeye key. No transaction signer was created or loaded. Priority fees default to zero within the total cap.
- The RPC gateway now verifies the selected network at startup, during fallback initialization and before primary recovery. Mainnet and Devnet use separate history cache keys and Redis namespaces. Mainnet submission and airdrop methods stay blocked. A simulated Helius quota rejection successfully switched to the live public Mainnet endpoint; both providers returned finalized slots on the correct network. Read timeouts and server failures may fail over; ambiguous transaction outcomes never trigger a replay.
- `compose.mainnet-rpc.yml` describes an isolated, read-only gateway preview with distinct localhost ports and no database, transaction signer or Devnet volume. Supply a tested image digest and `FUNDED_MAINNET_RPC_URL_FILE` to its private credential file. This is not a Mainnet application deployment. The app's public write gates remain closed.
- Live Mainnet rent for the 900,144-byte reference program was 4.574443480 SOL, including the program account. A fresh Loader-v3 deployment reuses buffer lamports; do not count buffer rent twice. That leaves 0.425556520 SOL within the cap before fees, setup, token/pool provisioning and the canary. The final production binary and complete launch budget are not yet verified. The selected public wallet held zero Mainnet SOL at the check; the deployment payer/signing method is still unspecified.
- The existing 48-hour Devnet lock still holds 100,000,000 base units and rejected early release in a live simulation without a balance change. Its chain deadline is 2026-11-10 02:23:54 UTC (09:23:54 Bangkok). A successful matured release and duplicate rejection remain pending.
- The historical promoted launch `6Jw7EEAcjh7DHDkaqSbKhHEi5LMCgMrZcdzSWuR1ZL1x` was revalidated from finalized transactions: 139 FUNDED burned at slot 519859270 before creation at slot 519859298, with matching mint/quote binding and wallet debit. This does not verify a new current-release launch or cancelled-creation recovery.
- The independent Devnet buyback price-signer account is still absent. X identity/payment, full holder delivery, community distribution and recovery cases retain their separate acceptance requirements. An unavailable service is not treated as completed.

The public Solana endpoint is a backup with rate limits, not a production SLA. Helius is paced within its documented free-tier RPC limits. References: [Solana public endpoints](https://solana.com/docs/references/clusters), [Helius plans](https://www.helius.dev/pricing).

## Delivered in this preparation

- Creator and referral payment history propagates the selected network through finalized receipt verification. Mainnet rejects foreign or unlabelled payouts, settlements and allocations, and validates the RPC genesis before using chain data or cached proofs. Legacy unlabelled Devnet records retain their compatibility path.
- Token fee activity accepts the configured network, checks its RPC, and excludes foreign collection and payout states. Missing evidence remains unavailable or pending rather than becoming a zero or a paid reward.
- Launch registration passes the selected network into creation, fee-quote, reserve and escrow verification. Mainnet metadata must match the signed mint, payer, name, symbol and on-chain content address, and its public content must be verified. The registration write gate remains closed on Mainnet.
- Category payout and X-claim preparation carry the network into settlement, funding and allocation checks. New X wallet challenges include network identity; old Devnet challenges keep their original wording. Mainnet endpoints remain disabled pending integration and acceptance.
- Community program selection requires a matching network and reviewed Mainnet program. Residual reconciliation cannot use foreign receipts or Mainnet legacy-preservation recovery.
- Read-only staging starts with an explicit configuration, matching read-only browser build, no inherited Devnet credentials, no transaction signers, and no internal financial workers. Docker now accepts the read-only browser build argument.

These changes do not complete every Mainnet worker entry point, public launch activation or financial acceptance case. The existing gates deliberately prevent those paths from being enabled by configuration alone.

## Reproducible preparation

Generate a public planning packet from placeholder configuration and the recorded Devnet evidence:

```sh
npm run mainnet:packet -- --evidence docs/evidence/smaller-devnet-release-2026-11-09.json --output tmp/mainnet-launch-packet.json
```

Exit code 1 means NO-GO and is expected. The output file must not already exist. The report lists missing production inputs, review/budget mismatches, all 13 acceptance cases and their recorded status. It never copies configuration credentials into the report, treats recorded Devnet results as current-release verification, or grants activation. Inspect the source dirty flag before using a packet for release review.

The browser-only preview can be built and started without production credentials:

```sh
npm run build:mainnet-preview
npm run start:mainnet-preview
```

This preview serves on `127.0.0.1:4186`. It reads only Mainnet network identity and finalized slot; it has no app backend, wallet signer or production database. Missing financial data in that preview is expected.

For a future full read-only backend staging instance, fill a private copy of `config/mainnet-staging.example`. Build `dist` with matching public production values and `VITE_SOLANA_CLUSTER=mainnet-beta`, `VITE_EXPLORE_CLUSTER=mainnet-beta`, `VITE_MAINNET_READ_ONLY=true`, and `VITE_ALLOW_MAINNET=false`. Do not serve the existing Devnet `dist` directory or overwrite a running deployment. In a separate checkout or image, run:

```sh
npm run mainnet:staging -- --config /absolute/path/to/private-mainnet-staging.env
```

The launcher refuses incomplete placeholders and conflicting browser settings. It binds to localhost port 4187. Keep the production database, RPC, metadata namespace and signing roles separate from Devnet. Read-only staging has no transaction signers; production signer references are planned separately.

## Verification in this working tree

- 263 application tests passed, including new Mainnet receipt isolation, metadata, X challenge, staging and launch-packet checks. Financial RPC responses in these new unit tests are mocked; they are not new on-chain payments.
- Mainnet read-only browser build passed. A browser check confirmed the Mainnet genesis and a finalized slot from public RPC. Launch, payout and RPC transaction-submission POST requests were all rejected with HTTP 405 by the preview.
- The current funded.vip endpoint remained operational on Devnet during the check. No production signer or Mainnet transaction was used.

## Remaining acceptance work

| Case | Latest recorded Devnet evidence | Required next step |
| --- | --- | --- |
| Admin withdrawal | Live receipt recorded in the follow-up release | Revalidate final candidate; retain OTP, signer, fee and net-credit evidence |
| Standard launch, buy/sell, settlement, creator payout | Live receipts recorded | Revalidate final candidate and metadata/fee/network boundaries |
| Paid launch promotion | Local tests | Live burn-before-create and cancelled-creation recovery |
| Holder rewards | Partial live custody checks | Full eligibility, hourly snapshot, funding and payout pipeline |
| X claims | Blocked | Real OAuth identity, bound wallet and exact recipient credit |
| Protocol payouts | Partial | Complete agency execution and conservation checks |
| Buyback and burn | Blocked | Independently configured price attestation, canonical pool and funded execution |
| Community claims | Compiled-contract tests | Live migration, distribution root and recipient claims |
| Developer unlock | 6h/12h/24h live; 48h partial | Matured 48h live release and repeat rejection |
| Recovery | Partial | Restart/timeouts at each submission boundary; reconcile exact signatures |

Historical evidence is retained in `docs/evidence/smaller-devnet-release-2026-11-09.json`; it does not establish that this working tree has passed the complete matrix.

## Production handoff

1. Finish the remaining gated worker/launch integrations and Devnet cases above. Preserve failed and pending transaction journals; do not resubmit an unknown payment.
2. Replace the placeholders in the deployment inventory and private staging config: dedicated program, upgrade authority, admin, RICH mint/pool, RPC/database/storage, signer references and spend limits.
3. Freeze the actual production binary and source, reproduce its bytes, and obtain independent contract/custody review. Historical reference binaries are not deployment approvals.
4. Refresh rent and transaction estimates against those exact bytes. Approve the concrete program ID, authority, payer reference and total capped spend.
5. Deploy to isolated Mainnet infrastructure, verify finalized bytecode/state, and run the capped canary. Public writes open only after every financial delta and recovery case is accepted.

Rollback starts by stopping new writes and financial workers while preserving journals, then reconciling every submitted signature. Do not automatically downgrade the on-chain program or clear financial records.

## Devnet deployment verification

Preparation code `0cd8b8677fcdf1a21269982106d459fa3f9065b3` was committed, pushed and deployed to funded.vip on Devnet. The exact image passed all 263 tests with networking disabled. Syntax checks passed for 948 JavaScript files and size budgets for 1,171 maintained files. The normal release verifier accepted the deployment and retained rollback; the on-chain program pins were unchanged.

Post-deployment public checks reported the expected revision, an operational Devnet app and Mainnet activation disabled. Payment history retained 25 verified API receipts with `onchain-indexed` status. The sampled token retained its 46,853-lamport finalized collection and verified creator, community and holder-funding states. These were read-only regression checks; no new financial acceptance transaction was submitted. See [deployment evidence](evidence/mainnet-preparation-2026-11-09.json).
