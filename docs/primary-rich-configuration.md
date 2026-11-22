# Primary RICH configuration and payout policy

Implemented in the Mainnet-feature candidate on 22 November 2026. This is not a live deployment or Mainnet approval. Existing deployments need one program upgrade to obtain these instructions; a fresh deployment can include them from the start. Later mint/market changes require an owner-signed configuration transaction, not another program upgrade. An immutable deployment without this instruction cannot gain it.

## Changing the mint or market

The current configuration PDA uses `rich-assets-v1` under the router program. It contains the mint, token program, supported market, venue, increasing revision, administrator and pending administrator (177 bytes including the discriminator). The upgrade owner bootstraps revision 1. Later updates require the separately stored RICH administrator, even if the program upgrade authority changes or becomes immutable. Automated server signers refuse configuration and administrator-transfer instructions. Use the governance wallet or multisig that holds the RICH administrator role.

The account at `rich-assets-revision-v1` plus the little-endian revision is an immutable historical record. Every update creates one record. The update must specify exactly the current revision plus one. Concurrent updates cannot silently overwrite each other.

Supported markets are a PumpSwap pool whose base is RICH and quote is native SOL, or RICH's canonical, incomplete Pump SOL bonding curve. Program owner, account discriminator, mint, quote and unsupported market flags are validated on-chain. Arbitrary Raydium/Meteora pools or non-SOL Pump quotes are not accepted. The independently verified liquidity, slippage, buyback budget and burn checks still apply during execution.

After production identities and the exact binary have passed release review:

```powershell
node scripts/prepare-rich-assets.mjs --rpc <MAINNET_RPC> --owner <RICH_ADMIN_PUBLIC_KEY> --mint <RICH_MINT> --market <SOL_POOL_OR_CURVE> --venue pool
```

Use `--venue curve` for a canonical Pump bonding curve. This tool verifies the approved network and deployed program, reads the current revision, and outputs an **unsigned** transaction with old/new addresses and revision. It never loads a secret key or broadcasts. Its blockhash expires; prepare it immediately before the owner wallet signs. The shared `buildConfigureRichAssets` function in `rich-assets.js` can also be used by a wallet or multisig integration. The owner funds transaction fees and the new configuration-history account's rent.

After the owner submits it, wait for finalization and read both the current and new history PDAs. Confirm their mint, market, token program and revision match the requested change. A submitted signature alone is not verification. The first configuration must be initialized before any configured Mainnet buyback can execute.

Changing from a bonding curve to its migrated pool also requires an owner update and a new revision. While the configured curve is complete, quotes fail closed until the supported SOL pool is selected. To roll back, create another revision with the earlier addresses; never reuse an old revision.

## Administrator handoff and contract inventory

Call `propose_rich_authority` from the current administrator, then `accept_rich_authority` from the nominated successor. Proposing the current administrator cancels a pending transfer; the zero address is rejected. Until acceptance, the old administrator remains in control. After acceptance, its mint-update authority is revoked. Handoffs do not rewrite asset revisions or historical receipts.

The unsigned preparation tool also supports `--action propose --successor <PUBLIC_KEY>` and `--action accept`, using `--owner` for the signing administrator/successor. Shared wallet builders are `buildProposeRichAuthority` and `buildAcceptRichAuthority`. Re-read current administrator, pending administrator and assets after finalization. No private keys are loaded by the tool.

The contract-level independence of RICH administration does **not** recommend making the whole protocol immutable: guard recovery still uses the upgrade owner, and runtime trust pins the loader authority and full ProgramData hash. Any code-authority change needs its own reviewed operational release before automated trading resumes.

- Mainnet merged V3 router: `mainnet-v3-program` includes `configurable-rich-assets`; both protected and agency RICH buybacks use this configuration. Old buyback entrypoints are absent.
- Existing Devnet router: a separately built `devnet-v3-program,configurable-rich-assets` upgrade candidate provides the same administration and removes the old buyback ABI. It is tested but not deployed or activated. Current app/signer Devnet defaults still target the preserved legacy release; a coordinated client/signer release is required before upgrading that deployment.
- Standalone legacy router and developer-token-lock: no compiled global RICH address to replace. Escrow locks, reward cycles and community drops record their own asset; their existing liabilities must stay tied to that asset. The production plan uses the merged program, so a second escrow deployment is unnecessary.

The prior 113-byte configuration was an undeployed candidate. This revision uses 177 bytes; no deployed account migration is claimed. If an out-of-band deployment initialized the earlier candidate, it requires an explicit reviewed migration before this binary is installed.

## Pending orders and existing obligations

- Mainnet buyback instructions include the configuration revision in the signed bytes. The router rejects a stale revision even if the mint later changes back to the same address. Legacy buyback entrypoints are absent from the Mainnet build.
- The independent reviewer fetches its own finalized configuration. Client-supplied mint/pool values cannot override it. Historical receipt verification reads the immutable revision used by the finalized transaction.
- Existing reward cycles, community drops and developer escrows retain their recorded asset and entitlement. Changing the primary mint does not convert balances, replace old tokens or rewrite claims. Future Mainnet reward-worker activation must use the current primary-asset reader for new eligibility snapshots; those workers remain deployment-gated.
- Once the reviewed on-chain release is activated, the app reads `/api/token-config` at page startup. New pricing and listing/launch quotes use the current configuration; pricing caches are keyed by revision. Reload an already-open page after rotation. An unavailable activated configuration disables RICH actions rather than falling back to the old environment mint.
- Stored listing/launch quotes keep their original mint for verification of time-bounded, already-paid receipts. Unrelated tokens and historical fee records are not relabeled as the new RICH.

The release manifest's `fundedMint` and `fundedPool` identify initial production assets for release review. They do not override later on-chain revisions. `assetConfiguration: "onchain-v1"` prevents a legacy binary/reviewer configuration from being treated as compatible.

## Payout limits

Verified creator, X and referral disbursements, reward-vault funding, reward commitments and user reward payouts do not consume an arbitrary shared daily SOL cap. Entitlement checks, reserve solvency, immutable recipients, proof verification, replay protection and the protocol pause remain. New Mainnet reward cycles retain the 24-hour guardian review delay.

Operations withdrawals, agency promotions and buybacks still share the administrative SOL spending cap. The independent buyback signer also retains its own order and daily limits. A guardian can pause; only the upgrade owner can unpause or change the cap.

User payouts use the global guard read-only, avoiding an unnecessary global write lock. This is not a throughput certification for a million users: per-vault/cycle contention, transaction costs, RPC capacity and load testing still matter.

## Verification and remaining release gates

Local compiled-bytecode tests cover owner authorization and rotation, forged loader data, immutable history, invalid mint/market/quote/venue, stale revisions including switch-back, uncapped user commitments/payouts, overcommit rejection, pause, replay, and retained administrative caps. Fixtures use synthetic balances and ephemeral keys; no production transaction is implied.

Production identity, supported liquidity, independent review, budget, operational infrastructure and current end-to-end financial acceptance remain required. See [the security review](mainnet-contract-review-2026-11-22.md). The test mint supplied by the user has not been installed as a production asset.
