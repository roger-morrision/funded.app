# Launch execution and recovery fixes — 2026-11-24

Launch execution now waits for recovery records before wallet approval and broadcast. Every send explicitly disables RPC retries. A finalized confirmation must contain an explicit successful result; incomplete responses retain an uncertain outcome and the original signature.

Errors carry public receipt information through the executor, launch flow and UI controller, including failures after coin creation returns. A journal failure cannot replace the transaction outcome with an apparent pre-send failure. Pending developer buys remain visible in the final launch result and recovery history even after coin registration completes.

The journal refuses unreadable or corrupt history instead of replacing it with an empty ledger, verifies writes by reading them back, and retains unresolved rows and signed receipt events beyond the normal history limits. This is browser-local recovery storage, not independently managed durable custody storage; unavailable storage blocks further sends.

The complete coin-creation plan is compiled and checked against transaction size limits before a separate promotion burn. Launch, reserve and settlement identities must agree. Wallet identity and quote/ticker expiry are rechecked after asynchronous persistence immediately before broadcast.

## Verification

- All 60 required security tests passed, including 13 new execution, recovery and burn-order cases.
- Tests exercise real transaction construction/signatures with disposable in-memory test keys and mocked RPC responses. They cover legacy and versioned transactions, wallet mutation, asynchronous storage failures, malformed confirmations, uncertain broadcasts, finalized failures, receipt retention and pre-burn rejection.
- Production frontend build and source-size checks passed (1,514 maintained files). Focused syntax checks passed after the final controller changes.
- Mainnet launch execution remains disabled. The identity-mismatch and Mainnet rejection tests require zero RPC reads, wallet approvals and sends.

These checks are local-only/mocked. They do not prove live on-chain account deltas, financial recovery acceptance, independent review or Mainnet readiness. Production custody/runtime integration, metadata publication verification, financial end-to-end acceptance and the reviewed release/canary remain outstanding. Existing payer, metadata and fee-recipient references from the earlier settings integration are preserved.
