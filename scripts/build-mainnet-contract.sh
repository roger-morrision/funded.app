#!/usr/bin/env bash
set -euo pipefail

# Build only. No wallet loading, RPC calls, deployment or authority changes.
# Set FUNDED_MAINNET_PROGRAM_ID to the public address selected for the release.
: "${FUNDED_MAINNET_PROGRAM_ID:?Set the dedicated Mainnet program public key}"
: "${CARGO_BUILD_SBF:?Set the path to the pinned Agave 4.1.2 cargo-build-sbf}"
tool_version="$("$CARGO_BUILD_SBF" --version)"
# The checksum-verified Agave 4.1.2 archive ships cargo-build-sbf 4.1.0.
if [[ "$tool_version" != $'cargo-build-sbf 4.1.0\nplatform-tools v1.54\n'* ]]; then
  echo 'Unexpected SBF compiler. Use the reviewed Agave archive and platform-tools v1.54.' >&2
  exit 1
fi
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
output_dir="${1:?Provide a fresh artifact output directory}"
if [[ -e "$output_dir/funded_fee_router.so" ]]; then
  echo 'Refusing to overwrite an existing candidate.' >&2
  exit 1
fi
export CARGO_BUILD_JOBS="${CARGO_BUILD_JOBS:-2}"
export CARGO_PROFILE_RELEASE_OPT_LEVEL=z
export CARGO_PROFILE_RELEASE_STRIP=true
"$CARGO_BUILD_SBF" --manifest-path "$repo_root/contracts/funded-fee-router/programs/funded-fee-router/Cargo.toml" \
  --features mainnet-v3-program --arch v0 --tools-version v1.54 --no-rustup-override \
  --sbf-out-dir "$output_dir" -- --locked
sha256sum "$output_dir/funded_fee_router.so" > "$output_dir/bytecode.sha256"
wc -c "$output_dir/funded_fee_router.so" > "$output_dir/bytecode-size.txt"
printf '%s\n' "$FUNDED_MAINNET_PROGRAM_ID" > "$output_dir/program-id.txt"
git -C "$repo_root" rev-parse HEAD > "$output_dir/source-revision.txt"
git -C "$repo_root" status --porcelain --untracked-files=all > "$output_dir/source-status.txt"
printf '%s\n' "$tool_version" > "$output_dir/toolchain.txt"
echo 'Built candidate only. Independent review and deployment approval remain required.'
