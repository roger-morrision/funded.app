# Bounded Devnet reward QA profile

The preview's ignored `.env.deploy` selects exact disposable V3 mint addresses for lower test thresholds. These settings do not change the signed 80/20 fee split, existing allocations, or the five SOL default buyback threshold when the QA flag is off. The application rejects the enabled QA profile outside Devnet.

| Setting | Devnet QA value | Normal value |
| --- | ---: | ---: |
| Buyback trigger | 100,000 lamports | 5,000,000,000 lamports |
| Pump fee collection floor, selected mints | 100,000 lamports | 10,000,000 lamports |
| Holder wallet minimum, selected mints | $0.01 | $20 |
| Holder pool minimum, selected mints | $0.001 and at least 10,000 lamports | $20 and at least 10,000,000 lamports |
| Holder cutoff, selected mints | Five minutes, sampled every minute | Hourly, sampled every five minutes |

The preview allowlists the four V3 QA mints with holder shares: `2F6VAkmF6sXEwmY9No15EkthW7bwd2eocxM4yd8pWaRw`, `26ds5kv2n8JuWZ2uRu1goxEw7xy7YirpdsqdiLycy1Zg`, `EtMFvbnLJMmp4PWqDVSqYzWfkWhZy3FznJQTN35rYWPc`, and `HdGmAbwR1ng3VTQkQ6Gw3QYhJGebWNFf5voktjCKwhvL`. A mint outside the list keeps normal holder and collection thresholds. A prepared reward cycle retains its original policy; changing the profile does not rewrite or replay paid cycles. Tiny QA payouts use the separate Devnet authority to cover transaction and account costs, so the zero per-holder cost allowance must never be used to model live economics.

The five funded but unopened V3 QA community reserves have an optional exact-mint QA cutoff allowlist. It requires a finalized authority-signed marker, a complete exact-slot `$FUNDED` holder snapshot, immutable Merkle root, and creator/authority approval to open each drop. Its `devnet-qa-cutoff` label is distinct from `pump-migration`; it does not establish a genuine migration. It does not shorten a real Pump migration snapshot or remove the 90-day claim window.

X OAuth configuration, unindexed buyback vault provenance, admin signer access, and actual wallet signatures are independent gates. Lower thresholds cannot make those flows verified. Verify finalized vault and recipient balance deltas and burn instructions after the new image is deployed before marking any additional QA payment complete.
