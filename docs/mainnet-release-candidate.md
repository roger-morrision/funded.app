# Building a Mainnet review candidate

The candidate builder requires a clean committed checkout, a fresh output
directory, the pinned compiler and an explicit conversion-pool selection.
An omitted `FUNDED_MAINNET_CONVERSION_POOLS` is rejected. An explicitly empty
value builds a conversion-disabled candidate and cannot satisfy the full paired
conversion release. The selected public pair is recorded in
`docs/evidence/production-contract-handoff-2026-11-22.json` under
`productionArtifact.conversionPools`; it is a build input, not permission to sign.

From a clean Linux checkout with the checksum-verified Agave 4.1.2 toolchain:

```sh
export CARGO_BUILD_SBF=/path/to/agave-4.1.2/solana-release/bin/cargo-build-sbf
export FUNDED_MAINNET_PROGRAM_ID=ExUNAWehW776wp6Aw8noYkuGDMvgdHYKdk7jGm6PXghZ
export FUNDED_MAINNET_CONVERSION_POOLS=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v:Gf7sXMoP8iRw4iiXmJ1nq4vxcRycbGXy5RL8a8LnTd3v
bash scripts/build-mainnet-contract.sh /path/to/new-candidate
```

The command records the exact source revision/tree, clean-source result,
compiler and lockfile hashes, feature/optimization settings, public program ID,
conversion bindings, ELF size and SHA-256. Unreviewed Rust flag overrides,
existing output directories and source changes during compilation fail the build.
The output directory must be outside the checkout or in a Git-ignored location.
These guards do not replace an independent rebuild, byte comparison or review.
CI checks the packaging guards with a fake compiler; that check is explicitly
separate from compiled-bytecode VM acceptance.

## Remaining release dependencies

The integrated source and passing application/contract CI do not resolve:

- Full holder-scale acceptance; the runtime still admits at most 1,000 holders.
- Authenticated historical community bank input and configured-program 28/28
  live claim delivery. A recreated root cannot establish missing bank provenance.
- Independent durable conversion-attempt storage and verified no-loss restore.
  Three mutually consistent journal files cannot rule out coherent rollback.
- Reviewed production service/custody configuration and full configurable-router
  application integration.
- An independent review of the exact integrated source and binary, final
  initialization/message inventory and funding quote.
- Current-release financial acceptance and an approved Mainnet canary.

`config/mainnet-program-release.json` intentionally retains null review and
deployed ProgramData fields. A selected program ID or successful build must not
fill those fields with invented deployment or review evidence. The selected
public identities, private infrastructure references and remaining funding inputs
are tracked in `config/mainnet-deployment-plan.json`.
