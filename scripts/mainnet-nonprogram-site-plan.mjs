#!/usr/bin/env node
// Produces a reviewable plan. This command never connects to a host or changes a file.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const sha = /^[0-9a-f]{40}$/;
const digest = /^sha256:[0-9a-f]{64}$/;
const sha256 = /^[0-9a-f]{64}$/;
const allowedServices = ['app', 'rpc-gateway', 'db', 'rpc-cache', 'https'];
const mutableServices = ['app', 'rpc-gateway'];
const policyKeys = [
  'FUNDED_MAINNET_NON_PROGRAM_WRITES',
  'FUNDED_MINT_FEE_ROUTER_ENABLED',
  'FUNDED_BUYBACK_EXECUTOR_ENABLED',
  'FUNDED_DAILY_BONUS_ENABLED',
  'FUNDED_DAILY_BONUS_PAYOUT_ENABLED',
  'FUNDED_LAUNCH_POST_EMAIL_ENABLED',
  'FUNDED_API_ONLY',
  'VITE_ALLOW_MAINNET',
  'SOLANA_CLUSTER',
  'VITE_SOLANA_CLUSTER',
  'FUNDED_TOKEN_MINT',
  'VITE_FUNDED_TOKEN_MINT',
  'FUNDED_TRADE_FEE_BPS',
];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

export function makeSitePlan({ current, candidate }) {
  assert(current && candidate, 'current and candidate are required');
  assert(current.project === 'richpad-mainnet' && candidate.project === current.project, 'project mismatch');
  assert(sha.test(current.revision) && sha.test(candidate.revision), 'full revision required');
  assert(candidate.revision !== current.revision, 'candidate must be a new revision');
  assert(digest.test(current.image) && digest.test(candidate.image), 'immutable image digest required');
  assert(current.image !== candidate.image, 'candidate image must differ');
  assert(sha256.test(current.composeSha256) && sha256.test(candidate.composeSha256), 'compose SHA-256 required');
  assert(sha256.test(candidate.frontendSha256), 'candidate frontend SHA-256 required');
  assert(current.genesis === candidate.genesis && typeof current.genesis === 'string' && current.genesis.length > 20, 'genesis mismatch');
  assert(current.cluster === 'mainnet-beta' && candidate.cluster === current.cluster, 'Mainnet cluster required');
  assert(current.activation === false && candidate.activation === false, 'program activation must remain false');
  assert(current.programId === '' && candidate.programId === '', 'nonprogram site cannot set a router program');
  assert(current.fundedPool === '' && candidate.fundedPool === '', 'nonprogram site cannot set a funded pool');
  assert(same(current.services, allowedServices) && same(candidate.services, allowedServices), 'five-service compose inventory changed');
  assert(same(candidate.changedServices, mutableServices), 'only app and rpc-gateway may change');
  assert(current.dependencies && candidate.dependencies, 'dependency image identities required');
  for (const service of ['db', 'rpc-cache', 'https']) {
    assert(digest.test(current.dependencies[service]), `current ${service} image digest missing`);
    assert(candidate.dependencies[service] === current.dependencies[service], `${service} image changed`);
  }
  assert(current.policy && candidate.policy, 'public policy inventory required');
  for (const key of policyKeys) {
    assert(typeof current.policy[key] === 'string' && candidate.policy[key] === current.policy[key], `${key} changed or missing`);
  }
  assert(current.policy.FUNDED_MAINNET_NON_PROGRAM_WRITES === 'true', 'existing nonprogram policy mismatch');
  assert(current.policy.FUNDED_MINT_FEE_ROUTER_ENABLED === 'false', 'fee router must remain disabled');
  assert(current.policy.FUNDED_BUYBACK_EXECUTOR_ENABLED === 'false', 'buyback must remain disabled');
  assert(candidate.fundedMint === current.fundedMint && candidate.fundedMint === current.policy.FUNDED_TOKEN_MINT, 'funded mint changed');
  assert(candidate.tradeFeeRecipient === current.tradeFeeRecipient && typeof current.tradeFeeRecipient === 'string', 'trade fee recipient changed');
  assert(candidate.tradeFeeBps === current.tradeFeeBps && String(current.tradeFeeBps) === current.policy.FUNDED_TRADE_FEE_BPS, 'trade fee rate changed');
  assert(candidate.composeSha256 !== current.composeSha256, 'candidate compose must have a new reviewed digest');
  return {
    kind: 'nonprogram-site-only-dry-run',
    executable: false,
    current: { revision: current.revision, image: current.image, composeSha256: current.composeSha256 },
    candidate: { revision: candidate.revision, image: candidate.image, composeSha256: candidate.composeSha256, frontendSha256: candidate.frontendSha256 },
    allowedSwitchServices: mutableServices,
    retainedServices: ['db', 'rpc-cache', 'https'],
    checks: [
      'Re-read remote revision, image IDs, compose SHA-256, genesis, public identity, policy and five service health immediately before switch; abort on any mismatch.',
      'Retain the old image and compose, database and volume backups, and all secrets. Never prune, recreate dependencies or upload secret files.',
      'Stage the full candidate Git source and build an immutable image separately; verify revision label, image digest and frontend manifest against this packet.',
      'Review the candidate compose diff: only app and rpc-gateway image/build IDs may change; preserve mounts, environment, policies, ports, dependencies and secret references.',
      'Switch only app and rpc-gateway with Compose --no-deps --no-build --pull never under an exclusive release lock. Do not ignore Compose errors.',
      'Check both containers healthy and verify public HTTPS build revision, frontend SHA-256, cluster, genesis, identity, activation=false and the unchanged nonprogram policy.',
      'On failure, stop promotion, reconcile actual container/image state, and restore the retained old compose/image only after verifying its exact identities. Preserve the failed candidate for diagnosis.',
    ],
    forbidden: ['ExUNA deployment or activation', 'policy or mint change', 'db/rpc-cache/https replacement', 'secret upload', 'image/source pruning', 'masked Compose failure'],
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    assert(process.argv.length === 4, 'usage: node scripts/mainnet-nonprogram-site-plan.mjs current.json candidate.json');
    const current = JSON.parse(readFileSync(process.argv[2], 'utf8'));
    const candidate = JSON.parse(readFileSync(process.argv[3], 'utf8'));
    process.stdout.write(`${JSON.stringify(makeSitePlan({ current, candidate }), null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
