#!/usr/bin/env bash
set -euo pipefail
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
guard_dir="$(mktemp -d)"
trap 'rm -f "$guard_dir/guard" "$guard_dir/result" "$guard_dir/mainnet_id.rs" "$guard_dir/mainnet_assets.rs"; rmdir "$guard_dir"' EXIT
rustc --edition=2021 "$repo_root/contracts/funded-fee-router/programs/funded-fee-router/build.rs" -o "$guard_dir/guard"
expect_failure() {
  local label="$1"; shift
  if env -i OUT_DIR="$guard_dir" "$@" "$guard_dir/guard" > "$guard_dir/result" 2>&1; then
    echo "Build guard unexpectedly accepted: $label" >&2; exit 1
  fi
  echo "Rejected: $label"
}
expect_failure missing-identity CARGO_FEATURE_MAINNET_V3_PROGRAM=1
expect_failure conflicting-networks CARGO_FEATURE_MAINNET_V3_PROGRAM=1 CARGO_FEATURE_DEVNET_V3_PROGRAM=1
expect_failure qa-recovery CARGO_FEATURE_MAINNET_V3_PROGRAM=1 CARGO_FEATURE_HISTORICAL_QA_RECOVERY=1
expect_failure devnet-identity CARGO_FEATURE_MAINNET_V3_PROGRAM=1 FUNDED_MAINNET_PROGRAM_ID=9H1r2nTZs6gQaheYTMaBWpH12JX6dCFj2Rvxg7Lno2Sm
expect_failure system-program CARGO_FEATURE_MAINNET_V3_PROGRAM=1 FUNDED_MAINNET_PROGRAM_ID=11111111111111111111111111111111
expect_failure source-injection CARGO_FEATURE_MAINNET_V3_PROGRAM=1 'FUNDED_MAINNET_PROGRAM_ID="); panic!("invalid'
fixture=(CARGO_FEATURE_MAINNET_V3_PROGRAM=1
  FUNDED_MAINNET_PROGRAM_ID=3qbR1eZRqXUWroWKKYhbDmR3FfqTHfqSU8zZSxtANzYh
  FUNDED_MAINNET_FUNDED_MINT=3uWi9x2SRpmjztkpkr2WWeBoVq3exjXG2YfDWLvm8KsQ
  FUNDED_MAINNET_FUNDED_POOL=3yS1JFVT284y8z1LC9MRoWxZjzFrdoD5axKsZiyMsfC7)
expect_failure missing-mint "${fixture[@]}" FUNDED_MAINNET_FUNDED_MINT=
expect_failure missing-pool "${fixture[@]}" FUNDED_MAINNET_FUNDED_POOL=
expect_failure devnet-mint "${fixture[@]}" FUNDED_MAINNET_FUNDED_MINT=C5JFX2W3YtLDmiZeUTcYjfLqXPWmW2GZZC5fbxv7ut64
expect_failure devnet-pool "${fixture[@]}" FUNDED_MAINNET_FUNDED_POOL=EKKUWqwbZKeq4hdth8kdYuHZBtvxDCu3kZahHATbba32
expect_failure wrong-decoded-length "${fixture[@]}" FUNDED_MAINNET_FUNDED_MINT=22222222222222222222222222222222
expect_failure identical-assets "${fixture[@]}" FUNDED_MAINNET_FUNDED_POOL=3uWi9x2SRpmjztkpkr2WWeBoVq3exjXG2YfDWLvm8KsQ
expect_failure program-as-mint "${fixture[@]}" FUNDED_MAINNET_FUNDED_MINT=3qbR1eZRqXUWroWKKYhbDmR3FfqTHfqSU8zZSxtANzYh
expect_failure asset-source-injection "${fixture[@]}" 'FUNDED_MAINNET_FUNDED_MINT="; panic!("invalid'
env -i OUT_DIR="$guard_dir" CARGO_FEATURE_MAINNET_V3_PROGRAM=1 \
  "${fixture[@]}" "$guard_dir/guard" > "$guard_dir/result"
test -s "$guard_dir/mainnet_id.rs"
test -s "$guard_dir/mainnet_assets.rs"
grep -q '3uWi9x2SRpmjztkpkr2WWeBoVq3exjXG2YfDWLvm8KsQ' "$guard_dir/mainnet_assets.rs"
grep -q '3yS1JFVT284y8z1LC9MRoWxZjzFrdoD5axKsZiyMsfC7' "$guard_dir/mainnet_assets.rs"
echo 'Accepted explicit test identities; fourteen invalid configurations rejected.'
