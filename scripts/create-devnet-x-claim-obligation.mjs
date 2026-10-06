import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, VersionedTransaction, clusterApiUrl } from '@solana/web3.js';
import bs58 from 'bs58';
import nacl from 'tweetnacl';
import { deriveFeeRouter } from '../fee-router.js';
import { buildTradeTransaction } from '../pump-trading.js';
import { buildFeeDistributionPolicy } from '../distribution-policy.js';
import { launchPolicyStatement } from '../launch-policy-auth.js';
import { devnetMetadataUri, metadataStatement } from '../devnet-metadata.js';
import { quoteAtomicReserveBuy } from '../launch-community-reserve.js';
import { submitPumpDevnetLaunch } from '../launch-flow.js';

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
let mint;
let qaFunder = null;
const evidence = { cluster: 'devnet', payer: payer.publicKey.toBase58(), mint: null, handle, signatures: {} };
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
  evidence.pendingSignature = bs58.encode(transaction.signature);
  const signature = await connection.sendRawTransaction(transaction.serialize(), { skipPreflight: false });
  const confirmation = await connection.confirmTransaction({ signature, blockhash: block.blockhash, lastValidBlockHeight: block.lastValidBlockHeight }, 'finalized');
  assert.equal(confirmation.value.err, null, `Devnet transaction failed: ${signature}`);
  const status = await connection.getSignatureStatus(signature, { searchTransactionHistory: true });
  assert.equal(status.value?.confirmationStatus, 'finalized', `Devnet transaction is not finalized: ${signature}`);
  assert.equal(status.value?.err, null, `Devnet transaction finalized with an error: ${signature}`);
  delete evidence.pendingSignature;
  return signature;
}

