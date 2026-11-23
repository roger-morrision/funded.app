# Private conversion runtime preparation

`prepareTokenConversionRuntime` prepares the existing controller or role-service
factory from explicit trusted public references. It defaults to recovery-only,
returns an unbound server, and installs no listener, timer, public API, production
launcher or worker. It reads no environment, key file or credential file itself.
The approved deployment runtime must supply its own bounded RPC, journal,
authentication and custody resolvers; no actual production references are
provisioned by this code.

First provisioning is a separate trusted operation. The release operator must
review an exact digest of the production release, signer policy and three
distinct journal references, retain the accepted evidence hash, then call
`provisionFreshTokenConversionJournals` once against three unpublished stores.
The helper checks all three are absent before writing and labels each role's
durable journal. A partial failure stops; it cannot be retried as a normal
startup. The digest and evidence hash identify the review inputs but do not
themselves prove independent review or authorize signing.

`prepareTokenConversionRuntime` is always a resume path. It validates the
controller, operator and price-attestation journal files, role labels, immutable
release context and saved rows before service authentication or custody access.
Missing, corrupt, wrong-context or aliased role journals fail closed. An HTTP
request, absent file or ordinary retry cannot choose first provisioning. Restore
must preserve the original three journal files and reconcile unresolved signed
attempts before any new reviewed work. No automatic empty-history reset exists
in this production bootstrap. A later call to the returned runtime's
`initialize()` repeats the same finalized-context and three-journal resume
checks; it cannot recreate a file removed after preparation.
The underlying journal's default `initialize()` also requires an existing
published file. Only the explicit reviewed first-provisioning call may create
a new role journal.
Resume also compares the three validated journals: each signer-role attempt
must match a controller intent, and a controller's signed transaction must
retain both exact role signatures. An older but otherwise valid single-role
backup therefore cannot silently erase an unknown signed attempt. Restoring
all three files to a mutually consistent older point still needs external
no-loss backup evidence and chain reconciliation before fresh signing.

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

The private controller also exposes `recoverSaved({after, limit})` for a future
worker. It selects only unfinished attempts already present in the controller's
validated journal and calls the existing recovery-only transport, at most 32
attempts per call. Its hash cursor is a work hint returned to the caller; the
worker must persist and advance it under its own recovery policy. This API does
not register or start a worker, create fresh requests, load custody, sign, or
broadcast. The controller journal is still read as a whole for each page.

`recoverNext({limit})` claims the next page cursor in that same locked store
before attempting recovery. A crash or unknown result may defer that page until
the cursor wraps, but it cannot create a new attempt or retry a send. The cursor
is bound to the journal context and survives a controller restart. An empty
journal does not create progress metadata.

The prepared recovery-only controller exposes `recoveryWorker`. It is inert
until a trusted private runtime calls `start()` or `tick()`. Each tick invokes
only `recoverNext` for at most 32 saved attempts. Concurrent ticks share one
in-flight page; `stop()` drains it. A journal/context fault stops scheduling
and requires a fresh reviewed worker instance. The worker has no fresh request,
custody, signing or broadcast method and is not registered in the public API
or production launcher. Whole-journal scans and operational role provisioning
remain open.

Explicit signing preparation requires current unpaused operator/price bindings
and an approved own-role custody reference. It still loads no custody at startup.
The role backend first completes its existing actual independent review and
durable signing claim. The lazy custody adapter then rechecks finalized context
before resolution, verifies the returned handle's exact public identity, and
checks context again before using the handle. Unknown/mismatched resolver results
cannot cause another automatic load or signature. Existing per-request policy,
reserve, quote age, immutable message and finalized-proof rules remain enforced.

Run `node scripts/check-token-conversion-bootstrap.mjs` for 28 required cases.
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
