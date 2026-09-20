import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { Connection, Keypair, PublicKey, clusterApiUrl } from '@solana/web3.js';
import { getAccount, getAssociatedTokenAddressSync, getMint } from '@solana/spl-token';
import bs58 from 'bs58';
import nacl from 'tweetnacl';
import { buildCommunityAirdropPolicy } from '../airdrop-policy.js';
import { buildFeeDistributionPolicy } from '../distribution-policy.js';
import { verifyFeeRouterAccount } from '../fee-router.js';
import { buildLaunchBurnPolicy, createLaunchBurnTiers, tokensToBaseUnits } from '../launch-burn-policy.js';
import { submitPumpDevnetLaunch } from '../launch-flow.js';
import { metadataStatement, devnetMetadataUri } from '../devnet-metadata.js';
import { launchPolicyStatement } from '../launch-policy-auth.js';
import { verifiedPromotionBadge } from '../promotion-badge.js';

const tierId = String(process.argv[2] || '').toLowerCase();
const execute = process.argv.includes('--execute');
assert(['boost', 'pro', 'premier'].includes(tierId), 'Choose boost, pro, or premier.');
assert.equal(process.env.VITE_SOLANA_CLUSTER, 'devnet', 'Devnet-only configuration required.');
assert.equal(process.env.VITE_ALLOW_MAINNET, 'false', 'Mainnet must be disabled.');
const tiers = createLaunchBurnTiers({
  boostAmount: Number(process.env.VITE_FUNDED_BOOST_BURN_AMOUNT || 25_000),
  proAmount: Number(process.env.VITE_FUNDED_PRO_BURN_AMOUNT || 100_000),
  premierAmount: Number(process.env.VITE_FUNDED_PREMIER_BURN_AMOUNT || 250_000),
});
const payer = Keypair.fromSecretKey(bs58.decode(process.env.SOLANA_DEVNET_CREATOR_SECRET_KEY));
const fundedMint = String(process.env.VITE_FUNDED_TOKEN_MINT || '');
const burn = buildLaunchBurnPolicy({ tierId, fundedMint, tiers });
const fundedMintKey = new PublicKey(burn.fundedMint);
const connection = new Connection(process.env.SOLANA_RPC_URL || clusterApiUrl('devnet'), 'confirmed');
const [genesis, devnetGenesis] = await Promise.all([
  connection.getGenesisHash(), new Connection(clusterApiUrl('devnet'), 'confirmed').getGenesisHash(),
]);
assert.equal(genesis, devnetGenesis, 'Configured RPC is not Solana Devnet.');
const router = await verifyFeeRouterAccount({ connection, programId: process.env.VITE_FUNDED_FEE_ROUTER_PROGRAM_ID });
assert.equal(router.verified, true, `Fee router is not verified: ${router.reason}`);
const ata = getAssociatedTokenAddressSync(fundedMintKey, payer.publicKey);
const [mintBefore, walletBefore, solBefore] = await Promise.all([
  getMint(connection, fundedMintKey), getAccount(connection, ata), connection.getBalance(payer.publicKey, 'confirmed'),
]);
const burnUnits = tokensToBaseUnits(burn.amountTokens, mintBefore.decimals);
assert(walletBefore.amount >= burnUnits, 'Creator test wallet lacks $FUNDED for this promotion.');
assert(solBefore >= 30_000_000, 'Creator test wallet needs at least 0.03 Devnet SOL.');
const apiBase = 'http://127.0.0.1:8795';
const publicMetadataApi = 'http://127.0.0.1:8788';
for (const base of [apiBase, publicMetadataApi]) {
  const response = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(5000) });
  assert.equal(response.status, 200, `${base} is not healthy.`);
}
console.log(JSON.stringify({ stage: 'preflight', tier: tierId, amountTokens: burn.amountTokens,
  payer: payer.publicKey.toBase58(), router: router.address.toBase58(), solBalance: solBefore / 1e9,
  fundedBalance: Number(walletBefore.amount) / 10 ** mintBefore.decimals, execute }));
if (!execute) process.exit(0);

async function postJson(base, path, payload, expectedStatus = 201) {
  const response = await fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(30_000) });
  const data = await response.json().catch(() => ({}));
  assert.equal(response.status, expectedStatus, `${path} at ${base}: ${response.status} ${data.error || ''}`);
  return data;
}

async function readPublicMetadata(uri) {
  try {
    const response = await fetch(uri, { signal: AbortSignal.timeout(10_000) });
    if (response.ok) return response.json();
  } catch {}
  if (process.platform !== 'win32') return null;
  try {
    const result = execFileSync('wsl.exe', ['--exec', 'curl', '--fail', '--silent', '--show-error', '--max-time', '10', uri],
      { encoding: 'utf8', timeout: 15_000, stdio: ['ignore', 'pipe', 'ignore'] });
    return JSON.parse(result);
  } catch { return null; }
}

