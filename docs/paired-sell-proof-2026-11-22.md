# FQA-MN-005 paired sell receipt and finalized-context adapter

This slice supplies the actual transaction-fact parser and finalized RPC adapter
for the reviewed USDC-base/WSOL-quote exact-input conversion. It is unimported by
runtime workers/signing services; no pool map, signer policy or release admission
is widened. The public committed production manifest remains incomplete.

`tokenSellReceiptFacts` reconstructs the builder, checks the frozen message hash,
verifies both operator/price Ed25519 signatures, exact 57-byte instruction and 41
addresses, exact Pump sell CPI and WSOL closure. Program-owned immutable receipt
and category credit must match. USDC mint/program/vault-owner and debit must agree;
SOL proceeds exclude all previous WSOL lamports and the initial vault rent top-up.
This parser returns transaction facts, never asserts finality itself.

`loadFinalizedTokenSell` additionally admits only a reviewed production manifest,
matches Mainnet genesis and complete loader/ProgramData/authority/ELF bytes, reads
the requested transaction and finalized signature status at the same slot, and
reads immutable receipt/category credit at a context not older than that slot.
The subsequent CONTEXT-01 correction replaces cached/noncontextual program reads
with uncached monotonic finalized reads and verifies that the transaction follows
the pinned deployment's effective interval; see the dedicated correction report.
Missing admission, RPC/history/status/account/receipt facts return unresolved null,
without signing or retry. The expected message hash must come from the future
durable reviewed intent, not a client's unauthenticated declaration.

Twenty-six named tests pass: unchanged ten builder cases plus sixteen proof cases,
including categories 5/6/7 with ordinary and 700,000-lamport prefunded WSOL. The
proof fixture has real in-memory deterministic TEST signatures, authentic captured
pool/config bytes and exact retained 8f6 ELF. ProgramData header, review metadata,
financial accounts, transaction result and finality response are explicitly
synthetic unit fixtures. They are not a real independent review or finalized chain
result. No test review metadata is persisted into production configuration.

Use supported Node 24 and these public inputs:

```powershell
$env:FUNDED_OFFLINE_USDC_SELL_CAPTURE='C:/Data/DevApps/funded.app/data/qa-evidence/mainnet-production-packet-20261122/usdc-sell-capture.json'
$env:FUNDED_OFFLINE_PRODUCTION_ELF='C:/Data/DevApps/funded.app/.secrets/mainnet-readiness-artifacts/20261122/production-8f6b661e.so'
node scripts/security-tests.mjs --inventory config/token-conversion-sell-proof-tests.json
```

The revised ELF is 1,110,880 bytes / SHA-256
`8f6b661e4318be921bc41db86d410d888afc62c851c1e56d60e129ce7bb75bbd`,
source `0278fb68a3eb4cae66115bd61a03c0f91ac46c1b`. Missing ELF fails the
command even when the ten builder cases pass. Changed-file syntax and maintained
source budgets pass. No broad UI/build/deployment gate is claimed for this module.

Shared evidence root: `data/qa-evidence/mainnet-production-packet-20261122/`;
`token-sell-proof-result.json`, `missing-proof-elf-result.json`,
`token-sell-proof.stderr` and `proof-source-size.stdout`. Full independent price
review, typed reservation/replay journal, keeper submission/recovery and actual
compiled/live financial integration remain open under the existing issue.
