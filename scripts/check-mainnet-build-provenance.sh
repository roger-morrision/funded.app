#!/usr/bin/env bash
set -euo pipefail
# Exercises packaging guards with a fake compiler, not bytecode acceptance.
source_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
fixture="$(mktemp -d -t funded-build-provenance.XXXXXXXX)"
trap 'rm -rf -- "$fixture"' EXIT
repo="$fixture/repo"
mkdir -p "$repo/scripts" "$repo/contracts/funded-fee-router"
cp "$source_root/scripts/build-mainnet-contract.sh" "$repo/scripts/"
printf 'fixture lockfile\n' > "$repo/contracts/funded-fee-router/Cargo.lock"
git -C "$repo" init -q
git -C "$repo" config core.hooksPath /dev/null
git -C "$repo" add .
git -C "$repo" -c user.name=Fixture -c user.email=fixture@example.invalid commit -qm fixture
cat > "$fixture/compiler" <<'COMPILER'
#!/usr/bin/env bash
set -euo pipefail
if [[ "$1" == --version ]]; then
  printf 'cargo-build-sbf 4.1.0\nplatform-tools v1.54\nrustc fixture\n'
  exit
fi
while [[ $# -gt 0 ]]; do
  if [[ "$1" == --sbf-out-dir ]]; then out="$2"; shift; fi
  shift
done
mkdir -p "$out"
printf 'fixture ELF\n' > "$out/funded_fee_router.so"
if [[ -n "${MUTATE_SOURCE:-}" ]]; then printf 'changed\n' >> "$MUTATE_SOURCE"; fi
COMPILER
chmod +x "$fixture/compiler"
export CARGO_BUILD_SBF="$fixture/compiler"
export FUNDED_MAINNET_PROGRAM_ID=ExUNAWehW776wp6Aw8noYkuGDMvgdHYKdk7jGm6PXghZ
unset RUSTFLAGS CARGO_ENCODED_RUSTFLAGS FUNDED_MAINNET_CONVERSION_POOLS
build() { bash "$repo/scripts/build-mainnet-contract.sh" "$@"; }
reject() {
  local label="$1"; shift
  if build "$fixture/$label" > "$fixture/result" 2>&1; then
    echo "Unexpected build acceptance: $label" >&2; exit 1
  fi
  grep -Fq "$1" "$fixture/result"
  [[ ! -e "$fixture/$label/source-revision.txt" ]]
  echo "Rejected: $label"
}
reject missing-pools 'Set FUNDED_MAINNET_CONVERSION_POOLS explicitly'
export FUNDED_MAINNET_CONVERSION_POOLS=''
export RUSTFLAGS='--cfg unexpected'
reject compiler-override 'Unexpected RUSTFLAGS override'
unset RUSTFLAGS
printf 'untracked\n' > "$repo/untracked"
reject untracked-source 'clean committed checkout'
rm "$repo/untracked"
printf 'dirty\n' >> "$repo/contracts/funded-fee-router/Cargo.lock"
reject dirty-source 'clean committed checkout'
git -C "$repo" restore contracts/funded-fee-router/Cargo.lock
mkdir "$fixture/existing"
reject existing 'Refusing to reuse'
export MUTATE_SOURCE="$repo/contracts/funded-fee-router/Cargo.lock"
reject concurrent-edit 'Source changed during the build'
unset MUTATE_SOURCE
git -C "$repo" restore contracts/funded-fee-router/Cargo.lock
build "$fixture/explicit-empty" > "$fixture/result"
[[ "$(cat "$fixture/explicit-empty/conversion-pools.txt")" == '' ]]
export FUNDED_MAINNET_CONVERSION_POOLS='explicit-reviewed-pair:explicit-reviewed-pool'
build "$fixture/explicit-pools" > "$fixture/result"
[[ "$(cat "$fixture/explicit-pools/conversion-pools.txt")" == "$FUNDED_MAINNET_CONVERSION_POOLS" ]]
[[ "$(cat "$fixture/explicit-pools/source-revision.txt")" == "$(git -C "$repo" rev-parse HEAD)" ]]
[[ "$(cat "$fixture/explicit-pools/source-tree.txt")" == "$(git -C "$repo" rev-parse 'HEAD^{tree}')" ]]
[[ ! -s "$fixture/explicit-pools/source-status.txt" ]]
sha256sum --check "$fixture/explicit-pools/bytecode.sha256"
sha256sum --check "$fixture/explicit-pools/compiler.sha256"
sha256sum --check "$fixture/explicit-pools/lockfile.sha256"
echo 'Passed: eight build-provenance cases (fake compiler; no deployment).'
