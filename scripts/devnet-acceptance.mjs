/** Live Devnet-only checks. Saved test keys are read only with an explicit --wallet path. */
import assert from 'node:assert/strict';
import {createAcceptanceRpcFetch} from './devnet-acceptance-rpc.mjs';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import bs58 from 'bs58';
import { Connection, Keypair, PublicKey, SystemProgram, Transaction } from '@solana/web3.js';
import { OnlinePumpSdk, PUMP_SDK, PUMP_PROGRAM_ID } from '@pump-fun/pump-sdk';
import { NATIVE_MINT, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { buildTradeTransaction } from '../pump-trading.js';
import { submitPumpDevnetLaunch } from '../launch-flow.js';
import { newLaunchAgencySelection } from '../config/marketing-agency.js';
import { verifyFeeRouterAccount } from '../fee-router.js';

export const DEVNET_GENESIS = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
const DEFAULT_PROGRAM = '61EQ3onuS2jKzjUDhXdkwKNGiG8Djss3an5vPN3vwYYa';
/** Smallest community airdrop the launch policy accepts (30M of 1B tokens). */
export const V3_ACCEPTANCE_RESERVE_TOKENS = 30_000_000;

/** Signs launch steps with a local test keypair, the way a wallet adapter would. */
export function keypairProvider(payer) {
  const sign = transaction => {
    if (typeof transaction.version !== 'undefined' && typeof transaction.sign === 'function' && !('partialSign' in transaction)) transaction.sign([payer]);
    else transaction.partialSign(payer);
    return transaction;
  };
  return { publicKey: payer.publicKey, signTransaction: async transaction => sign(transaction),
    signAllTransactions: async transactions => transactions.map(sign) };
}

/** Read the live app's published V3 launch inputs, exactly as the launch page does. */
export async function loadV3LaunchInputs({ appOrigin, payer, fetchImpl = fetch }) {
  const read = async (path, init) => {
    const response = await fetchImpl(`${appOrigin}${path}`, { ...init, signal: AbortSignal.timeout(20_000) });
    const body = await response.json().catch(() => null);
    assert(response.ok && body, `${path} returned HTTP ${response.status}.`);
    return body;
  };
  const config = await read('/api/v3-launch-config');
  assert(config.ready === true && config.cluster === 'devnet', `V3 launches are not ready: ${(config.reasons || []).join('; ') || 'not devnet'}`);
  const reserveConfig = await read('/api/launch-reserve-config');
  assert.equal(reserveConfig.cluster, 'devnet', 'Launch reserve config is not Devnet.');
  assert.equal(reserveConfig.programId, config.programId, 'Reserve program differs from the V3 launch program.');
  const fees = await read('/api/service-fees');
  assert(fees.cluster === 'devnet' && /^[a-f0-9]{64}$/.test(fees.hash || ''), 'Service fee policy is unavailable.');
  // Public POSTs require the app's own origin, as the launch page sends it.
  const launchServiceQuote = await read('/api/launch-service-quote', { method: 'POST', headers: { 'content-type': 'application/json', origin: new URL(appOrigin).origin },
    body: JSON.stringify({ payer: payer.toBase58(), expectedHash: fees.hash }) });
  assert(launchServiceQuote.payer === payer.toBase58() && launchServiceQuote.policyHash === fees.hash, 'Launch service quote does not match the payer and policy.');
  const v3FeeRouter = { programId: config.programId, initialAuthority: config.initialAuthority, split: config.protocolSplit,
    ...(config.agency ? { agency: { ...config.agency, selectedAgents: newLaunchAgencySelection({ promotion: false }) } } : {}) };
  return { v3FeeRouter, reserveConfig, launchServiceQuote };
}

export function assertDevnet(genesis) {
  assert.equal(genesis, DEVNET_GENESIS, 'RPC genesis is not Solana Devnet; no faucet or transaction is permitted.');
}
export function assertFinalized(status) {
  assert(status && status.confirmationStatus === 'finalized' && status.err === null, 'A finalized, error-free transaction is required.');
}
const delay = milliseconds => new Promise(resolveDelay => setTimeout(resolveDelay, milliseconds));

/** Resolve only an explicitly selected test key, after validating the live network. */
export async function prepareAcceptancePayer({ connection, walletFile = null, ephemeralPayer = null, readWalletFile = readFile }) {
  assertDevnet(await connection.getGenesisHash());
  if (!walletFile) {
    const payer=ephemeralPayer || Keypair.generate();
    const balanceLamports=ephemeralPayer?await connection.getBalance(payer.publicKey,'finalized'):0;
    return {payer,prefunded:balanceLamports>=100_000_000,source:'ephemeral-memory',balanceLamports};
  }
  assert(typeof walletFile === 'string' && walletFile.trim(), 'An explicit test-wallet keyfile path is required.');
  let payer;
  try {
    const bytes = JSON.parse(await readWalletFile(resolve(walletFile), 'utf8'));
    assert(Array.isArray(bytes) && bytes.length === 64 && bytes.every(byte => Number.isInteger(byte) && byte >= 0 && byte <= 255));
    payer = Keypair.fromSecretKey(Uint8Array.from(bytes));
  } catch {
    // JSON/crypto parser errors can include key contents. Never propagate them.
    throw new Error('Explicit test-wallet keyfile must contain a valid 64-byte Solana keypair JSON array.');
  }
  const balanceLamports = await connection.getBalance(payer.publicKey, 'finalized');
  assert(Number.isSafeInteger(balanceLamports) && balanceLamports >= 100_000_000, 'Explicit test payer needs at least 0.1 finalized Devnet SOL; no faucet request or transaction was sent.');
  return { payer, prefunded: true, source: 'explicit-test-wallet', balanceLamports };
}


export async function runAcceptance({ execute = false, output, rpcUrl = 'https://api.devnet.solana.com', appOrigin = 'https://funded.vip', programId = DEFAULT_PROGRAM, walletFile = null, feeRecipientAddress = null, ephemeralPayer = null, manualFundingWaitSeconds = 0 } = {}) {
  assert(!ephemeralPayer || execute && !walletFile,'In-memory payer requires execution without a keyfile.');
  assert(!walletFile || execute, '--wallet is permitted only with --execute.');
  assert(Number.isSafeInteger(manualFundingWaitSeconds) && manualFundingWaitSeconds >= 0 && manualFundingWaitSeconds <= 900, 'Manual funding wait must be between 0 and 900 seconds.');
  assert(!manualFundingWaitSeconds || execute && !walletFile, 'Manual funding wait requires --execute with an ephemeral payer.');
  const evidence = { schemaVersion: 1, startedAt: new Date().toISOString(), mode: execute ? 'execute' : 'read-only', network: 'devnet', rpcOrigin: new URL(rpcUrl).origin, appOrigin: new URL(appOrigin).origin, checks: [], transactions: [], blockers: [], coverage: { fullApplicationJourney: false, mainnetReadiness: false } };
  const record = (name, status, details = {}) => {
    const check = { name, status, at: new Date().toISOString(), ...details };
    evidence.checks.push(check);
    console.log(JSON.stringify(check));
  };
  const safeError = error => String(error?.message || error).replaceAll(rpcUrl, new URL(rpcUrl).origin).slice(0, 700);
  const connection = new Connection(rpcUrl, { commitment: 'finalized', fetch:createAcceptanceRpcFetch(), disableRetryOnRateLimit: true });
  let stage = 'network';
  async function finalized(signature) {
    // HTTP polling works in managed environments without a WebSocket route.
    for (let poll = 0; poll < 60; poll += 1) {
      const status = (await connection.getSignatureStatuses([signature], { searchTransactionHistory: true })).value[0];
      if (status?.err) throw new Error(`Transaction failed: ${JSON.stringify(status.err)}`);
      if (status?.confirmationStatus === 'finalized') { assertFinalized(status); return status; }
      await delay(2_000);
    }
    throw new Error(`Finalization timed out for ${signature}; submission is uncertain and must not be retried blindly.`);
  }
  async function send(name, instructions, signers) {
    // Recheck the network immediately before each signed transaction.
    assertDevnet(await connection.getGenesisHash());
    const latest = await connection.getLatestBlockhash('confirmed');
    const transaction = new Transaction({ feePayer: signers[0].publicKey, recentBlockhash: latest.blockhash }).add(...instructions);
    transaction.sign(...signers);
    const signature = bs58.encode(transaction.signature);
    const receipt = { name, signature, explorer: `https://explorer.solana.com/tx/${signature}?cluster=devnet`, finalized: false };
    evidence.transactions.push(receipt);
    // Persist submission before waiting so interruptions do not erase evidence.
    await persist();
    try {
      const returnedSignature = await connection.sendRawTransaction(transaction.serialize(), { skipPreflight: false, preflightCommitment: 'confirmed', maxRetries: 2 });
      assert.equal(returnedSignature, signature, 'RPC returned a different transaction signature.');
    } catch (error) {
      receipt.submissionError = safeError(error);
      await persist();
      // The signed signature is known even after an ambiguous RPC error. Poll it,
      // never sign a replacement transaction that could duplicate this operation.
    }
    const status = await finalized(signature);
    receipt.finalized = true;
    receipt.slot = status.slot;
    record(name, 'passed', { signature, slot: status.slot });
    return signature;
  }
  async function persist() {
    if (!output) return;
    await mkdir(dirname(resolve(output)), { recursive: true });
    await writeFile(resolve(output), `${JSON.stringify(evidence, null, 2)}\n`);
  }
  try {
    const genesis = await connection.getGenesisHash();
    assertDevnet(genesis);
    record('network', 'passed', { genesis, finalizedSlot: await connection.getSlot('finalized') });
    stage = 'deployed-program';
    const program = new PublicKey(programId);
    const account = await connection.getAccountInfo(program, 'finalized');
    assert(account?.executable, 'Configured fee-router program is not executable on Devnet.');
    assert.equal(account.owner.toBase58(), 'BPFLoaderUpgradeab1e11111111111111111111111', 'Unexpected program loader.');
    assert.equal(account.data.readUInt32LE(0), 2, 'Expected upgradeable Program account.');
    const programDataAddress = new PublicKey(account.data.subarray(4, 36));
    const programData = await connection.getAccountInfo(programDataAddress, 'finalized');
    assert(programData && programData.owner.equals(account.owner) && programData.data.readUInt32LE(0) === 3, 'ProgramData ownership/layout is invalid.');
    record(stage, 'passed', { programId, programDataAddress: programDataAddress.toBase58(), programDataSha256: createHash('sha256').update(programData.data).digest('hex'), executableSha256: createHash('sha256').update(programData.data.subarray(45)).digest('hex'), upgradeAuthority: programData.data[12] === 1 ? new PublicKey(programData.data.subarray(13, 45)).toBase58() : null });
    stage = 'router-policy';
    const router = await verifyFeeRouterAccount({ connection, programId: program });
    assert(router.verified, router.reason);
    assert.notEqual(router.authority.toBase58(), 'B2Ns79FNQBseayg77fT7CvxQYs2NJ3DJBR3R1nDbwk3n', 'Router still uses the retired exposed authority.');
    record(stage, 'passed', { address: router.address.toBase58(), authority: router.authority.toBase58() });
    stage = 'pump-program';
    const pump = await connection.getAccountInfo(PUMP_PROGRAM_ID, 'finalized');
    assert(pump?.executable, 'Pump program is not executable on Devnet.');
    record(stage, 'passed', { programId: PUMP_PROGRAM_ID.toBase58() });
    stage = 'public-app';
    try {
      const response = await fetch(`${evidence.appOrigin}/api/health`, { signal: AbortSignal.timeout(20_000) });
      const body = await response.text();
      assert(response.ok, `Public health returned HTTP ${response.status}: ${body.slice(0, 150)}`);
      const health = JSON.parse(body);
      assert.equal(health.ok, true, 'App health did not report ok.');
      record(stage, 'passed', { httpStatus: response.status, cluster: health.launchPolicy?.cluster ?? null });
    } catch (error) {
      record(stage, 'blocked', { reason: safeError(error) });
      evidence.blockers.push('Public app health unavailable; metadata publishing, launch registration, claims and indexing require a reachable configured Devnet app.');
    }
    if (!execute) {
      record('live-transactions', 'not-run', { reason: 'Pass --execute to create ephemeral wallets and request faucet SOL.' });
      return evidence;
    }
    stage = walletFile ? 'prefunded-test-payer' : ephemeralPayer ? 'ephemeral-memory-payer' : manualFundingWaitSeconds ? 'manual-funding' : 'ephemeral-faucet';
    const preparedPayer = await prepareAcceptancePayer({ connection, walletFile, ephemeralPayer });
    const { payer } = preparedPayer;
    const feeRecipient = feeRecipientAddress ? new PublicKey(feeRecipientAddress) : Keypair.generate().publicKey;
    assert(!feeRecipient.equals(payer.publicKey), 'Fee recipient must differ from payer for exact fee delta verification.');
    evidence.wallets = { payer: payer.publicKey.toBase58(), mint: null, feeRecipient: feeRecipient.toBase58(), payerSource: preparedPayer.source, privateKeyPersistence: walletFile ? 'payer loaded from explicit test keyfile; mint process memory only' : 'none; process memory only' };
    let funded = preparedPayer.prefunded;
    if (funded) record(stage, 'passed', { payer: payer.publicKey.toBase58(), balanceLamports: preparedPayer.balanceLamports, faucetRequested: false });
    if (!funded && manualFundingWaitSeconds) {
      record(stage, 'awaiting-manual-funding', { payer: payer.publicKey.toBase58(), minimumLamports: 100_000_000, waitSeconds: manualFundingWaitSeconds, privateKeyPersistence: 'none' });
      const deadline = Date.now() + manualFundingWaitSeconds * 1_000;
      while (!funded && Date.now() < deadline) {
        await delay(Math.min(5_000, deadline - Date.now()));
        assertDevnet(await connection.getGenesisHash());
        funded = await connection.getBalance(payer.publicKey, 'finalized') >= 100_000_000;
      }
      if (funded) record(stage, 'passed', { payer: payer.publicKey.toBase58(), balanceLamports: await connection.getBalance(payer.publicKey, 'finalized'), faucetRequested: false });
    }
    if (!funded && !manualFundingWaitSeconds) {
      assertDevnet(await connection.getGenesisHash());
      const response = await fetch(rpcUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'requestAirdrop', params: [payer.publicKey.toBase58(), 1_000_000_000] }), signal: AbortSignal.timeout(25_000) });
      const payload = await response.json();
      if (!response.ok || payload.error) {
        record(stage, 'blocked', { httpStatus: response.status, rpcCode: payload.error?.code ?? null, reason: String(payload.error?.message || 'Faucet rejected request').slice(0, 500) });
      } else {
        assert.equal(typeof payload.result, 'string', 'Faucet did not return a signature.');
        evidence.transactions.push({ name: 'airdrop', signature: payload.result, finalized: false });
        await persist();
        const status = await finalized(payload.result);
        Object.assign(evidence.transactions.at(-1), { finalized: true, slot: status.slot });
        const balance = await connection.getBalance(payer.publicKey, 'finalized');
        assert(balance >= 100_000_000, 'Ephemeral payer has insufficient finalized funding.');
        record(stage, 'passed', { signature: payload.result, balanceLamports: balance });
        funded = true;
      }
    }
    if (!funded) {
      evidence.blockers.push(manualFundingWaitSeconds
        ? 'Ephemeral payer did not receive 0.1 finalized Devnet SOL before the manual funding window closed. No launch, trade, collection or payout was submitted.'
        : 'Official Devnet faucet rejected its single bounded request; ephemeral payer has no SOL. No launch, trade, collection or payout was submitted. Use --manual-funding-wait-seconds with an external Devnet top-up.');
      return evidence;
    }
    // Launches through the app's own V3 path (atomic community reserve, service fee, V3 router);
    // the coin is not registered with the app, so it stays out of public listings.
    stage = 'fee-recipient-funding';
    const feeRecipientBalance = await connection.getBalance(feeRecipient, 'finalized');
    if (feeRecipientBalance < 1_000_000) {
      await send(stage, [SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: feeRecipient, lamports: 1_000_000 - feeRecipientBalance })], [payer]);
    } else {
      record(stage, 'passed', { address: feeRecipient.toBase58(), balanceLamports: feeRecipientBalance, fundingRequired: false });
    }
    // Production V3 path: the same submitPumpDevnetLaunch the app runs, fed by the
    // live app's published V3, reserve and service-fee configuration.
    stage = 'v3-launch-config';
    const v3 = await loadV3LaunchInputs({ appOrigin: evidence.appOrigin, payer: payer.publicKey });
    record(stage, 'passed', { programId: v3.v3FeeRouter.programId, initialAuthority: v3.v3FeeRouter.initialAuthority,
      split: v3.v3FeeRouter.split, agencyRevision: v3.v3FeeRouter.agency?.configRevision ?? null,
      lookupTable: v3.reserveConfig.lookupTable, serviceFeeLamports: v3.launchServiceQuote.amountLamports });
    stage = 'v3-launch';
    const provider = keypairProvider(payer);
    const launched = await submitPumpDevnetLaunch({ cluster: 'devnet', connection, provider, payer: payer.publicKey,
      input: { name: 'Devnet acceptance QA', symbol: 'DAQA', supply: 1_000_000_000, decimals: 6, initialBuySol: 0,
        reserveTokens: V3_ACCEPTANCE_RESERVE_TOKENS,
        feeShares: { creatorWalletPercent: 80, holderAirdropPercent: 0, solClaimPercent: 0, xRecipient: '' } },
      feeRouterProgramId: v3.reserveConfig.programId, useMintRouter: true, v3FeeRouter: v3.v3FeeRouter,
      launchBurn: null, launchServiceQuote: v3.launchServiceQuote, reserveConfig: v3.reserveConfig,
      assertWalletCurrent: () => {}, onJournal: journal => { evidence.launchJournal=journal; }, onStatus: () => {} });
    const mint = launched.mint;
    const routerAddress = launched.feeRouter;
    evidence.wallets.mint = mint.publicKey.toBase58();
    evidence.transactions.push({ name: stage, signature: launched.signature, explorer: `https://explorer.solana.com/tx/${launched.signature}?cluster=devnet`, finalized: false });
    await persist();
    const launchStatus=await finalized(launched.signature);
    Object.assign(evidence.transactions.at(-1),{finalized:true,slot:launchStatus.slot});
    if (launched.mintRouterSignature) {
      const routerStatus=await finalized(launched.mintRouterSignature);
      evidence.transactions.push({ name:'v3-mint-router',signature:launched.mintRouterSignature,finalized:true,slot:routerStatus.slot });
    }
    record(stage, 'passed', { signature: launched.signature, mint: mint.publicKey.toBase58(), feeRouter: routerAddress.toBase58(),
      reserveVault: launched.reserveReceipt?.vault ?? null, separateRouterTransaction: Boolean(launched.mintRouterSignature) });
    await persist();
    const sdk = new OnlinePumpSdk(connection);
    assert((await sdk.fetchBondingCurve(mint.publicKey)).creator.equals(routerAddress), 'Pump creator does not match the V3 mint router.');
    for (const side of ['buy', 'sell']) {
      stage = side;
      const prior = await connection.getBalance(feeRecipient, 'finalized');
      let amount = 0.003;
      if (side === 'sell') {
        const tokens = await connection.getParsedTokenAccountsByOwner(payer.publicKey, { mint: mint.publicKey }, 'finalized');
        assert.equal(tokens.value.length, 1, 'Expected one bought token account.');
        const balance = tokens.value[0].account.data.parsed.info.tokenAmount;
        assert(BigInt(balance.amount) > 0n && BigInt(balance.amount) <= BigInt(Number.MAX_SAFE_INTEGER), 'Purchased token units outside safe range.');
        amount = Number(balance.amount) / (10 ** balance.decimals);
      }
      const trade = await buildTradeTransaction({ connection, side, mint: mint.publicKey, user: payer.publicKey, amount, slippagePercent: 3, feeOwner: feeRecipient });
      assert.equal(trade.feePolicy.feeBps,100,'Platform trade fee must remain 1%.');
      assert.equal(BigInt(trade.feeLamports),(BigInt(trade.quoteAmount.toString())+99n)/100n,'Platform fee must be the rounded-up 1% of the SOL quote.');
      await send(stage, trade.instructions, [payer]);
      assert.equal(await connection.getBalance(feeRecipient, 'finalized') - prior, trade.feeLamports, 'App trade fee recipient delta differs from quote.');
      record(`${side}-fee-delta`, 'passed', { lamports:trade.feeLamports,feeBps:trade.feePolicy.feeBps,quoteLamports:trade.quoteAmount.toString() });
    }
    const tokens = await connection.getParsedTokenAccountsByOwner(payer.publicKey, { mint: mint.publicKey }, 'finalized');
    assert(tokens.value.every(row => row.account.data.parsed.info.tokenAmount.amount === '0'), 'Sell left token inventory.');
    stage = 'creator-fee-collection';
    const before = await connection.getBalance(routerAddress, 'finalized');
    const collection = await sdk.collectCoinCreatorFeeV2Instructions(routerAddress, NATIVE_MINT, TOKEN_PROGRAM_ID, payer.publicKey);
    assert(collection.length, 'Creator-fee collection instructions missing.');
    await send(stage, collection, [payer]);
    const delta = await connection.getBalance(routerAddress, 'finalized') - before;
    assert(delta > 0, 'Creator-fee collection did not credit the router.');
    record('creator-fee-delta', 'passed', { lamports: delta });
    evidence.coverage.v3LaunchTradeCollection = true;
    evidence.notCovered = ['Allocation, claims, holder payouts, buyback, community claim and graduation are not verified by this flow. They require configured application services and authorized isolated custody signers.'];
  } catch (error) {
    record(stage, 'failed', { reason: safeError(error) });
    evidence.blockers.push(`${stage}: ${safeError(error)}`);
  } finally {
    evidence.finishedAt = new Date().toISOString();
    evidence.status = evidence.blockers.length ? 'blocked' : 'passed';
    await persist();
  }
  return evidence;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const flags = process.argv.slice(2);
  assert(flags.includes('--execute') !== flags.includes('--read-only'), 'Pass exactly one of --execute or --read-only.');
  assert(flags.every(flag => flag === '--execute' || flag === '--read-only' || flag.startsWith('--output=') || flag.startsWith('--wallet=') || flag.startsWith('--fee-recipient=') || flag.startsWith('--manual-funding-wait-seconds=')), 'Unknown argument.');
  const walletFlag = flags.find(flag => flag.startsWith('--wallet='));
  assert(!walletFlag || walletFlag.slice(9).trim(), '--wallet requires an explicit test keyfile path.');
  assert(flags.filter(flag => flag.startsWith('--wallet=')).length <= 1, 'Pass --wallet only once.');
  const feeRecipientFlag = flags.find(flag => flag.startsWith('--fee-recipient='));
  assert(!feeRecipientFlag || feeRecipientFlag.slice(16).trim(), '--fee-recipient requires a public address.');
  assert(flags.filter(flag => flag.startsWith('--fee-recipient=')).length <= 1, 'Pass --fee-recipient only once.');
  const manualFundingFlag = flags.find(flag => flag.startsWith('--manual-funding-wait-seconds='));
  assert(flags.filter(flag => flag.startsWith('--manual-funding-wait-seconds=')).length <= 1, 'Pass manual funding wait only once.');
  assert(!manualFundingFlag || /^[1-9]\d{0,2}$/.test(manualFundingFlag.slice(30)), 'Manual funding wait requires whole seconds from 1 to 900.');
  const result = await runAcceptance({ feeRecipientAddress: feeRecipientFlag?.slice(16) || null, walletFile: walletFlag?.slice(9) || null, manualFundingWaitSeconds: manualFundingFlag ? Number(manualFundingFlag.slice(30)) : 0, execute: flags.includes('--execute'), output: flags.find(flag => flag.startsWith('--output='))?.slice(9) || 'data/qa-evidence/devnet-acceptance/live-acceptance.json' });
  process.exitCode = result.status === 'passed' ? 0 : 2;
}