const suffix = Date.now().toString(36).slice(-5);
const name = `Funded ${burn.label} Badge QA ${suffix}`;
const symbol = { boost: 'FBQA', pro: 'FPQA', premier: 'FMQA' }[tierId];
let preparedMint = null;
const launch = await submitPumpDevnetLaunch({
  connection,
  provider: { signTransaction: async transaction => { transaction.partialSign(payer); return transaction; } },
  payer: payer.publicKey,
  input: { name, symbol, supply: 1_000_000_000, decimals: 6, initialBuyPercent: 0 },
  feeRouterAddress: router.address.toBase58(),
  launchBurn: burn,
  prepareMetadata: async ({ mint }) => {
    preparedMint = mint;
    const record = { mint, creatorWallet: payer.publicKey.toBase58(), name, symbol,
      description: `Devnet ${burn.label} promotion QA token. No monetary value.`, tagline: 'Promotion badge QA',
      roadmap: '', website: '', x: '', telegram: '', discord: '', imageSha256: '' };
    const signature = bs58.encode(nacl.sign.detached(new TextEncoder().encode(metadataStatement(record)), payer.secretKey));
    for (const base of [publicMetadataApi, apiBase]) {
      const saved = await postJson(base, '/api/devnet-metadata', { ...record, imageBase64: '', imageType: '', signature });
      assert.equal(saved.uri, devnetMetadataUri(mint));
    }
    const uri = devnetMetadataUri(mint);
    console.log(JSON.stringify({ stage: 'metadata-uploaded-locally', tier: tierId, mint, uri }));
    let publicReady = false;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        publicReady = (await readPublicMetadata(uri))?.description === record.description;
        if (publicReady) break;
      } catch {}
      await new Promise(resolve => setTimeout(resolve, 1500));
    }
    assert(publicReady, `Signed metadata is not publicly readable at ${uri}; no launch transaction was submitted.`);
    console.log(JSON.stringify({ stage: 'metadata-published', tier: tierId, mint, uri }));
    return uri;
  },
  onStatus: stage => console.log(JSON.stringify({ stage, tier: tierId, mint: preparedMint })),
});
const mint = launch.mint.publicKey.toBase58();
console.log(JSON.stringify({ stage: 'launch-confirmed', tier: tierId, mint, signature: launch.signature }));
assert.equal(launch.launchBurnReceipt?.verified, true);
assert.equal(launch.feeRoute.verified, true);

const policy = {
  chain: 'solana', cluster: 'devnet', mint, creatorWallet: payer.publicKey.toBase58(), name, symbol,
  metadataUri: launch.metadataUri, signature: launch.signature, communityAllocation: 3,
  communityAirdrop: buildCommunityAirdropPolicy({ allocationPercent: 3, supply: 1_000_000_000 }),
  feeDistribution: buildFeeDistributionPolicy({ creatorWalletPercent: 80, holderAirdropPercent: 0,
    solClaimPercent: 0, feeRouterAddress: router.address.toBase58() }),
  creatorLaunchBurn: { ...burn, status: 'verified', receipt: launch.launchBurnReceipt },
  pumpFeeRoute: { router: router.address.toBase58(), transaction: launch.signature },
};
policy.policySignature = bs58.encode(nacl.sign.detached(new TextEncoder().encode(launchPolicyStatement(policy)), payer.secretKey));
const registered = await postJson(apiBase, '/api/launches', policy);
assert.equal(registered.mint, mint);
assert.equal(verifiedPromotionBadge(registered)?.tier, tierId, 'Registered launch has no verified paid badge.');
const [walletAfter, mintAfter] = await Promise.all([getAccount(connection, ata), getMint(connection, fundedMintKey)]);
assert.equal(walletBefore.amount - walletAfter.amount, burnUnits, 'Creator wallet burn balance mismatch.');
assert(mintBefore.supply - mintAfter.supply >= burnUnits, '$FUNDED supply did not decrease by the selected amount.');
const listings = await fetch(`${apiBase}/api/launches`).then(response => response.json());
const listing = listings.find(item => item.mint === mint);
assert.equal(verifiedPromotionBadge(listing)?.tier, tierId, 'GET /api/launches did not retain the badge proof.');
console.log(JSON.stringify({ stage: 'promotion-verified', tier: tierId, mint, signature: launch.signature,
  amountBurned: burn.amountTokens, fundedBalanceAfter: Number(walletAfter.amount) / 10 ** mintBefore.decimals,
  solBalanceAfter: await connection.getBalance(payer.publicKey, 'confirmed') / 1e9,
  tokenUrl: `${apiBase}/token/${mint}`,
  explorerTransaction: `https://explorer.solana.com/tx/${launch.signature}?cluster=devnet` }));
