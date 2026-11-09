# Mainnet preparation with placeholders

The user requested completion of the go-live work and chose placeholders for production inputs. This is a preparation release. Mainnet transactions remain disabled; placeholders do not authorize deployment, wallet funding, signing, or a public launch.

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
2. Replace the placeholders in the deployment inventory and private staging config: dedicated program, upgrade authority, admin, FUNDED mint/pool, RPC/database/storage, signer references and spend limits.
3. Freeze the actual production binary and source, reproduce its bytes, and obtain independent contract/custody review. Historical reference binaries are not deployment approvals.
4. Refresh rent and transaction estimates against those exact bytes. Approve the concrete program ID, authority, payer reference and total capped spend.
5. Deploy to isolated Mainnet infrastructure, verify finalized bytecode/state, and run the capped canary. Public writes open only after every financial delta and recovery case is accepted.

Rollback starts by stopping new writes and financial workers while preserving journals, then reconciling every submitted signature. Do not automatically downgrade the on-chain program or clear financial records.
