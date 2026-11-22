# Current-source security regressions

Run `npm run test:security` with the project's supported Node 24 runtime.
`config/security-tests.json` is the reviewed inventory, including the exact required
case names. The command uses Node's structured test events, not a shell glob or a
successful process exit alone. Files must resolve inside the selected checkout.

The current scope is deliberately narrow: existing community opening recovery and
snapshot-history tests, four additional opening rejection cases, and the runner's
isolated outcome fixtures. It covers wrong genesis/immutable root, rejected or
missing opening proof, uncertain/expired attempts without new preparation or
broadcast, and incomplete finalized history. Fixtures mock receipts and do not
load private keys, sign, submit transactions or establish on-chain acceptance.
This is not a whole-application security audit or Mainnet approval.

The gate fails for an empty/missing inventory, an empty test file, any failing
case, incomplete execution, and any required case that is missing, skipped or
TODO. An unrelated passing case cannot replace a required skipped case. Node's
automatic empty-file wrapper is excluded from registered-case counts. The JSON
result retains the native Node summary and actual pass/fail/skip/TODO counts.

The inventory reuses existing tests instead of copying historical suites. Changing
a required case name or adding coverage requires an explicit inventory update in
the reviewed diff. `tests/security-runner.test.mjs` tests the CLI with temporary
isolated inventories: passing, zero discovery, empty module, all skipped,
required skipped alongside another pass, TODO, actual failure, missing required
name and missing file. Expected child failures do not count as security passes;
each parent case asserts the child's exit status and reported counters.