try {
  assert.equal(await connection.getGenesisHash(), await official.getGenesisHash(), 'RPC does not point to Solana Devnet.');
  const readiness = await jsonRequest(appUrl, '/api/x-fee/status');
  assert.equal(readiness.ready, true, `X fee route is not ready: ${readiness.reasons?.join(', ')}`);
  const xUser = await jsonRequest(appUrl, `/api/x/resolve?handle=${encodeURIComponent(handle)}`);
  assert.equal(xUser.handle?.toLowerCase(), handle.toLowerCase());
  assert.match(String(xUser.id), /^\d{1,24}$/);
  const reserveConfig = await jsonRequest(localApiUrl, '/api/launch-reserve-config');
  assert.equal(reserveConfig.cluster, 'devnet');
  assert.equal(reserveConfig.programId, programId.toBase58());
  const reserveTable = (await connection.getAddressLookupTable(new PublicKey(reserveConfig.lookupTable), { commitment:'finalized' })).value;
  assert(reserveTable?.isActive(), 'Atomic community reserve lookup table is unavailable.');
  const reserveQuote = await quoteAtomicReserveBuy({ connection, supply:1_000_000_000, decimals:6,
    reserveTokens:30_000_000, developerBaseUnits:0n });
  assert(reserveQuote.maxSolAmountLamports <= 100_000_000n, 'Community reserve buy exceeds the test budget.');
  evidence.reserveMaxSol = Number(reserveQuote.maxSolAmountLamports) / 1_000_000_000;

  stage = 'faucet';
  if (process.env.X_TEST_QA_FUNDING === 'true') {
    const manifest = JSON.parse(await readFile('.secrets/devnet-qa-wallets-20260930/public.json', 'utf8'));
    const fundingRole = process.env.X_TEST_QA_FUNDING_ROLE || 'creator';
    assert(['creator', 'referrer'].includes(fundingRole), 'Choose a dedicated Devnet QA creator or referrer funding source.');
    const encoded = fundingRole === 'creator'
      ? (await readFile('.secrets/solana-devnet-creator-secret-key', 'utf8')).trim()
      : String(process.env.SOLANA_DEVNET_REFERRER_SECRET_KEY || '').trim();
    assert(encoded, 'The selected Devnet QA funding signer is unavailable.');
    qaFunder = Keypair.fromSecretKey(bs58.decode(encoded));
    assert.equal(qaFunder.publicKey.toBase58(), manifest.find(row => row.role === fundingRole && row.cluster === 'devnet')?.address,
      'The funding signer must match its dedicated Devnet QA manifest.');
    const sourceBalance = await connection.getBalance(qaFunder.publicKey, 'finalized');
    assert(sourceBalance >= 1_250_000_000, 'Keep at least 1 Devnet SOL in the QA source after funding.');
    assert.equal(await connection.getBalance(payer.publicKey, 'finalized'), 0);
    evidence.fundingSource = `qa-devnet-${fundingRole}`;
    evidence.signatures.funding = await finalizedTransaction([
      SystemProgram.transfer({ fromPubkey: qaFunder.publicKey, toPubkey: payer.publicKey, lamports: 250_000_000 }),
    ], [qaFunder]);
  } else {
    // At most one faucet attempt per endpoint. Never load or persist an existing wallet key.
    let airdrop;
    let faucetConnection = connection;
    try {
      airdrop = await connection.requestAirdrop(payer.publicKey, 250_000_000);
      evidence.faucet = 'configured-devnet-rpc';
    } catch (error) {
      if (rpcUrl === clusterApiUrl('devnet') || !/rate limit|faucet|403|429|500|502|503|504|internal server error/i.test(String(error.message || error))) throw error;
      faucetConnection = official;
      airdrop = await official.requestAirdrop(payer.publicKey, 250_000_000);
      evidence.faucet = 'public-devnet-rpc';
    }
    evidence.signatures.airdrop = airdrop;
    const airdropStatus = await faucetConnection.confirmTransaction(airdrop, 'finalized');
    assert.equal(airdropStatus.value.err, null, 'Devnet faucet transaction failed.');
  }
  const fundedBalance = await connection.getBalance(payer.publicKey, 'finalized');
  assert(fundedBalance >= 200_000_000, 'Ephemeral payer has insufficient finalized Devnet SOL.');
  evidence.faucetBalanceLamports = fundedBalance;

  stage = 'create-pump-coin';
  const name = `Funded X Claim QA ${Date.now().toString(36).slice(-6)}`;
  const launch = await submitPumpDevnetLaunch({
    connection, payer:payer.publicKey,
    provider:{ signTransaction:async transaction => {
      if (transaction instanceof VersionedTransaction) transaction.sign([payer]);
      else transaction.partialSign(payer);
      return transaction;
    } },
    input:{ name, symbol:'FXQA', supply:1_000_000_000, decimals:6, initialBuyPercent:0,
      reserveTokens:30_000_000, maxInitialBuyLamports:reserveQuote.maxSolAmountLamports },
    feeRouterAddress:deriveFeeRouter(programId).address.toBase58(), feeRouterProgramId:programId,
    useMintRouter:true, reserveConfig,
    prepareMetadata:async ({ mint:mintAddress }) => {
      evidence.mint = mintAddress;
      const record = { mint:mintAddress, creatorWallet:payer.publicKey.toBase58(), name, symbol:'FXQA',
        description:'Devnet X claim test token. No monetary value.', tagline:'X claim QA',
        roadmap:'', website:'', x:'', telegram:'', discord:'', imageSha256:'' };
      const signature = bs58.encode(nacl.sign.detached(new TextEncoder().encode(metadataStatement(record)), payer.secretKey));
      const saved = await jsonRequest(localApiUrl, '/api/devnet-metadata', { method:'POST',
        headers:{ 'content-type':'application/json', origin:appUrl },
        body:JSON.stringify({ ...record, imageBase64:'', imageType:'', signature }) });
      assert.equal(saved.uri, devnetMetadataUri(mintAddress));
      const published = await fetch(saved.uri, { signal:AbortSignal.timeout(15_000) });
      assert.equal(published.status, 200, 'Signed token metadata is not publicly readable.');
      return saved.uri;
    },
    onJournal:event => {
      if (event.signature && event.step === 'launch') evidence.signatures.launch = event.signature;
      if (event.signature && event.step === 'initialize-mint-router') evidence.signatures.initialize = event.signature;
      if (event.state === 'broadcasting') evidence.pendingSignature = event.signature;
      if (event.state === 'confirmed') delete evidence.pendingSignature;
    },
  });
  mint = launch.mint.publicKey;
  const router = launch.feeRouter;
  evidence.mint = mint.toBase58();
  evidence.router = router.toBase58();
  evidence.signatures.launch = launch.signature;
  assert.equal(launch.reserveReceipt?.atomic, true);
  assert.equal(launch.reserveReceipt?.fundedTokens, 30_000_000);
  evidence.name = name;

  stage = 'register-signed-policy';
  const feeDistribution = buildFeeDistributionPolicy({
    creatorWalletPercent: 0, holderAirdropPercent: 0, solClaimPercent: 80,
    xRecipient: handle, feeRouterAddress: router.toBase58(),
  });
  const policy = {
    mint: mint.toBase58(), chain: 'solana', cluster: 'devnet',
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
  assert.equal(registered.communityReserve?.verified, true);
  assert.equal(registered.communityReserve?.fundedTokens, '30000000');
  evidence.registered = true;

  stage = 'buy-and-accrue-fees';
  const trade = await buildTradeTransaction({ connection, side: 'buy', mint, user: payer.publicKey, amount: 0.05, slippagePercent: 3, feeOwner });
  evidence.signatures.buy = await finalizedTransaction(trade.instructions, [payer]);
  const tokenAccounts = await connection.getParsedTokenAccountsByOwner(payer.publicKey, { mint }, 'finalized');
  assert(tokenAccounts.value.some(row => BigInt(row.account.data.parsed.info.tokenAmount.amount) > 0n), 'Finalized trade produced no token balance.');

  stage = 'collect-creator-fees';
  const keeperToken = (await readFile('.secrets/funded-api-token', 'utf8')).trim();
  assert(keeperToken, 'Local keeper API token is unavailable.');
  const collected = await jsonRequest(localApiUrl, '/api/keeper/collect', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${keeperToken}` },
    body: JSON.stringify({ mint: mint.toBase58() }),
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
} finally {
  if (qaFunder && !evidence.pendingSignature) {
    try {
      const remaining = await connection.getBalance(payer.publicKey, 'finalized');
      const rentReserve = await connection.getMinimumBalanceForRentExemption(0, 'finalized');
      if (remaining > rentReserve + 20_000) {
        const returnedLamports = remaining - rentReserve - 10_000;
        const signature = await finalizedTransaction([
          SystemProgram.transfer({ fromPubkey:payer.publicKey, toPubkey:qaFunder.publicKey, lamports:returnedLamports }),
        ], [payer]);
        console.log(JSON.stringify({ status:'qa-funds-returned', payer:payer.publicKey.toBase58(),
          source:qaFunder.publicKey.toBase58(), returnedLamports, signature }));
      }
    } catch (error) {
      console.error(JSON.stringify({ status:'qa-funds-return-blocked', payer:payer.publicKey.toBase58(),
        error:String(error.message || error), pendingSignature:evidence.pendingSignature || null }));
    }
  }
}
