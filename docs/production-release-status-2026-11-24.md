# Production preparation status — 2026-11-24

Application revision `bfa004c61b214db7c8723d76ac274cc721c2db21` is committed,
pushed, CI-verified and deployed to `https://funded.vip` on Devnet. All six
application services report this revision and are healthy. Desktop and mobile
read-only browser checks passed. The
[delivery record](evidence/production-devnet-delivery-2026-11-24.json) identifies
the exact image, frontend digest, configuration comparison and checks.

The [private production conversion entry point](production-conversion-runtime.md)
implements explicit role/file binding, actual HTTPS RPC and journal resolvers,
lazy role custody, listener admission, shutdown and recovery selection. Its
173 integration tests passed in Linux Node 24 with mocked chain finality; the
63 required security tests also passed. This is implementation and local
integration evidence. The private Mainnet services have not been activated.

The existing Pinata credential-file setting successfully published a disposable
metadata probe. A fresh process without credentials verified its public JSON
and image bytes. The [public record](evidence/metadata-storage-probe-2026-11-24.json)
and [verification](evidence/metadata-storage-verification-2026-11-24.json) are
retained. No token was created. Final production launches must still prove their
own on-chain metadata URI and public bytes.

The owner explicitly selected Claude Desktop and accepts its AI second review
as the project review. The [review report](reviews/production-candidate-claude-2026-11-24.md)
records the actual scoped decision, independently reproduced candidate ELF,
test results and remaining conditions. This supersedes older requests for a
human reviewer as the selected review method; it does not represent a
professional human audit or Mainnet activation approval.

Claude independently reproduced the candidate ELF byte for byte and completed
45 local compiled-contract test executions with no failures, including all six
previously ignored CPI cases (the two conversion cases ran against each of
categories 5, 6 and 7). Those CPI runs use hash-verified historical DEX snapshots,
not live Mainnet funds. Recording the reviewer in the deployment/acceptance
plans also passed 17 existing Mainnet settings, release and guarded-route tests
in a network-disabled Linux Node 24 container.

Review clarification: SOL reward-cycle creation does consume the guardian's
outflow cap in the current contract. The broad comment in `guard.rs` saying
reward commitments never consume it is inaccurate for that operation. The
reviewed contract tree and binary were preserved; this is a documentation
clarification, not a change to accounting or authorization.

Mainnet remains unactivated. The ExUNA candidate program was absent at the
reviewer's read-only chain check. The executable release manifest therefore
still has no verified deployed ProgramData hash. Do not substitute the candidate
ELF hash for that full on-chain account hash. The existing selected payer,
administrator, operational roles, primary asset and fee recipient remain in the
deployment and infrastructure preparation files; no production key is printed
in these reports.

The remaining live sequence is to authorize and execute the exact program
deployment, verify its actual deployed identity/ProgramData/upgrade authority,
complete the exact production policy and operational admission record, then
collect finalized transactions and balance/account deltas for every case in
`config/mainnet-acceptance-plan.json`. Public launch and financial worker guards
remain closed until that evidence exists. Local VM and mocked RPC tests do not
satisfy live financial acceptance.
