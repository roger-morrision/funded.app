# Admin withdrawals and Mainnet preparation — 8 November 2026

Mainnet remains **NO-GO**. Missing production configuration stays as placeholders;
this release does not deploy or upgrade a Solana program or enable Mainnet writes.

## Admin withdrawal flow

Select the source, enter SOL or Max, submit, enter the email OTP, then sign in
Phantom. The connected Phantom public key must equal the authenticated admin
before OTP and before/after signing. That admin is both the fixed recipient and
fee payer. The source partially signs only after email approval. The backend
verifies both signatures against the exact saved message and journals the final
signature before the browser broadcasts it. Normal receipt recording continues
that same approved intent; it does not request another OTP or send another payment.

Max preserves the source reserve. The admin must already cover the two-signature
network fee and its rent reserve. Missing source keys are unavailable, and program
vaults retain their authorized payout instructions. Source keys remain server-only.
The optional `compose.admin-treasuries.yml` mounts existing Devnet treasury keys.

The earlier live Operations test transferred **3,748 lamports** to admin
`CG87C9tjCSB9BAoKfoPUM3mLvbg3WAK1NGNQCWi12zcJ`. It finalized at slot 519917282;
the database receipt and original intent both finalized. The exact on-chain proof
is [recorded here](evidence/admin-operations-withdrawal-2026-11-08.json).
That test used the preceding source-paid fee implementation (5,000 lamports),
before the requested Phantom/admin fee-payer change. It is not evidence of a
wallet-extension test of the new flow. The new two-signature flow is covered by
real local HTTP handlers with mocked RPC/email and ephemeral wallet signatures.
Browser-extension automation was unavailable because its browser profile was in use.

## Mainnet preparation changes

- `config/mainnet-program-release.json` keeps the production identity, authority,
  exact executable/ProgramData hashes and independent review references empty.
  Runtime trust rejects placeholders, Devnet identities, the public test identity,
  missing reviews, immutable programs, wrong loader/PDA/authority and changed bytes.
- Escrow and agency verification accept an explicit network and verify its genesis
  before reading accounts. Worker heartbeat proofs cannot cross networks. Mainnet
  launch-protection reads use the selected network; Devnet risk scans stay isolated.
- Promotion pricing verifies the selected RPC network and labels its cached result.
- The Mainnet preflight now requires an upgrade authority and rejects an immutable
  deployment. The explicit `--config` loader resolves URL secret-file references
  without loading the local Devnet environment or printing credential values.

Run `node scripts/mainnet-readiness-preflight.mjs --config config/mainnet-staging.example`
for a truthful placeholder report. Exit 1/NO-GO is expected. Use a private completed
copy plus `--online` for finalized read-only checks; this never activates writes.

## Remaining work

Production identities and isolated infrastructure, an independently reviewed final
binary, complete launch/financial-worker call-site network plumbing, every financial
acceptance case on that candidate, and a capped Mainnet canary remain outstanding.
The [network-port checklist](mainnet-network-port-2026-11-08.md) and
`config/mainnet-acceptance-plan.json` remain authoritative. Local passing tests and
one Operations receipt do not establish complete Mainnet financial acceptance.

The disposable PostgreSQL withdrawal-journal check is reproducible with
`node scripts/verify-admin-withdrawal-store.mjs`; it uses an isolated temporary
database and never opens the live application database.
