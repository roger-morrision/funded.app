import assert from 'node:assert/strict';
import { Connection, Keypair, PublicKey, Transaction, clusterApiUrl } from '@solana/web3.js';
import bs58 from 'bs58';
import nacl from 'tweetnacl';
import { submitPumpDevnetLaunch } from '../launch-flow.js';
import { metadataStatement, devnetMetadataUri } from '../devnet-metadata.js';
import { buildFeeDistributionPolicy } from '../distribution-policy.js';
import { launchPolicyStatement } from '../launch-policy-auth.js';
import { assertTradeConfirmed, buildTradeTransaction } from '../pump-trading.js';
import { readPumpMarketActivity } from '../server/coin-market.mjs';

// Run with `--execute` only after reviewing the preflight output. This script
// intentionally never requests faucet funds, touches mainnet, or burns FUNDED.
const execute = process.argv.includes('--execute');
const resume = process.argv.includes('--resume');
assert.ok(!resume || execute, '--resume requires --execute.');
assert.equal(process.env.VITE_SOLANA_CLUSTER || process.env.SOLANA_CLUSTER, 'devnet', 'Devnet configuration is required.');
const rpc = process.env.SOLANA_RPC_URL || clusterApiUrl('devnet');
const connection = new Connection(rpc, 'confirmed');
const [genesis, officialGenesis] = await Promise.all([
  connection.getGenesisHash(),
  new Connection(clusterApiUrl('devnet'), 'confirmed').getGenesisHash(),
]);
assert.equal(genesis, officialGenesis, 'Configured RPC is not Solana Devnet.');

function roleWallet(role) {
  const secret = process.env[`SOLANA_DEVNET_${role}_SECRET_KEY`];
  assert.ok(secret, `${role} Devnet QA wallet is not configured.`);
  return Keypair.fromSecretKey(bs58.decode(secret));
}

const creator = roleWallet('CREATOR');
const referrer = roleWallet('REFERRER');
const claimant = roleWallet('CLAIMANT');
const programId = new PublicKey(process.env.FUNDED_FEE_ROUTER_PROGRAM_ID || process.env.VITE_FUNDED_FEE_ROUTER_PROGRAM_ID);
const [router] = PublicKey.findProgramAddressSync([Buffer.from('funded-fee-router-v1')], programId);
const feeOwner = new PublicKey(process.env.VITE_FUNDED_TRADE_FEE_OWNER || router.toBase58());
assert.ok(!feeOwner.equals(creator.publicKey), 'QA creator must not be the fee owner.');
const apiBase = 'http://127.0.0.1:8788';
const health = await fetch(`${apiBase}/api/health`).then(async response => {
  assert.equal(response.status, 200, 'Local app API is not healthy.');
  return response.json();
});
assert.equal(health.ok, true, 'Local app is unhealthy.');
const registrySource = await fetch(`${apiBase}/api/pump/explore?limit=1`).then(response => response.json());
assert.equal(registrySource.cluster, 'devnet', 'Local app is not configured for Devnet.');
const metadataReady = await fetch('https://metadata.funded.vip/default.svg', { signal: AbortSignal.timeout(15_000) });
assert.equal(metadataReady.status, 200, 'Public metadata host is unavailable.');

const balances = await Promise.all([creator, referrer, claimant].map(wallet => connection.getBalance(wallet.publicKey, 'confirmed')));
for (let index = 0; index < balances.length; index += 1) {
  assert.ok(balances[index] >= 35_000_000, `QA wallet ${index + 1} needs at least 0.035 Devnet SOL.`);
}
const tradeSol = 0.003;
const registered = await fetch(`${apiBase}/api/launches`).then(response => response.json());
assert.ok(Array.isArray(registered), 'Launch registry is unavailable.');
const existingQa = registered.find(item => item.creatorWallet === creator.publicKey.toBase58() && item.name?.startsWith('Funded Devnet QA '));
console.log(JSON.stringify({ mode: resume ? 'resume' : execute ? 'execute' : 'preflight', cluster: 'devnet', creator: creator.publicKey.toBase58(), referrer: referrer.publicKey.toBase58(), claimant: claimant.publicKey.toBase58(), router: router.toBase58(), feeOwner: feeOwner.toBase58(), balancesSol: balances.map(value => value / 1e9), tradeSol, existingQaMint: existingQa?.mint || null }));
if (!execute) process.exit(0);
if (resume) assert.ok(existingQa, 'No registered QA launch exists to resume.');
else assert.ok(!existingQa, 'A registered QA launch already exists. Use --execute --resume to finish its trades.');

