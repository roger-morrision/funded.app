// Explicit allowlist: these scripts use pure models, ephemeral signers, or local
// HTTP/RPC fixtures. Live Devnet acceptance scripts belong to a separate run.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const checks = [
  "verify:jackpot-prototype",
  "verify:jackpot-end-to-end",
  "verify:jackpot-flag",
  "verify:jackpot-entries",
  "verify:jackpot-refund",
  "verify:pilot-metrics",
  "verify:referral-scoped-store",
  "verify:launch-accessibility",
  "verify:receipt-retention",
  "verify:following-updates",
  "verify:receipt-worker-status",
  "verify:referral-claim-state",
  "verify:claim-state",
  "verify:receipt-backfill",
  "verify:creator-search",
  "verify:receipt-history",
  "verify:creator-writes",
  "verify:receipt-candidates",
  "verify:receipt-service",
  "verify:phase-completion",
  "verify:x-auth",
  "verify:x-auth-http",
  "verify:launch-matrix",
  "verify:adoption-phases",
  "verify:creator-support",
  "verify:automatic-rewards",
  "verify:reward-contract-source",
  "verify:launch",
  "verify:launch-wizard",
  "verify:devnet-metadata",
  "verify:local-flow",
  "verify:fee-policy",
  "verify:fee-router",
  "verify:mint-router-v2",
  "verify:referral-program",
  "verify:referral-auth",
  "verify:referral-privacy-http",
  "verify:referral-server",
  "verify:referral-paid-replay",
  "verify:airdrop-policy",
  "verify:community-reserve-funding",
  "verify:community-manifest",
  "verify:buyback-policy",
  "verify:buyback-executor",
  "verify:devnet-role-config",
  "verify:rpc-retry",
  "verify:listing-policy",
  "verify:funded-burn",
  "verify:proof-ui",
  "verify:receipt-evidence",
  "verify:coin-detail",
  "verify:backend-hardening",
  "verify:launch-burn-policy",
  "verify:promotion-badges",
  "verify:solana-only",
  "verify:pump-trading",
  "verify:dev-wallet-local-signing",
  "verify:devnet-test-wallet-rotation",
  "verify:wallet-state",
  "verify:sol-claim",
  "verify:x-payout",
  "verify:production-policies",
  "verify:stonk-features",
  "verify:explore-discovery"
];
const { scripts } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const failed = [];
for (const name of checks) {
  const file = scripts[name]?.match(/^node (scripts\/[\w-]+\.mjs)$/)?.[1];
  if (!file) throw new Error(`Local verification command is no longer an isolated Node script: ${name}`);
  const result = spawnSync(process.execPath, [file], {
    cwd: new URL('..', import.meta.url), encoding: 'utf8', timeout: 60_000,
    env: { ...process.env, NODE_ENV: 'test', DATABASE_URL: '' }, maxBuffer: 2 * 1024 * 1024,
  });
  const passed = result.status === 0;
  console.log(`${passed ? 'PASS' : 'FAIL'} ${name}`);
  if (!passed) {
    failed.push(name);
    console.error((result.stdout + result.stderr).slice(-12_000));
    if (result.error) console.error(result.error.message);
  }
}
console.log(JSON.stringify({ passed: checks.length - failed.length, total: checks.length, failed }));
if (failed.length) process.exitCode = 1;
