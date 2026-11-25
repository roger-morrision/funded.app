# Program upgrades

The merged V3 router/developer escrow retains Loader-v3 upgradeability. Future
releases can replace its code at the same program address. No additional mutable
fee or escrow controls are needed for that capability. Each separately deployed
legacy program needs its own baseline and authority verification.

Use `npm run program:upgrade:check` to check a proposed upgrade. The command never
loads keys, creates transactions, deploys, changes authority or enables Mainnet.
The existing release admission and deployment approval process still applies.

## Prepare the evidence

Archive the current released ELF and generated Anchor IDL, and the proposed ELF
and IDL. Generate each pair from the same source revision, production feature
flags, program ID and pinned compiler. A matching IDL address does not prove the
ELF was compiled with that address; verify build provenance separately.

Create a plan using this schema. Replace every placeholder with reviewed values.
Paths are relative to the explicitly selected artifact directory and must stay
inside it, including after symlink resolution. `binary.bytes` is the exact file
size. IDL hashes cover the original file bytes, including formatting.

```json
{
  "schemaVersion": 1,
  "cluster": "mainnet-beta",
  "programId": "<existing program public key>",
  "upgradeAuthority": "<retained upgrade authority public key>",
  "upgradeable": true,
  "baseline": {
    "sourceRevision": "<40-character Git revision>",
    "deploymentSlot": "<decimal deployment slot from ProgramData>",
    "programDataSha256": "<SHA-256 of the full finalized ProgramData account>",
    "binary": {"file": "baseline/program.so", "bytes": 0, "sha256": "<SHA-256>"},
    "idl": {"file": "baseline/program.json", "sha256": "<SHA-256>"}
  },
  "candidate": {
    "sourceRevision": "<40-character Git revision>",
    "binary": {"file": "candidate/program.so", "bytes": 0, "sha256": "<SHA-256>"},
    "idl": {"file": "candidate/program.json", "sha256": "<SHA-256>"}
  }
}
```

The full ProgramData hash includes the loader header, deployment slot, authority
and allocation padding. It is different from the `.so` file hash. Baseline slot
and hash must come from the accepted deployment evidence, not an assumed address
or a successful transaction submission.

## Run checks

```powershell
npm run program:upgrade:check -- --plan upgrade-plan.json --artifact-dir upgrade-artifacts
$env:FUNDED_UPGRADE_RPC_URL = 'https://api.mainnet-beta.solana.com'
npm run program:upgrade:check -- --plan upgrade-plan.json --artifact-dir upgrade-artifacts --online --output before-upgrade.json
```

Use `cluster: "devnet"` and an explicit Devnet RPC for rehearsals. The online check
verifies network genesis, then reads the program and canonical ProgramData in one
finalized RPC context at or after the observed finalized tip. There is no cache,
network fallback, signer discovery or automatic retry on rate limits.

The comparison supports Anchor IDL spec `0.1.0` with explicit eight-byte
discriminators. It permits added instructions/types and documentation changes;
it rejects changes to existing instructions, account order, signer/writable
flags, included PDA seeds, arguments, discriminators, types, events, constants
and errors. Even appended account fields require migration review: existing
accounts do not automatically grow. Unknown IDL sections, missing definitions
and duplicate names/discriminators fail closed. Generate current-format IDLs for
older releases rather than treating missing information as compatible.

If the candidate needs more allocation, the check reports additional bytes and
blocks preflight. Review the Loader-v3 extension operation and rent separately.
After an approved extension, capture and review a fresh baseline ProgramData hash
because its allocation changed, then rerun preflight. Do not guess extra space
or increase the initial allocation just to satisfy this tool.

## Rehearse and verify an upgrade

Before signing, test the exact candidate against old account fixtures, including
raw router headers, balances, paid/withdrawn totals, saved fee policies, reward
commitments, PDA seeds and escrow unlock times. Exercise authorized and rejected
paths, and verify expected state/balance deltas with synthetic local/Devnet
fixtures. IDL cannot describe all manually serialized state or economic behavior.
Keep both binaries and a migration/recovery plan: reverting code does not revert
account migrations or completed transactions.

After the separately approved upgrade has finalized:

```powershell
npm run program:upgrade:check -- --plan upgrade-plan.json --artifact-dir upgrade-artifacts --online --phase after --output after-upgrade.json
```

This verifies retained authority, exact candidate executable bytes, zero padding,
capacity and a deployment slot later than the pinned baseline. It records the new
full ProgramData hash for the normal release admission review. Update approved
release hashes, IDLs, clients and workers together; verify state/balance deltas
and the approved canary before resuming financial writes.
For Mainnet admission, also retain the existing independent two-RPC candidate
observation in `scripts/mainnet-candidate-observation.mjs`; this single-RPC
upgrade check supplements it and does not replace that release gate.

## Interpret results

- `local-only`: local hashes and interfaces passed; on-chain state was not read.
- `preflight-passed`: the pinned baseline, authority and capacity also matched a
  finalized read. This is not approval to deploy or proof of semantic safety.
- `post-upgrade-bytes-verified`: candidate bytes and retained authority matched a
  later finalized deployment. Financial behavior and state preservation still
  require their execution evidence.
- `blocked`: a compatibility or chain check failed. Invalid inputs/RPC failures
  also exit nonzero. There is no force/bypass flag.

Every report keeps `ready: false` and `deploymentAuthorized: false`. Exit zero
only means the requested checks passed; offline success is never chain evidence.
Reports use new output files and refuse to overwrite existing evidence.

Intentional breaking changes remain possible through separately reviewed
migration code or a versioned interface. This checker deliberately does not
approve them automatically. Existing code also ties unpause, guardian/cap
configuration, operator rotation and price-signer changes to the upgrade owner.
Do not revoke that authority without first redesigning those controls.

The [2026-11-25 Devnet rehearsal](devnet-program-upgrade-2026-11-25.md)
records two finalized code upgrades, coordinated app/worker/signer commitments,
and a primary-token switch and restore on the separate configurable program.
Its exact binaries and finalized ProgramData are retained as future baselines.
An application-only rollback after a code upgrade keeps a stale program hash;
coordinate the rollback binary, new finalized hash and every runtime consumer.

References: [Solana program deployment](https://solana.com/docs/core/programs/program-deployment),
[Anchor IDLs](https://www.anchor-lang.com/docs/basics/idl),
[finalized multi-account reads](https://solana.com/docs/rpc/http/getmultipleaccounts).
