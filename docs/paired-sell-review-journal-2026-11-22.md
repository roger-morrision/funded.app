# Independent paired conversion review and durable reconciliation

Scope: FQA-MN-003/MN-005 source integration, **local-only and not admitted**.
No HTTP signer, worker, runtime pool map, financial policy, production manifest,
cap, deployment or on-chain state is changed. The public incomplete Mainnet
manifest still rejects before RPC. No method in this slice signs or broadcasts.

## Implemented path

`independentTokenSellQuote` reads the reviewer's own finalized Mainnet pool,
global/fee config, classic USDC/WSOL mints and both token vaults. Actual SDK
pricing uses these raw reserves; caller quote/reserve/recipient hints are ignored.
The explicit typed policy binds USDC, Gf7, raw-unit order/daily bounds and limits
no wider than the existing slippage/liquidity protections. Tests' policy review
metadata and numeric budgets are fabricated unit inputs, not owner approval.

`reviewTokenSellConversion` authenticates uncached reviewed program context,
current router/guard/operator, activated distinct price signer, exact zero-signature
versioned message, active lookup tables and canonical fee ATA setup. It verifies
real agency/paired ledger codecs and category entitlements, raw custody, replay
absence, the operator's protected 3 SOL plus fees/maximum rent, and zero priority
fee for this proposed path. The full seven-account simulation must show exact
USDC debit, WSOL closure, immutable receipt, net SOL credit excluding prefund/rent,
and only the authorized category deltas. A second uncached program check follows
simulation. Simulation is not finalized execution evidence.

`createTokenConversionJournal` uses the existing locked/fsynced transactional
store on a **fresh dedicated file**. It persists the independently reviewed
message and public immutable intent before a caller may return a price signature.
It does not accept a caller's reviewed boolean or arbitrary denomination. One
unresolved reservation per vault prevents replacements even after 24 hours;
rolling daily charges are in raw USDC, never silently added to a SOL budget.
Concurrent store instances cannot race past the typed bound.

Both actual Ed25519 signatures on identical reviewed bytes must be durably
recorded before a future worker broadcasts. Unknown attempts stay charged.
Reconciliation calls the actual finalized proof adapter using the durable intent
and message hash. Status alone cannot settle. An externally recovered signature
also cannot bypass missing transaction evidence. A replacement can free raw
conversion budget only after confirmed/finalized blockhash expiry, authenticated
fresh program context and finalized receipt absence, with contradictory success
remaining unresolved. This **does not refund fees**: failed/unknown transactions
may have paid them. Clock rollback, corrupt/legacy state and context changes fail
without silently migrating or rewriting the journal.

The shared finalized-context helper accepts a later minimum context floor for
post-expiry absence checks while retaining the original transaction/deployment
interval. Its default existing proof behavior is unchanged.

## Reproducible tests and inputs

Run Node 24.22.3 from the exact checkout:

```powershell
$env:FUNDED_OFFLINE_USDC_SELL_CAPTURE = '<public usdc-sell-capture.json>'
$env:FUNDED_OFFLINE_PRODUCTION_ELF = '<retained public 8f6 ELF for existing proof regressions>'
$env:FUNDED_OFFLINE_REVIEW_ELF = '<current public 3f8 ELF>'
node scripts/security-tests.mjs --inventory config/token-conversion-integration-tests.json
```

Required inputs are hash-checked; they contain no private keys:

| Input | Bytes / SHA-256 |
| --- | --- |
| Finalized public Gf7 SDK capture, slot 472584037 | `e0a2d89f34bcf94421c225f2d5fe2ae2ab27c2c9fa4b162396a3eb38805e6aa3` |
| Existing proof fixture ELF, source 0278fb68 | 1,110,880 / `8f6b661e4318be921bc41db86d410d888afc62c851c1e56d60e129ce7bb75bbd` |
| New review/journal fixture ELF, source 971399ff | 1,110,424 / `3f8aaffc8b308df74cafe7fff22ad37e0ee2a33e28f747468804c36c66024e50` |

The inventory passes **72/72**, zero failures/skips/TODO: 10 existing builder,
16 existing proof, 5 context, 7 independent quote, 18 full reviewer and 16 durable
journal cases. The 34 new reviewer/journal cases bind the actual current 3f8 ELF
and public 5Thg upgrade identity, but deployment header/review/activation,
financial accounts, signatures, status and RPC are deterministic **synthetic**
unit fixtures. No actual transaction was executed. Categories 5/6/7 exercise the
complete review → durable reservation → signed-byte persistence → exact mocked
finalized proof path. The test keys exist only in memory.

Omitting the current ELF or supplying superseded 8f6 for that input makes the
inventory exit 1: only the unrelated 38 cases pass, all 34 required review/journal
cases remain unpassed. No skip or successful empty-test result is accepted.
Raw structured results and source hashes are in the linked evidence report.

## Remaining release dependencies

Independent review of this exact source is requested. The live signer/keeper
transport and worker scheduling must still call these gates with actual separate
operational/price custody, independently reviewed typed policy and the final
authenticated deployment context. No synthetic review metadata can be copied
into production. A journal file and market hash are not independent custody.

App historical expiry must authenticate original vault/cycle/reserve from saved
state while the current operator signs. Authenticated archival ingestion,
complete delivery, durable holder paging and final current-program financial
acceptance remain open. Final setup/canary messages, per-role balances, approved
limits and backup/restore/rollout acceptance are also outstanding. There is no
Mainnet funding request or full release readiness claim from these tests.
