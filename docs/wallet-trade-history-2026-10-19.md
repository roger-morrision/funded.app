# Connected-wallet trade history repair

## Diagnosis

Wallet `ER7zhtSwfSu7B5Wb7uFwnWSZPLMmezmSXieY5JyLFzXC` had two finalized Devnet Pump buys for FPQA (`HdGmAbwR1ng3VTQkQ6Gw3QYhJGebWNFf5voktjCKwhvL`). Portfolio filtered Explore's latest 20 trades per listed coin. Later trades by other wallets displaced both buys from that preview. Explore also did not poll on Portfolio, so zero coins scanned was incorrectly presented as an empty trade history.

At 2026-10-19T04:11:28Z, an independent finalized wallet scan examined seven successful transactions within 24 hours, from 30 signature references. It found two buys and no proof gaps. Five other receipts were payouts, not trades.

| Finalized signature | Event SOL principal (lamports) | Token base units (6 decimals) |
| --- | ---: | ---: |
| `5EU6q9MeJ76z9rmyhrBETKA2GzTv2DZ988NkgqGYs6ff8jPHapzw5o4ESqAdnx34mfLy74fKCDnhEG2SDNwGiCEt` | 247365234 | 76701475546672 |
| `55G9SMYRgihn3EhcExgCQH4tdq4gWJChUbNwvvcnagaaq6dWJ3NdnjwSWpcvbvnSGq9zsr7bwMpagkuZXPw3rAc` | 247524751 | 134726182334557 |

These event amounts exclude transaction costs. Public stripped receipts are in `tests/fixtures/wallet-pump-trades.json`; no keys are included.

## Repair and limits

- Read-only `GET /api/wallets/:wallet/trades` verifies Devnet genesis, finalized signature/slot, wallet membership, successful program frames, wallet token metadata and Pump/PumpSwap trade identity.
- Canonical SOL PumpSwap buys and sells are supported. This is not general Solana transaction history.
- The endpoint examines up to 50 wallet signatures, returns up to 100 trades within 24 hours, and labels missing receipts, unknown timestamps and capped history as partial coverage.
- Cache: 60 seconds, 250 wallets; concurrency: two distinct scans; per-client scan rate limit; one 20-second RPC deadline; no signing or ledger writes.
- Portfolio loads independently of Explore, on wallet changes, trade-tab activation, explicit refresh and a 60-second route poll. Requests cannot publish data after a wallet change.
- Empty, loading, partial and unavailable states are distinct. Token decimals come from finalized receipt metadata even when the wallet has sold its holding.

## Verification

- Independent read-only Devnet scan: the two actual finalized buys above; no new trades were submitted.
- Unit suite: 910 passed, nine skipped (919 total). The focused suite passed again after correcting the trade-tab refresh identifier.
- Production build passed; existing bundle-size warnings remain.
- Isolated browser fixtures verify two displayed buys with Explore unavailable, RPC failure/retry, Devnet receipt links, mobile overflow and clearing rows on disconnect. These browser checks are mocked; they do not claim a real-wallet approval or a new on-chain payment.

App deployment must be verified separately by exact image revision and public endpoint receipts. This repair does not resolve the separate historical settlement contract upgrade.
