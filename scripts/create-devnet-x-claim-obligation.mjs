import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Connection, Keypair, PublicKey, Transaction, clusterApiUrl } from '@solana/web3.js';
import { OnlinePumpSdk, PUMP_SDK } from '@pump-fun/pump-sdk';
import bs58 from 'bs58';
import nacl from 'tweetnacl';
import { buildMintRouterInitializeInstruction } from '../mint-router-launch.js';
import { deriveFeeRouter, verifyMintFeeRouterAccount } from '../fee-router.js';
import { buildTradeTransaction } from '../pump-trading.js';
import { buildFeeDistributionPolicy } from '../distribution-policy.js';
import { launchPolicyStatement } from '../launch-policy-auth.js';

// Creates real Devnet transactions and a live claim obligation. Set X_TEST_HANDLE
// to the consenting X account that will receive the test claim.
const handle = String(process.env.X_TEST_HANDLE || '').trim();
assert.match(handle, /^@[A-Za-z0-9_]{1,15}$/, 'Set X_TEST_HANDLE to a valid recipient such as @example.');
const appUrl = 'https://funded.vip';
const localApiUrl = 'http://127.0.0.1:8788';
const cluster = process.env.VITE_SOLANA_CLUSTER || process.env.SOLANA_CLUSTER;
assert.equal(cluster, 'devnet', 'This script only creates Devnet transactions.');
assert.equal(String(process.env.VITE_ALLOW_MAINNET || 'false'), 'false', 'Mainnet must be disabled.');

const rpcUrl = process.env.SOLANA_RPC_URL || clusterApiUrl('devnet');
const connection = new Connection(rpcUrl, 'finalized');
const official = new Connection(clusterApiUrl('devnet'), 'finalized');
const programId = new PublicKey(process.env.FUNDED_FEE_ROUTER_PROGRAM_ID || process.env.VITE_FUNDED_FEE_ROUTER_PROGRAM_ID);
const feeOwner = new PublicKey(process.env.VITE_FUNDED_TRADE_FEE_OWNER || deriveFeeRouter(programId).address);
const payer = Keypair.generate();
const mint = Keypair.generate();
const evidence = { cluster: 'devnet', payer: payer.publicKey.toBase58(), mint: mint.publicKey.toBase58(), handle, signatures: {} };
let stage = 'preflight';

