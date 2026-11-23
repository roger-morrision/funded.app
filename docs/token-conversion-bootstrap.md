# Private conversion runtime preparation

`prepareTokenConversionRuntime` prepares the existing controller or role-service
factory from explicit trusted public references. It defaults to recovery-only,
returns an unbound server, and installs no listener, timer, public API, production
launcher or worker. It reads no environment, key file or credential file itself.
The approved deployment runtime must supply its own bounded RPC, journal,
authentication and custody resolvers; no actual production references are
provisioned by this code.

Before journal or service-authentication access, preparation validates the existing
reviewed release/policy tuple, distinct role journal/authentication references and service origins, plus the
own price-RPC reference. It authenticates finalized genesis, executable pointer,
full ProgramData/ELF/upgrade authority, effective deployment interval, and the
owned canonical router and price-configuration accounts with increasing context
slots. Unadmitted, malformed, missing or stale evidence fails closed. Opaque
references are identifiers, not private paths, and errors do not expose resolver
details. Journal initialization validates saved context before authentication
resolution.

Recovery-only mode never resolves custody and cannot be overridden by a request
body. It can retain access to saved finalized proof while the same reviewed
program is paused or its active operator/price binding has rotated. The returned
admission facts are an observation, not financial authorization. A new ProgramData
hash or missing historical proof remains unresolved; recovery does not manufacture
old code provenance.

Explicit signing preparation requires current unpaused operator/price bindings
and an approved own-role custody reference. It still loads no custody at startup.
The role backend first completes its existing actual independent review and
durable signing claim. The lazy custody adapter then rechecks finalized context
before resolution, verifies the returned handle's exact public identity, and
checks context again before using the handle. Unknown/mismatched resolver results
cannot cause another automatic load or signature. Existing per-request policy,
reserve, quote age, immutable message and finalized-proof rules remain enforced.

Run `node scripts/check-token-conversion-bootstrap.mjs` for 20 required cases.
Tests include actual three-service loopback execution, context changes around
custody access, fail-before-secret ordering, and paused/rotated read-only proof
recovery. Financial RPC/finality and approved custody resolvers are synthetic;
fixture keys stay in RAM. The existing 23 HTTP cases cover unchanged active
factory behavior. Separate references or test services do not prove independent
production administrative custody.

Production custody approval/provisioning, independent administration, deployment
and funding approval, worker selection/admission, operational financial restore
and live chain acceptance remain open. This preparation introduces no key loader,
signing allowlist, budget, cap change or Mainnet activation flag.
