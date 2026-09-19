#requires -Version 5.1
[CmdletBinding()]
param(
  [switch]$InstallWsl,
  [switch]$InstallToolchain,
  [switch]$PrepareDevnet
)

$ErrorActionPreference = 'Stop'

function Assert-Administrator {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = [Security.Principal.WindowsPrincipal]::new($identity)
  if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Run this script from an elevated PowerShell window.'
  }
}

function Invoke-WslBash([string]$Command, [switch]$AsRoot) {
  $previousErrorAction = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  if ($AsRoot) { & wsl.exe -d Ubuntu -u root -- bash -lc $Command }
  else { & wsl.exe -d Ubuntu -- bash -lc $Command }
  $exitCode = $LASTEXITCODE
  $ErrorActionPreference = $previousErrorAction
  if ($exitCode -ne 0) { throw "WSL command failed with exit code $exitCode." }
}

Assert-Administrator

$wslReady = $false
try {
  $distros = (& wsl.exe -l -q 2>$null | Out-String) -replace "`0", ''
  $wslReady = ($LASTEXITCODE -eq 0 -and $distros -match '(?im)^\s*Ubuntu\s*$')
} catch { $wslReady = $false }

if ($InstallWsl -and -not $wslReady) {
  Write-Host 'Installing WSL and Ubuntu. Windows may require a restart.' -ForegroundColor Yellow
  & wsl.exe --install -d Ubuntu
  if ($LASTEXITCODE -ne 0) { throw "WSL installation failed with exit code $LASTEXITCODE." }
  Write-Host 'WSL installation requested. Restart Windows, finish the Ubuntu first-run user setup, then rerun with -InstallToolchain -PrepareDevnet.' -ForegroundColor Green
  exit 0
}

if ($InstallToolchain -or $PrepareDevnet) {
  if (-not $wslReady) { throw 'Ubuntu WSL is not available. Run with -InstallWsl from an elevated PowerShell window first.' }
}

if ($InstallToolchain) {
  Write-Host 'Installing Rust, Solana CLI, Anchor CLI, and build dependencies inside Ubuntu…' -ForegroundColor Cyan
  $toolchainCommand = @'
set -euo pipefail
apt-get update
DEBIAN_FRONTEND=noninteractive apt-get install -y build-essential pkg-config libssl-dev libudev-dev libclang-dev curl git unzip
if ! command -v rustc >/dev/null 2>&1; then curl --proto "=https" --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y; fi
if [ -f "$HOME/.cargo/env" ]; then source "$HOME/.cargo/env"; fi
if ! command -v solana >/dev/null 2>&1; then curl --proto "=https" --tlsv1.2 -sSfL https://release.anza.xyz/stable/install -o /tmp/solana-install.sh; bash /tmp/solana-install.sh; fi
export PATH="/root/.local/share/solana/install/active_release/bin:/root/.cargo/bin:$PATH"
if ! command -v anchor >/dev/null 2>&1; then cargo install --git https://github.com/solana-foundation/anchor --locked --tag v1.0.0 anchor-cli; fi
rustc --version; /root/.local/share/solana/install/active_release/bin/solana --version; /root/.cargo/bin/anchor --version
'@
  Invoke-WslBash -AsRoot $toolchainCommand
}

if ($PrepareDevnet) {
  Write-Host 'Configuring Solana CLI for Devnet without changing an existing signer…' -ForegroundColor Cyan
  $devnetCommand = @'
set -euo pipefail
source "$HOME/.cargo/env" 2>/dev/null || true
export PATH="/root/.local/share/solana/install/active_release/bin:/root/.cargo/bin:$PATH"
if [ ! -f "/root/.config/solana/id.json" ]; then mkdir -p "/root/.config/solana"; /root/.local/share/solana/install/active_release/bin/solana-keygen new --no-bip39-passphrase --outfile "/root/.config/solana/id.json"; chmod 600 "/root/.config/solana/id.json"; fi
/root/.local/share/solana/install/active_release/bin/solana config set --url https://api.devnet.solana.com --keypair "/root/.config/solana/id.json"
echo "Devnet deployer signer: $(/root/.local/share/solana/install/active_release/bin/solana address --keypair "/root/.config/solana/id.json")"
/root/.local/share/solana/install/active_release/bin/solana config get
'@
  Invoke-WslBash -AsRoot $devnetCommand
}

Write-Host 'Solana Devnet bootstrap completed.' -ForegroundColor Green
