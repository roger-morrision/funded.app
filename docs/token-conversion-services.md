# Private conversion controller and custody-service preparation

This slice connects the actual conversion transport to two authenticated HTTP
signer backends. It provides passive server factories, not a production launcher,
public API route, worker registration, key loader or activation setting. Existing
Devnet signer launchers and all Mainnet guards remain unchanged. Both controller
and custody factories require the existing independently reviewed release and
price-policy tuple; current unadmitted production settings cannot start them.

The controller holds service authentication references and public identities.
It receives a bounded exact unsigned request or saved hash at authenticated
`POST /run`. It never receives either private signing key. Remote adapters permit
HTTPS or a private single-label HTTP service origin, reject credentials/query
strings and redirects, bound JSON responses, and verify the response role, public
key, message hash and Ed25519 signature against the immutable unsigned wire.

Each role backend receives its own RPC, dedicated locked journal and approved
custody callback. Authenticated `POST /sign` performs the actual full policy,
program/context, quote, simulation, reserve and raw-USDC-budget checks using that
backend's RPC. A one-time durable signing claim precedes custody access. The role
signature is validated and durably cached before a response may expose it. A
duplicate can return that same signature only after another actual fresh review;
an unknown prior custody operation cannot sign again. Role caches are validated
cryptographically when read and cannot silently reset on restart or corruption.

Authenticated `POST /reconcile` independently verifies the exact finalized
transaction and effects; a client completion assertion is insufficient. The
controller commits its own proof first, then asks both backends to reconcile.
Backend unavailability leaves their reconciliation pending without erasing the
controller's durable financial proof. Subsequent saved-hash requests repeat only
read-only reconciliation. Send-intent, HTTP success and stored signatures are
not chain payment evidence. A client losing its response must recover the saved
hash rather than create another message.

`node scripts/check-token-conversion-service.mjs` requires 23 actual HTTP cases.
Tests bind three loopback servers and use separate real filesystem journals and
separate synthetic RPC readers. The declared HTTPS service origins are mapped to
those loopback listeners by test adapters; no external service is contacted.
Deterministic test keys remain in RAM, synthetic sends never reach a chain, and
separate servers/keys are not proof of independent administrative custody.

Production operator/price identities, approved custody adapters and authentication
provisioning, independent administrative control, runtime admission and worker
selection, operational financial backup and live acceptance remain open. This
slice does not add economic policy, signing allowlists, budgets, spending or
Mainnet activation authority.