async function jsonRequest(base, path, options = {}) {
  const response = await fetch(`${base}${path}`, { ...options, signal: AbortSignal.timeout(20_000) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${path} returned ${response.status}: ${data.error || data.detail || 'unknown error'}`);
  return data;
}

async function finalizedTransaction(instructions, signers) {
  const block = await connection.getLatestBlockhash('finalized');
  const transaction = new Transaction({ recentBlockhash: block.blockhash, feePayer: signers[0].publicKey }).add(...instructions);
  transaction.sign(...signers);
  const signature = await connection.sendRawTransaction(transaction.serialize(), { skipPreflight: false });
  const confirmation = await connection.confirmTransaction({ signature, blockhash: block.blockhash, lastValidBlockHeight: block.lastValidBlockHeight }, 'finalized');
  assert.equal(confirmation.value.err, null, `Devnet transaction failed: ${signature}`);
  const status = await connection.getSignatureStatus(signature, { searchTransactionHistory: true });
  assert.equal(status.value?.confirmationStatus, 'finalized', `Devnet transaction is not finalized: ${signature}`);
  assert.equal(status.value?.err, null, `Devnet transaction finalized with an error: ${signature}`);
  return signature;
}

try {
  assert.equal(await connection.getGenesisHash(), await official.getGenesisHash(), 'RPC does not point to Solana Devnet.');
  const readiness = await jsonRequest(appUrl, '/api/x-fee/status');
  assert.equal(readiness.ready, true, `X fee route is not ready: ${readiness.reasons?.join(', ')}`);
  const xUser = await jsonRequest(appUrl, `/api/x/resolve?handle=${encodeURIComponent(handle)}`);
  assert.equal(xUser.handle?.toLowerCase(), handle.toLowerCase());
  assert.match(String(xUser.id), /^\d{1,24}$/);

  stage = 'faucet';
  // One faucet attempt only. Never load or persist an existing wallet key.
  let airdrop;
  let faucetConnection = connection;
  try {
    airdrop = await connection.requestAirdrop(payer.publicKey, 250_000_000);
    evidence.faucet = 'configured-devnet-rpc';
  } catch (error) {
    if (rpcUrl === clusterApiUrl('devnet') || !/rate limit|faucet|403|429/i.test(String(error.message || error))) throw error;
    faucetConnection = official;
    airdrop = await official.requestAirdrop(payer.publicKey, 250_000_000);
    evidence.faucet = 'public-devnet-rpc';
  }
  evidence.signatures.airdrop = airdrop;
  const airdropStatus = await faucetConnection.confirmTransaction(airdrop, 'finalized');
  assert.equal(airdropStatus.value.err, null, 'Devnet faucet transaction failed.');
  const fundedBalance = await connection.getBalance(payer.publicKey, 'finalized');
  assert(fundedBalance >= 200_000_000, 'Ephemeral payer has insufficient finalized Devnet SOL.');
  evidence.faucetBalanceLamports = fundedBalance;

  stage = 'initialize-mint-router';
  const routerPlan = buildMintRouterInitializeInstruction({ programId, mint: mint.publicKey, payer: payer.publicKey });
  evidence.signatures.initialize = await finalizedTransaction([routerPlan.instruction], [payer, mint]);
  const legacy = await connection.getAccountInfo(deriveFeeRouter(programId).address, 'finalized');
  assert.equal(legacy?.data?.length, 74, 'Legacy router authority header is unavailable.');
  const authority = new PublicKey(legacy.data.subarray(41, 73));
  const verifiedRouter = await verifyMintFeeRouterAccount({ connection, programId, mint: mint.publicKey, expectedAuthority: authority });
  assert(verifiedRouter.verified, `Mint router is not verified: ${verifiedRouter.reason}`);
  const router = verifiedRouter.address;
  evidence.router = router.toBase58();

  stage = 'create-pump-coin';
  const name = `Funded X Claim QA ${Date.now().toString(36).slice(-6)}`;
  const create = await PUMP_SDK.createV2Instruction({
    mint: mint.publicKey, name, symbol: 'FXQA',
    uri: `${appUrl}/devnet-metadata/${mint.publicKey.toBase58()}`,
    creator: router, user: payer.publicKey, mayhemMode: false, holderReward: false,
  });
  evidence.signatures.launch = await finalizedTransaction([create], [payer, mint]);
  const curve = await new OnlinePumpSdk(connection).fetchBondingCurve(mint.publicKey);
  assert.equal(curve.creator.toBase58(), router.toBase58(), 'Pump creator does not match the isolated router.');
  evidence.name = name;

  stage = 'register-signed-policy';
  const feeDistribution = buildFeeDistributionPolicy({
    creatorWalletPercent: 0, holderAirdropPercent: 0, solClaimPercent: 80,
    xRecipient: handle, feeRouterAddress: router.toBase58(),
  });
  const policy = {
    mint: mint.publicKey.toBase58(), chain: 'solana', cluster: 'devnet',
    signature: evidence.signatures.launch, creatorWallet: payer.publicKey.toBase58(),
    communityAllocation: 3, xUserId: String(xUser.id), feeDistribution,
    pumpFeeRoute: { router: router.toBase58(), scope: 'per-mint-v2', transaction: evidence.signatures.launch },
  };
  policy.policySignature = bs58.encode(nacl.sign.detached(new TextEncoder().encode(launchPolicyStatement(policy)), payer.secretKey));
  const registered = await jsonRequest(localApiUrl, '/api/launches', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(policy),
  });
  assert.equal(registered.onchainVerified, true);
  assert.equal(registered.xUserId, String(xUser.id));
  assert.equal(registered.pumpFeeRoute.scope, 'per-mint-v2');
  evidence.registered = true;

  stage = 'buy-and-accrue-fees';
  const trade = await buildTradeTransaction({ connection, side: 'buy', mint: mint.publicKey, user: payer.publicKey, amount: 0.05, slippagePercent: 3, feeOwner });
  evidence.signatures.buy = await finalizedTransaction(trade.instructions, [payer]);
  const tokenAccounts = await connection.getParsedTokenAccountsByOwner(payer.publicKey, { mint: mint.publicKey }, 'finalized');
  assert(tokenAccounts.value.some(row => BigInt(row.account.data.parsed.info.tokenAmount.amount) > 0n), 'Finalized trade produced no token balance.');

  stage = 'collect-creator-fees';
  const keeperToken = (await readFile('.secrets/funded-api-token', 'utf8')).trim();
  assert(keeperToken, 'Local keeper API token is unavailable.');
  const collected = await jsonRequest(localApiUrl, '/api/keeper/collect', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${keeperToken}` },
    body: JSON.stringify({ mint: mint.publicKey.toBase58() }),
  });
  assert.equal(collected.status, 'collected', `Creator-fee collection did not produce fees: ${collected.status}`);
  assert.equal(collected.onchainVerified, true);
  assert(Number(collected.collectedLamports) > 0);
  assert(collected.obligationId, 'The app did not create an X claim obligation.');
  evidence.signatures.collection = collected.signature;
  evidence.collectedLamports = collected.collectedLamports;
  evidence.obligationId = collected.obligationId;
  const collectionStatus = await connection.getSignatureStatus(collected.signature, { searchTransactionHistory: true });
  assert.equal(collectionStatus.value?.err, null);
  assert.equal(collectionStatus.value?.confirmationStatus, 'finalized', 'Collection has not finalized.');
  const routerBalance = await connection.getBalance(router, 'finalized');
  evidence.routerBalanceLamports = routerBalance;
  assert(routerBalance > 0, 'Mint router has no finalized balance.');
  console.log(JSON.stringify({ status: 'claim-obligation-created', ...evidence }));
} catch (error) {
  console.error(JSON.stringify({ status: 'blocked', stage, error: String(error.message || error), ...evidence }));
  process.exitCode = 1;
}
