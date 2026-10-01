import { readFileSync, writeFileSync } from 'node:fs';

function insert(path, anchor, content, after = false) {
  const source = readFileSync(path, 'utf8');
  if (source.includes(content.trim())) throw new Error(`${path}: reward patch is already present`);
  const at = source.indexOf(anchor);
  if (at < 0 || source.indexOf(anchor, at + anchor.length) >= 0) throw new Error(`${path}: expected exactly one insertion anchor`);
  const offset = at + (after ? anchor.length : 0);
  writeFileSync(path, source.slice(0, offset) + content + source.slice(offset));
}
function replaceOnce(path, anchor, replacement) {
  const source = readFileSync(path, 'utf8');
  const at = source.indexOf(anchor);
  if (at < 0 || source.indexOf(anchor, at + anchor.length) >= 0) throw new Error(`${path}: expected exactly one replacement anchor`);
  writeFileSync(path, source.slice(0, at) + replacement + source.slice(at + anchor.length));
}

insert('/app/bootstrap.js', "await import('./workspace-ui.js');", "\nawait import('./reward-experience-ui.js');", true);
insert('/app/server/index.mjs', "import { homeFeeAllocationSummary } from './home-dashboard-metrics.mjs';",
  "import { rewardExperience } from './reward-experience.mjs';\n");
insert('/app/server/index.mjs', "import { coinFeeOverview } from './coin-fee-overview.mjs';",
  "\nimport { buildMintCreatorFeeCollectionInstructions } from './pump-fee-collection.mjs';", true);
insert('/app/server/index.mjs', "import { coinFeeOverview } from './coin-fee-overview.mjs';",
  "\nimport { verifyWrappedSolRecoveryReceipt } from './wrapped-sol-recovery-receipt.mjs';", true);
replaceOnce('/app/server/index.mjs',
  "? await online.collectCoinCreatorFeeV2Instructions(router.address, NATIVE_MINT, TOKEN_PROGRAM_ID, keeper.publicKey)",
  "? (await buildMintCreatorFeeCollectionInstructions({ connection, router:router.address, keeper:keeper.publicKey })).instructions");

const route = `    if (req.method === 'GET' && url.pathname === '/api/rewards/experience') {
      if (!await store.chargeRpcRate(\`reward-experience:\${clientKey(req)}\`, 1, 30, Math.floor(Date.now() / 60_000) * 60_000))
        return json(res, 429, { error:'Reward proof request limit reached; retry shortly.' });
      let wallet = null, mint = null;
      try {
        if (url.searchParams.has('wallet')) wallet = new PublicKey(url.searchParams.get('wallet')).toBase58();
        if (url.searchParams.has('mint')) mint = new PublicKey(url.searchParams.get('mint')).toBase58();
      } catch { return json(res, 400, { error:'A valid Solana wallet and mint are required.' }); }
      const [state, rewards, evidence] = await Promise.all([store.read(), automaticRewardStore.read(), readFinalizedEvidence()]);
      return json(res, 200, rewardExperience(state, rewards, evidence, solanaCluster, wallet, mint));
    }
`;
insert('/app/server/index.mjs', "    if (req.method === 'GET' && url.pathname === '/api/airdrops/reserves') {", route);

const recoverySource = readFileSync('/app/scripts/recovery-index-patch-source.mjs', 'utf8');
const recoveryStart = "    if (req.method === 'POST' && url.pathname === '/api/keeper/reconcile-wrapped-sol') {";
const recoveryEnd = "    if (req.method === 'POST' && url.pathname === '/api/referrals/registration/prepare') {";
const start = recoverySource.indexOf(recoveryStart), end = recoverySource.indexOf(recoveryEnd, start);
if (start < 0 || end < 0 || recoverySource.indexOf(recoveryStart, start + recoveryStart.length) >= 0)
  throw new Error('Expected exactly one reviewed wrapped SOL reconciliation route');
insert('/app/server/index.mjs', recoveryEnd, recoverySource.slice(start, end));

// The first public patch image used CRLF in this copied model. Preserve those
// bytes so this checked-in recipe reproduces its application content exactly.
const modelPath = '/app/server/reward-experience.mjs';
writeFileSync(modelPath, readFileSync(modelPath, 'utf8').replace(/\r?\n/g, '\r\n'));
