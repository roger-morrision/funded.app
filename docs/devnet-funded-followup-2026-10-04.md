# Funded Devnet acceptance follow-up — October 4, 2026

User funding resolved the test-payer blocker. Both creator and trader received 5 Devnet SOL. An authorized transfer funded the claimant with 0.1 SOL; finalized slot 507248946 and exact recipient credit were independently verified. The transfer cost 5,000 lamports. [Funding receipt](audit/devnet-2026-10-04/wallet-funding.json).

## Fresh public Devnet results

Five new transactions finalized successfully against the existing deployed fee-router and Pump programs:

| Step | Finalized slot | Receipt |
| --- | --- | --- |
| mint-router | 507249451 | [Finalized transaction](https://explorer.solana.com/tx/56Fh29xz2BkN13qx1rRkAvmF4w6fFdGyBiY71f39uBGej285iVdkSatD7NQmu64xj6D3qsCuFLvR34sCFabtVjh8?cluster=devnet) |
| isolated-pump-launch | 507249468 | [Finalized transaction](https://explorer.solana.com/tx/LGc1waFuA5MoviB2zXRvtWTfaJbSNRbfrfJ7p4XMrSyTdy4Zt4SwTLpA6U2E4V5jZ6hWxkxtKx32cz6aAY2AfK5?cluster=devnet) |
| buy | 507249482 | [Finalized transaction](https://explorer.solana.com/tx/2UfaVuNkDfxLHc3it2sdhdNCLY1Nr3EMLEy2i5gNdGqdoeXxjrfSFYKPfo6Fbt6173dJwVyRwMVtKhLAQgtPbtTa?cluster=devnet) |
| sell | 507249496 | [Finalized transaction](https://explorer.solana.com/tx/5Kw3xdG2fSZVEuSNpLgKGiMLEDt3DMRm4Vs5xFkeVbqYmncjcYNTXzZ7NHwhCpN3FuGQH7ijpS2h86b1tntruPPZ?cluster=devnet) |
| creator-fee-collection | 507249509 | [Finalized transaction](https://explorer.solana.com/tx/9kgLcwXzfqooCWjkc2zsfSGM823SWoc6XDoZzG5MiWQ8iZxsqerKQUS1QaEZePaXt45UXwSa67a2wMgwwmebceU?cluster=devnet) |

Test mint: `XVzXGMiFdXe7SCHpnZRotg5Ed7gtfPcDNotKZ4WTKhW`.

- Initialized a per-mint router and created a fresh Pump token with that router as creator.
- Bought and sold exactly 3177688931278 token base units; no purchased inventory remained.
- Claimant received exactly 15,000 lamports for the buy fee and 14,703 for the sell fee.
- Creator-fee collection credited the mint router exactly 17,822 lamports. This verifies collection, not authority-controlled distribution from the router.
- Independently re-fetched all five finalized transactions and checked execution errors, slots, trade token changes and fee-recipient deltas.

The creator spent 0.010502162 SOL in this isolated sequence, including account rent and fees, after the claimant transfer. All new transactions used Devnet. No program deployment, upgrade or authority change occurred.

[Execution evidence](audit/devnet-2026-10-04/prefunded-acceptance.json) and [independent receipt/balance recheck](audit/devnet-2026-10-04/prefunded-receipt-recheck.json).

## Final test-wallet balances

| Role | Public address | Devnet SOL |
| --- | --- | ---: |
| creator | `AMQ9x851U9XV2jRz2oKkCVnxkdqb4c2PyeSncaHVRDVP` | 4.889492838 |
| trader | `DQ21qu9ZSUKUsBF5rDJgBfgqaUehywBtTvZXz3d8SHmA` | 5 |
| claimant | `8tYcqWardbjghVuRL1dQkgULMGbeJGfuCcSKYKFzizig` | 0.100029703 |

Private keys remain only in ignored local storage with restricted permissions; none are in these reports or Git.

## Harness changes and validation

The acceptance harness accepts an explicit `--wallet=PATH` for these provisioned test wallets and skips faucet requests. It checks Devnet genesis before reading keys and before signing, rejects underfunded payers, redacts key-parser errors, journals signatures before broadcast and allows an explicit `--fee-recipient=ADDRESS`. Confirmed preflight now matches the confirmed blockhash commitment. Eight targeted tests pass, including wrong-network-before-key-read and prefunded/no-faucet cases.

For another intentional new test sequence, use a new evidence output path:

```sh
NODE_USE_ENV_PROXY=1 node scripts/devnet-acceptance.mjs --execute \
  --wallet=/path/to/disposable-devnet-keypair.json \
  --fee-recipient=8tYcqWardbjghVuRL1dQkgULMGbeJGfuCcSKYKFzizig \
  --output=/path/to/new-acceptance-evidence.json
```

This command creates a new mint and transactions. It is not a resume command; do not blindly rerun after an uncertain submission. Check the recorded signatures first.

## Remaining limits

The public app still returned HTTP 530. This isolated SDK flow uses test metadata and does not cover website launch/registration, atomic community reserve, graduation, paid packages/listings, OAuth, custody-controlled payouts or worker reconciliation. Those full application flows remain blocked by public ingress and service/custody configuration. The harness therefore correctly reports overall `blocked`, despite the five passing chain transactions.

The deployed program hash remains the prior rollout; current source contract changes are not deployed. Funding is now available, but full Devnet readiness and mainnet go-live are not established.
