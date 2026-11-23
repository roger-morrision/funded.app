#!/usr/bin/env bash
set -euo pipefail

# Build only. No wallet loading, RPC calls, deployment or authority changes.
# Set FUNDED_MAINNET_PROGRAM_ID to the public address selected for the release.
: "${FUNDED_MAINNET_PROGRAM_ID:?Set the dedicated Mainnet program public key}"
: "${CARGO_BUILD_SBF:?Set the path to the pinned Agave 4.1.2 cargo-build-sbf}"
if [[ ! -v FUNDED_MAINNET_CONVERSION_POOLS ]]; then
  echo 'Set FUNDED_MAINNET_CONVERSION_POOLS explicitly (empty disables conversions).' >&2
  exit 1
fi
for override in RUSTFLAGS CARGO_ENCODED_RUSTFLAGS; do
  if [[ -n "${!override:-}" ]]; then
    echo "Unexpected $override override; use the pinned release build." >&2
    exit 1
  fi
done
tool_version="$("$CARGO_BUILD_SBF" --version)"
# The checksum-verified Agave 4.1.2 archive ships cargo-build-sbf 4.1.0.
if [[ "$tool_version" != $'cargo-build-sbf 4.1.0\nplatform-tools v1.54\n'* ]]; then
  echo 'Unexpected SBF compiler. Use the reviewed Agave archive and platform-tools v1.54.' >&2
  exit 1
fi
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source_revision="$(git -C "$repo_root" rev-parse HEAD)"
source_tree="$(git -C "$repo_root" rev-parse 'HEAD^{tree}')"
if [[ -n "$(git -C "$repo_root" status --porcelain --untracked-files=all)" ]]; then
  echo 'Release candidates require a clean committed checkout.' >&2
  exit 1
fi
output_dir="${1:?Provide a fresh artifact output directory}"
if [[ -e "$output_dir" || -L "$output_dir" ]]; then
  echo 'Refusing to reuse an existing candidate directory.' >&2
  exit 1
fi
export CARGO_BUILD_JOBS="${CARGO_BUILD_JOBS:-2}"
export CARGO_PROFILE_RELEASE_OPT_LEVEL=z
export CARGO_PROFILE_RELEASE_STRIP=true
"$CARGO_BUILD_SBF" --manifest-path "$repo_root/contracts/funded-fee-router/programs/funded-fee-router/Cargo.toml" \
  --features mainnet-v3-program --arch v0 --tools-version v1.54 --no-rustup-override \
  --sbf-out-dir "$output_dir" -- --locked
if [[ "$(git -C "$repo_root" rev-parse HEAD)" != "$source_revision" \
  || -n "$(git -C "$repo_root" status --porcelain --untracked-files=all)" ]]; then
  echo 'Source changed during the build; discard this candidate and rebuild.' >&2
  exit 1
fi
sha256sum "$output_dir/funded_fee_router.so" > "$output_dir/bytecode.sha256"
wc -c "$output_dir/funded_fee_router.so" > "$output_dir/bytecode-size.txt"
printf '%s\n' "$FUNDED_MAINNET_PROGRAM_ID" > "$output_dir/program-id.txt"
printf '%s\n' "$FUNDED_MAINNET_CONVERSION_POOLS" > "$output_dir/conversion-pools.txt"
printf '%s\n' "$source_revision" > "$output_dir/source-revision.txt"
printf '%s\n' "$source_tree" > "$output_dir/source-tree.txt"
: > "$output_dir/source-status.txt"
printf '%s\n' "$tool_version" > "$output_dir/toolchain.txt"
sha256sum "$CARGO_BUILD_SBF" > "$output_dir/compiler.sha256"
sha256sum "$repo_root/contracts/funded-fee-router/Cargo.lock" > "$output_dir/lockfile.sha256"
printf '%s\n' 'features=mainnet-v3-program' 'arch=v0' 'platform-tools=v1.54' \
  'opt-level=z' 'strip=true' 'locked=true' > "$output_dir/build-settings.txt"
echo 'Built candidate only. Independent review and deployment approval remain required.'
