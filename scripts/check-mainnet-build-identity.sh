#!/usr/bin/env bash
set -euo pipefail
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
guard_dir="$(mktemp -d)"
trap 'rm -f "$guard_dir/guard" "$guard_dir/result" "$guard_dir/mainnet_id.rs"; rmdir "$guard_dir"' EXIT
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
env -i OUT_DIR="$guard_dir" CARGO_FEATURE_MAINNET_V3_PROGRAM=1 \
  FUNDED_MAINNET_PROGRAM_ID=3qbR1eZRqXUWroWKKYhbDmR3FfqTHfqSU8zZSxtANzYh "$guard_dir/guard" > "$guard_dir/result"
test -s "$guard_dir/mainnet_id.rs"
echo 'Accepted explicit test identity; six invalid configurations rejected.'
