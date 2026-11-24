# Mainnet security remediation and remaining launch work

The review's authorization and RPC findings are addressed. **Full Mainnet program launch remains NO-GO.** This record is engineering evidence, not independent audit approval or permission to deploy.

## Review findings

- Mainnet referral categories 2–4 require the creator's signature at both approval and payment. The compiled regression verifies operator-only rejection, unchanged rejected state, exact successful balance deltas, and duplicate rejection.
- The non-program RPC policy now decodes legacy and versioned transactions at the proxy, gateway, and failover transport. It rejects protected program and canonical ProgramData accounts anywhere in resolved keys, including CPI accounts and address lookup tables. Missing, malformed, or unavailable lookup evidence fails closed. Ordinary non-program transactions remain supported. This does not create a full-program activation mode.
- The previously identified unused-flag documentation was corrected in `mainnet-nonprogram-site-release.md`.
- The header-repair note does not apply to the production feature: `lib.rs` excludes `repair_header` from both V3 builds. The executed `reward_mainnet_gates` test confirms the Mainnet binary rejects that discriminator with Anchor error 101. No new repair authority or exception was introduced.

## Reproducible candidate and checks

Application revision: `2a8a37a98cbce09d460ff3aad19a67581c108992`.

The production artifact was rebuilt from clean revision `9ada9f8f3c473430f9d3c1d15fe294cb7df2b747`. Its contract tree is identical to the application revision: `4184c08bb6561707b0aca99f2bc8c952834b6adf`. Program identity: `ExUNAWehW776wp6Aw8noYkuGDMvgdHYKdk7jGm6PXghZ`. ELF: **1,110,672 bytes**, SHA-256 `b2e811357cf55dc6624a48b6f630eb6c32ae2c23f3bd6c271d6013c72db70b9c`.

`config/mainnet-review-candidate.json` records the candidate separately from deployment approval. CI checks the contract tree, binary, compiler, build settings, conversion pools, selected program, lockfile, and actual build revision/tree. Historical review records and the deployed Devnet trust commitment remain unchanged.

- [Application CI](https://github.com/roger-morrision/funded.app/actions/runs/45341367730): passed, including container checks.
- [Contract CI](https://github.com/roger-morrision/funded.app/actions/runs/45339137899): passed, including reproduction and buyback/conversion/agency CPI checks.
- Exact production-identity bytecode: **27 VM tests passed**.
- Recovery/readiness: **476 cases passed** across the full Linux run (466 passing cases) and the ten-case filesystem-durability rerun. The latter uses an explicit native Linux test directory. These use synthetic financial RPC, public captured artifacts, in-memory test signatures, and temporary journals; they are not live Mainnet acceptance.
- Security inventory: **36 required cases passed**; the final ProgramData hardening also passed its focused seven-case suite and final application CI.
- Syntax and source-size checks passed. Original unrelated working-tree edits were preserved byte-for-byte.

Local public artifact and logs: `tmp/remaining-issues-20261124/production-9ada9f8f/` and its parent directory. The [machine-readable record](evidence/mainnet-remediation-2026-11-24.json) retains log hashes and excludes failed environment-setup attempts from passing evidence.

## Devnet delivery

Revision `2a8a37a9` was deployed to `https://funded.vip`. All six application/worker/signer services verified the new image and revision and reported healthy. Resolved configuration comparison preserved secret references, policies, data volumes, networks and infrastructure images. Rollback is available. Image: `sha256:4a69d8d7f38400e4f523c0fc17772c81494b22e73cd95864a28eaba958597f66`.

The existing `richpad.fun` non-program site was not redeployed in this task. No Mainnet program was deployed, and no new Mainnet signing or transaction-submission capability was enabled.

## Remaining launch work

The Mainnet launch client and registration still reject submission. Production collection, signer/payout runtime wiring, and current-release end-to-end financial acceptance remain unfinished. Passing the suites above does not remove those source-level gates.

The production inventory still lacks `deploymentPayerSignerReference`, `metadataSecretPath`, and `feeRecipient`. Supply public addresses and configuration/secret-file references only. A named independent reviewer must approve the exact final integrated source and binary; the earlier Claude report explicitly does not constitute that approval. A follow-up Claude review could not be submitted because desktop input timed out.

The read-only rent quote at finalized Mainnet slot **473245080** is **5.64392572 SOL** locked rent for this exact ELF. Base fees are estimated, not final-message quotes; initialization, liquidity, canary, and operating reserves are separate. The previously removed aggregate deployment cap remains removed. No Mainnet transaction was sent. Final funding and a specific capped canary still require approval.

The accepted same-host backup arrangement remains accepted. Missing historical Devnet eligibility data remains outside the fresh isolated Mainnet installation and is not presented as verified or silently imported.
