# FQA-MN-005-CONTEXT-01 correction

QA's unchanged exact-5113 probe reproduced the provenance defect: a transaction
at slot 1000 was accepted after the synthetic reviewed ProgramData deployment
slot changed to 1100. The full current hash matched, but that did not establish
which executable the older transaction used. This code was not live.

The adapter now loads the exact finalized transaction/status first, then performs
two **uncached finalized contextual account reads**. Executable context is at
least the transaction slot; canonical ProgramData context is at least the
executable context. Full existing loader/pointer/authority/ELF/hash checks remain.
Receipt/credit reads are at least that authenticated ProgramData context. Missing,
malformed, stale or unavailable contexts stay unresolved, without a cache fallback.

The header deployment slot must be **strictly before** the transaction slot.
Same-slot acceptance is conservatively rejected: newly deployed/upgraded program
bytes become effective one slot later, so equal slot numbers do not establish the
required executable interval. See the primary
[Solana program execution documentation](https://solana.com/docs/core/programs/program-execution).

The original QA probe bytes, SHA-256
`d0ad9870d06f4e2cc6110d11bed9837de77b6ac61c516ef6fd2c00639413a2e8`,
were run unchanged before and after. Baseline exits 1; correction exits 0 with the
ordinary control accepted and the predating transaction unresolved. The probe is
preserved in QA's evidence directory, never edited by Dev. Running the same bytes
as an ES module from the corrected checkout resolves the corrected fixture/parser.

Thirty required focused cases pass with zero failures/skips/TODO: previous 26 plus
fresh-read/deployment/context boundaries. Deploy 999 / tx 1000 passes; deploy
1000, 1001 or 1100 / tx 1000 rejects. Repeated authentication rereads both accounts.
Missing contextual API, stale/backwards contexts, string/unsafe/fractional slots,
short headers, stale status/receipt context and RPC failure reject. Existing
signature/message/CPI/custody checks and incomplete-manifest no-RPC gate pass.

Reproduce with the same two public capture/ELF inputs documented for the proof
slice, using:

```text
node scripts/security-tests.mjs --inventory config/token-conversion-sell-context-tests.json
```

Evidence: shared `data/qa-evidence/mainnet-production-packet-20261122/`,
`qa-context-probe-before.*`, `qa-context-probe-after.*`,
`token-sell-context-result.json`, `token-sell-context.stderr`,
`context-source-size.stdout` and `sell-context-correction-evidence.json`.
All financial/finality inputs remain explicitly synthetic unit fixtures. No
signing/worker admission, pool map, financial policy or deployed revision changes.
