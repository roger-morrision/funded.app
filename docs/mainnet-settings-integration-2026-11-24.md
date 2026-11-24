# Production settings integration — 2026-11-24

The existing payer, metadata credential reference and Mainnet fee recipient are now bound into `config/mainnet-deployment-plan.json`. The acceptance plan uses the same payer reference. No private key or credential value was read, copied into source, or printed for this work.

| Setting | Existing source | Selected value/reference |
| --- | --- | --- |
| Deployment payer | `.secrets/mainnet-release-wallets/deployment-payer-metadata.json` | `E9tQpKSi29HczaYdJKbiPLf2uhYEbNhq19muExsRdmgL` |
| Payer file | Existing local file; existence checked without opening it | `.secrets/mainnet-release-wallets/deployment-payer-keypair.json` |
| Metadata | Existing local credential file; existence checked without opening it | `.secrets/pinata-jwt` |
| Existing Mainnet metadata mount | `tmp/mainnet-deploy/mainnet.compose.json` | `/run/secrets/pinata_jwt`, backed by `/opt/richpad/mainnet/secrets/pinata_jwt` |
| Trade fee recipient | Mainnet compose and a fresh public `/api/service-fees` read | `M1HfA8vPXwGGn8uv5p9BZSYjsh4jhxhoMfDx2sGsj4M` |

The public fee policy returned `mainnet-beta`, revision 0 and 100 bps. This verifies the advertised configuration, not an on-chain fee payment. The local and older deployment environment files use different recipients; those values were not selected for Mainnet. Pinata authentication, credential equivalence across hosts, payer funding and control of the private key were not tested.

## Configuration changes

`npm run mainnet:prepare-config -- --output NEW_PRIVATE_ENV_FILE` generates a read-only preparation configuration from the plan. It never reads referenced secrets, signs, submits transactions or overwrites an existing file. It rejects mismatched selected identities, inline credentials, transaction signer settings and activation flags. Client/server fee recipients, program aliases and assets are generated together. Repository-relative service secret references become absolute local paths; existing POSIX server paths remain server paths.

Generated locally: `.secrets/mainnet-integration-20261124.env`. It contains references only and remains incomplete. It combines local payer/RPC/metadata references with the already provisioned server database reference; it must not be treated as a ready-to-start local or remote deployment. Host-specific mounts and the remaining placeholders still need to be completed for the selected staging host.

The explicit configuration loader now normalizes successfully loaded `_FILE` references against the configuration directory, so downstream consumers do not reinterpret relative paths against their working directory. The payer reference remains opaque and is never loaded by staging.

The launch packet now detects fee-recipient, payer-reference and metadata-reference drift between the plan, acceptance plan and configured environment. The stale contract candidate description and test-identity artifact details in the preparation plan were updated from the current candidate evidence. Final release/review fields were not changed.

## Verification and remaining work

- 40/40 required security regressions passed, including four new configuration integration cases.
- 3/3 deployment funding and preparation regressions passed.
- Syntax checks passed for 1,239 JavaScript files; size checks passed for 1,507 maintained code files.
- The generated file passed all three settings consistency checks. A second generation attempt was rejected and left its bytes unchanged.
- Tests use local or mocked inputs; no Mainnet signing, broadcast, payment or Pinata upload occurred.

The requested CCE index refresh was attempted but reported `Backend ingest failed: database is locked`. Its success counter does not establish a complete refreshed index; repository reads and executed tests supplied the evidence above.

Mainnet remains disabled. The generated config deliberately retains placeholders for the finalized full ProgramData hash; a candidate ELF hash is not a substitute. Independent release approval, host-specific service references, treasury/custody completion, production launch/signer/payout integration, financial recovery acceptance and the approved canary remain separate requirements. In particular, this configuration work does not remove the Devnet-only launch guards or admit program transactions through the Mainnet RPC policy.
