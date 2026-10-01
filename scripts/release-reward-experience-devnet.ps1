param(
  [ValidateSet('build', 'deploy')]
  [string]$Action = 'build'
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$files = @(
  'compose.preview.yml',
  'compose.funded-vip.yml',
  'compose.creator-devnet.yml',
  'compose.reward-worker.yml',
  'compose.fee-collector.yml',
  'compose.receipt-worker.yml',
  'compose.buyback-worker.yml',
  'compose.devnet-retest.yml',
  'compose.devnet-public-qa-final.yml',
  'compose.community-claim-worker.yml',
  'compose.reward-experience-devnet.yml'
)

Push-Location $repoRoot
try {
  foreach ($path in @($files + @('.env.deploy', '.env.x', '.secrets/database-url-retest-20260929'))) {
    if (-not (Test-Path -LiteralPath $path)) { throw "Required Devnet release input is missing: $path" }
  }
  $composeArgs = @('--profile', 'automatic-rewards', '--env-file', '.env.deploy', '--env-file', '.env.x', '-p', 'fundedapp')
  foreach ($path in $files) { $composeArgs += @('-f', $path) }
  & docker compose @composeArgs config --quiet
  if ($LASTEXITCODE -ne 0) { throw 'Devnet Compose configuration is invalid.' }

  if ($Action -eq 'build') {
    & docker compose @composeArgs build app
    if ($LASTEXITCODE -ne 0) { throw 'Devnet reward image build failed.' }
    Write-Output 'Built fundedapp-app:pump-fee-recovery-v1-20261001; the running container was not changed.'
  } else {
    & docker compose @composeArgs up -d --no-deps --no-build app
    if ($LASTEXITCODE -ne 0) { throw 'Devnet app-only deployment failed.' }
    Write-Output 'Deployed the reward experience image to the Devnet app service; verify health and APIs before announcing it.'
  }
} finally {
  Pop-Location
}
