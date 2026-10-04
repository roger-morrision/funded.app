# Build delivery improvements — 2026-10-04

These measurements describe the local build, not live-site latency or a production capacity benchmark. No deployment or mainnet activation was performed.

## Smaller artwork and release output

The six active wolf artwork files now have lossless WebP versions. Their dimensions and decoded RGBA bytes were compared directly against the original PNGs; all six are identical. HTML, CSS and workspace imports select the optimized versions. Backend HTTP tests verify the WebP content type and cache policy.

| Measurement | Result |
| --- | --- |
| Original six PNGs | 14,562,024 bytes |
| Lossless six WebPs | 10,982,844 bytes |
| Artwork bytes saved | 3,579,180 bytes / 24.58% |
| Unused poster source PNGs omitted per build | 34 files / 55,223,785 bytes |
| Sample complete release directory before its release manifest | 16,546,222 bytes |

The original PNG files remain in the repository for future work. The build omits unused PNG sources from the release's `posters/` directory, retaining referenced originals, dynamic PNG paths and all optimized WebPs. `dist/build-asset-report.json` records the exact omitted files and bytes. All current in-app poster references use WebP. This cuts deployment artifact size from approximately 73 MiB to 16 MiB in the measured builds; it does not imply every page previously downloaded the full artifact.

## Accurate browser build identity

Vite emits `build-settings.json` containing the compiled network flags, whether the local test wallet is enabled, and a digest of browser source/configuration, dependency lockfile and artwork. A manifest now refuses:

- A Mainnet or mismatched Explore build under a Devnet release environment.
- A browser source change after the bundle was built.
- A public release with the server-held test wallet enabled.
- Dirty, synthetic or unrelated Git source identities, as before.

The build also rejects browser source changes during compilation. Final release generation must therefore run after all browser edits finish. API-only source changes still appear in the release's API/worker source hashes without forcing an unrelated browser rebuild.

Vite's API proxy now respects Mainnet read-only settings loaded from environment files, using the same case handling and process-environment precedence as the browser configuration. This closes a discrepancy where only directly exported variables previously disabled the proxy.

## Verification

`npm run verify:build-settings` passes safe defaults, runtime-over-file precedence, file-based read-only settings, network consistency, archival pruning, preservation of referenced PNG/WebP assets, dynamic-path fallback and source-directory protection.

`npm run verify:release-manifest` passes canonical source identity, dirty/synthetic rejection, component identity, schema/source hashing, build network validation and stale-browser rejection. A local manifest attempt after another agent edited browser source was rejected as expected.

A full Vite production build passed after optimization. The existing approximately 532 KB minified application chunk warning remains visible; this change does not claim to complete the larger application/module decomposition. Final whole-app verification and release generation should be run on the final combined source tree.