async function postJson(path, input, expectedStatus) {
  const response = await fetch(`${apiBase}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) });
  const data = await response.json().catch(() => ({}));
  assert.equal(response.status, expectedStatus, `${path}: ${response.status} ${data.error || ''}`);
  return data;
}

let mint = existingQa?.mint || null;
let launchSignature = existingQa?.signature || null;
let buySignatures = [];
if (!resume) {
const name = `Funded Devnet QA ${new Date().toISOString().slice(5, 10).replace('-', '')}`;
const symbol = 'FUNDQA';
const provider = { signTransaction: async transaction => { transaction.partialSign(creator); return transaction; } };
let preparedMint = null;
const launch = await submitPumpDevnetLaunch({
  connection, provider, payer: creator.publicKey,
  input: { name, symbol, supply: 1_000_000_000, decimals: 6, initialBuyPercent: 0 },
  feeRouterAddress: router.toBase58(),
  prepareMetadata: async ({ mint, name: tokenName, symbol: tokenSymbol }) => {
    preparedMint = mint;
    const record = { mint, creatorWallet: creator.publicKey.toBase58(), name: tokenName, symbol: tokenSymbol,
      description: 'Devnet QA token for verifying funded.vip dashboards, trades, and on-chain launch data. No real value.',
      tagline: 'Devnet QA only', roadmap: '', website: 'https://funded.vip/', x: '', telegram: '', discord: '', imageSha256: '' };
    const signature = bs58.encode(nacl.sign.detached(new TextEncoder().encode(metadataStatement(record)), creator.secretKey));
    const saved = await postJson('/api/devnet-metadata', { ...record, imageBase64: '', imageType: '', signature }, 201);
    assert.equal(saved.uri, devnetMetadataUri(mint));
    let publicReady = false;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        const published = await fetch(saved.uri, { signal: AbortSignal.timeout(10_000) });
        if (published.ok && (await published.json()).description === record.description) { publicReady = true; break; }
      } catch {}
      await new Promise(resolve => setTimeout(resolve, 1500));
    }
    assert.ok(publicReady, 'Signed metadata is not publicly readable; launch was not submitted.');
    console.log(JSON.stringify({ stage: 'metadata-published', mint, uri: saved.uri }));
    return saved.uri;
  },
  onStatus: stage => console.log(JSON.stringify({ stage, mint: preparedMint })),
});
mint = launch.mint.publicKey.toBase58();
launchSignature = launch.signature;
console.log(JSON.stringify({ stage: 'launch-confirmed', mint, signature: launch.signature }));
assert.ok(launch.feeRoute.verified, 'Pump creator-fee route is not verified.');
const policy = { chain: 'solana', cluster: 'devnet', mint, creatorWallet: creator.publicKey.toBase58(), name, symbol,
  metadataUri: launch.metadataUri, signature: launch.signature, communityAllocation: 3,
  feeDistribution: buildFeeDistributionPolicy({ creatorWalletPercent: 80, holderAirdropPercent: 0, solClaimPercent: 0, feeRouterAddress: router.toBase58() }),
  pumpFeeRoute: { router: router.toBase58(), transaction: launch.signature } };
policy.policySignature = bs58.encode(nacl.sign.detached(new TextEncoder().encode(launchPolicyStatement(policy)), creator.secretKey));
const listing = await postJson('/api/launches', policy, 201);
assert.equal(listing.mint, mint);
assert.equal(listing.onchainVerified, true);
console.log(JSON.stringify({ stage: 'launch-registered', mint, signature: launch.signature }));
}

async function trade(side, wallet, amount) {
  const prepared = await buildTradeTransaction({ connection, side, mint: new PublicKey(mint), user: wallet.publicKey, amount, slippagePercent: 3, feeOwner });
  const latest = await connection.getLatestBlockhash('confirmed');
  const tx = new Transaction({ recentBlockhash: latest.blockhash, feePayer: wallet.publicKey }).add(...prepared.instructions);
  tx.sign(wallet);
  const signature = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: false });
  const confirmation = await connection.confirmTransaction({ signature, blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight }, 'confirmed');
  assertTradeConfirmed(confirmation);
  console.log(JSON.stringify({ stage: 'trade-confirmed', side, wallet: wallet.publicKey.toBase58(), amount, signature, feeLamports: prepared.feeLamports }));
  return signature;
}

if (!resume) buySignatures = [await trade('buy', referrer, tradeSol), await trade('buy', claimant, tradeSol)];
const tokenAccounts = await connection.getParsedTokenAccountsByOwner(referrer.publicKey, { mint: new PublicKey(mint) }, 'confirmed');
assert.equal(tokenAccounts.value.length, 1, 'Expected one referrer token account after the QA buy.');
const tokenBalance = tokenAccounts.value[0].account.data.parsed.info.tokenAmount;
const sellAmount = Math.floor(Number(BigInt(tokenBalance.amount) / 2n)) / (10 ** tokenBalance.decimals);
assert.ok(sellAmount > 0, 'The QA buy produced no sellable tokens.');
const priorActivity = resume ? await readPumpMarketActivity({ connection, mint: new PublicKey(mint) }) : null;
if (resume) assert.equal(priorActivity.coverage, 'complete', 'Cannot safely resume while the on-chain trade scan is partial.');
const priorSell = priorActivity?.recentTrades?.find(item => item.side === 'sell' && item.trader === referrer.publicKey.toBase58());
const sellSignature = priorSell?.signature || await trade('sell', referrer, sellAmount);
if (priorSell) console.log(JSON.stringify({ stage: 'sell-already-confirmed', signature: sellSignature }));

const [launches, exploreResponse, activityResponse, analyticsResponse] = await Promise.all([
  fetch(`${apiBase}/api/launches`).then(response => response.json()),
  fetch(`${apiBase}/api/pump/explore?limit=20`),
  fetch(`${apiBase}/api/tokens/${mint}/market-activity`),
  fetch(`${apiBase}/api/analytics/summary`),
]);
const [explore, activity, analytics] = await Promise.all([
  exploreResponse.json(), activityResponse.json(), analyticsResponse.json(),
]);
console.log(JSON.stringify({ stage: 'dashboard-verification', mint, launchRegistered: launches.some(item => item.mint === mint),
  exploreStatus: exploreResponse.status, exploreListed: Array.isArray(explore.items) && explore.items.some(item => item.mint === mint),
  activityStatus: activityResponse.status, tradeCount24h: activity.tradeCount24h ?? activity.summary?.tradeCount24h ?? null,
  analyticsStatus: analyticsResponse.status, analyticsLaunches: analytics.launches ?? null,
  launchSignature, buySignatures, sellSignature }));
