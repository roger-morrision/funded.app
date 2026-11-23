# Offline conversion attempt anchor core

Base: `816687dd14fb475075a4a18beddd9a53e9b5c7ad`.

`server/token-conversion-attempt-anchor-core.mjs` is an unbound consistency component. It requires explicit first provisioning against the reviewed public release context, two distinct immutable store interfaces, complete version/delete-marker inventories, and durable conditional creates. It anchors the unsigned message, original conversion/custody/amount facts, each role signature, signed wire, broadcast intent and finalized proof or absence bytes in a digest chain. A write is acknowledged only after both copies independently read back as the same full chain. Partial, missing, stale, altered and conflicting copies refuse further append or journal verification.

Callers must provide authenticated stage facts from all three journals. The validator rejects a coherent rollback or a journal that has unanchored stages. This component has **no runtime importer** and performs no RPC read, cryptographic signature verification, signing, send, approval or financial action. In-memory tests are synthetic. A store identifier does not establish independent administration.

Before production binding, two separately governed immutable backends and their exact account/bucket references, no-loss backup and restore procedure, conditional-create and complete-version semantics, signed-attempt journal adapter, finalized chain reconciliation, release review and wallet funding approval still require independent acceptance. A partial or uncertain write cannot authorize a new signing or broadcast attempt.

Focused check: `node --test tests/readiness/token-conversion-attempt-anchor-core.test.mjs` (Node 26.13.1, 9 passed, 0 failed). The tests use no credentials, network or live chain.
