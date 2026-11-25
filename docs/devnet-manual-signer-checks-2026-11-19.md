# Manual Devnet signer checks — 2026-11-19

Status: **blocked pending wallet signatures** for successful transfers. Preparation and live rejection checks passed; these are not finalized payout evidence.

Live Devnet build `9eab751f3af811613d77416ccf2fef8b22396ce5` retained `FUNDED_SIGNER_ENFORCE=all`. No deployment or policy change was made during this verification.

## Prepared claims

Mint: `GQz39ywpJkHXeCVcyUxHEYqtkVqC9k66MEjv9a4CSojb`.

Finalized source collection: `5jrtAhbioq87PkswXEniQthZzDTy3EQ4dXx6X4GyvUn6w6D5Dr2e7b6r4WBgTw9xVZA9rWpiCxh8WqzakJtXDstS`.

| Claim | Lamports | Required wallet |
|---|---:|---|
| Creator | 142,336 | `DiS3aX96RXtA2A4u86DGtZHsbk6SZaKH8fRBv4onsr6J` |
| Referral level 1 | 2,134 | `FAoYzAizKjMxH5h3hW4QHRDPrbUbiYDXaGqe8ZMdqAsh` |
| Referral level 2 | 890 | `Dodtyx5Dftb6co5AdN4Js97SAsvWWStCACQyZLPR9DXa` |
| Referral level 3 | 534 | `H6KKVK7J83kD6pPduEQCB1WiGgHTzRxzkYhuFWVqYp7c` |

The creator endpoint returned HTTP 202 with the exact payout transaction requiring creator and authority signatures. Each referral endpoint returned HTTP 202 with an amount-bound recipient challenge; each rejected an invalid recipient signature with HTTP 401. A transient RPC rate-limit 503 resolved on a bounded retry. Refresh expiring challenges and transactions before signing.

## Treasury checks

All four configured treasury roles (operations, revenue, trade, boost) rejected these live signer requests with HTTP 403: non-admin recipient, treasury-paid fee instead of recipient-paid fee, and an 11 SOL transfer exceeding the 10 SOL per-transfer cap. All 12 requests matched refused signer journal entries; none were broadcast.

The proposed initial operations withdrawal is 10,000 lamports from `E5i7NyPdhuQKhAZdTVfk3uDyxSFtcaCte8Tfuh3FkjSB`. The normal preparation endpoint rejected the service API token with HTTP 401, requiring an admin wallet session. Completing it also requires the normal action-bound email confirmation and the admin's transaction co-signature. The recipient pays the network fee, so this small test may yield zero net recipient credit when the fee is 10,000 lamports; verification must account for that fee exactly.

Allowlisted admin wallets:

- `CG87C9tjCSB9BAoKfoPUM3mLvbg3WAK1NGNQCWi12zcJ`
- `ER7zhtSwfSu7B5Wb7uFwnWSZPLMmezmSXieY5JyLFzXC`

The signer cannot provide these recipient/admin signatures. No keys were exported, identities substituted, entitlements edited, or email/session checks bypassed. The pending user question asks which wallet app or dedicated Devnet QA harness can supply the signatures; it does not request private keys.

## Verification boundary

Sixteen existing local signer/admin withdrawal tests passed. Their chain/email fixtures are mocked and do not establish live successful withdrawals. No successful manual creator claim, referral claim, or treasury withdrawal is claimed for this run. After signing, verify finalized receipts, exact vault/source debits and recipient credits (net of admin-paid fees), and matching signer message digests before updating this status.

Read-only Mainnet checks confirmed unchanged build `18d15d6daa1f64a30e4870d627d6d44ede580d4d`, original container start times, disabled agency-buyback flags, and no configured price signer. Mainnet activation remains blocked.

[Public evidence](evidence/devnet-manual-signer-checks-2026-11-19.json)
