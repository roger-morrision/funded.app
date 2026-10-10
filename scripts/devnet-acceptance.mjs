/** Live Devnet-only checks. Saved test keys are read only with an explicit --wallet path. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import bs58 from 'bs58';
import { Connection, Keypair, PublicKey, SystemProgram, Transaction } from '@solana/web3.js';
import { OnlinePumpSdk, PUMP_SDK, PUMP_PROGRAM_ID } from '@pump-fun/pump-sdk';
import { NATIVE_MINT, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { buildTradeTransaction } from '../pump-trading.js';
import { buildMintRouterInitializeInstruction } from '../mint-router-launch.js';
import { verifyFeeRouterAccount, verifyMintFeeRouterAccount } from '../fee-router.js';

export const DEVNET_GENESIS = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
const DEFAULT_PROGRAM = '2tRrwGFzRCDmrVY7U6dny4Ea1RqVm7cSrCYFULmK7tik';
export function assertDevnet(genesis) {
  assert.equal(genesis, DEVNET_GENESIS, 'RPC genesis is not Solana Devnet; no faucet or transaction is permitted.');
}
export function assertFinalized(status) {
  assert(status && status.confirmationStatus === 'finalized' && status.err === null, 'A finalized, error-free transaction is required.');
}
const delay = milliseconds => new Promise(resolveDelay => setTimeout(resolveDelay, milliseconds));

/** Resolve only an explicitly selected test key, after validating the live network. */
export async function prepareAcceptancePayer({ connection, walletFile = null, readWalletFile = readFile }) {
  assertDevnet(await connection.getGenesisHash());
  if (!walletFile) return { payer: Keypair.generate(), prefunded: false, source: 'ephemeral-faucet', balanceLamports: 0 };
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


export async function runAcceptance({ execute = false, output, rpcUrl = 'https://api.devnet.solana.com', appOrigin = 'https://funded.vip', programId = DEFAULT_PROGRAM, walletFile = null, feeRecipientAddress = null, manualFundingWaitSeconds = 0 } = {}) {
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
  const connection = new Connection(rpcUrl, { commitment: 'finalized', fetch: (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(25_000) }), disableRetryOnRateLimit: true });
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
    stage = walletFile ? 'prefunded-test-payer' : manualFundingWaitSeconds ? 'manual-funding' : 'ephemeral-faucet';
    const preparedPayer = await prepareAcceptancePayer({ connection, walletFile });
    const { payer } = preparedPayer;
    const mint = Keypair.generate();
    const feeRecipient = feeRecipientAddress ? new PublicKey(feeRecipientAddress) : Keypair.generate().publicKey;
    assert(!feeRecipient.equals(payer.publicKey), 'Fee recipient must differ from payer for exact fee delta verification.');
    evidence.wallets = { payer: payer.publicKey.toBase58(), mint: mint.publicKey.toBase58(), feeRecipient: feeRecipient.toBase58(), payerSource: preparedPayer.source, privateKeyPersistence: walletFile ? 'payer loaded from explicit test keyfile; mint process memory only' : 'none; process memory only' };
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
    // This isolated SDK path tests chain adapters. Public registration and the app's atomic
    // community-reserve launch require their own configured application acceptance run.
    stage = 'fee-recipient-funding';
    const feeRecipientBalance = await connection.getBalance(feeRecipient, 'finalized');
    if (feeRecipientBalance < 1_000_000) {
      await send(stage, [SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: feeRecipient, lamports: 1_000_000 - feeRecipientBalance })], [payer]);
    } else {
      record(stage, 'passed', { address: feeRecipient.toBase58(), balanceLamports: feeRecipientBalance, fundingRequired: false });
    }
    stage = 'mint-router';
    const mintRouter = buildMintRouterInitializeInstruction({ programId: program, mint: mint.publicKey, payer: payer.publicKey });
    await send(stage, [mintRouter.instruction], [payer, mint]);
    const verified = await verifyMintFeeRouterAccount({ connection, programId: program, mint: mint.publicKey, expectedAuthority: router.authority });
    assert(verified.verified, verified.reason);
    stage = 'isolated-pump-launch';
    const instruction = await PUMP_SDK.createV2Instruction({ mint: mint.publicKey, name: 'Disposable Devnet QA', symbol: 'DQA', uri: 'https://example.invalid/disposable-devnet-test', creator: verified.address, user: payer.publicKey, mayhemMode: false, holderReward: false });
    await send(stage, [instruction], [payer, mint]);
    const sdk = new OnlinePumpSdk(connection);
    assert((await sdk.fetchBondingCurve(mint.publicKey)).creator.equals(verified.address), 'Pump creator does not match the mint router.');
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
      await send(stage, trade.instructions, [payer]);
      assert.equal(await connection.getBalance(feeRecipient, 'finalized') - prior, trade.feeLamports, 'App trade fee recipient delta differs from quote.');
      record(`${side}-fee-delta`, 'passed', { lamports: trade.feeLamports });
    }
    const tokens = await connection.getParsedTokenAccountsByOwner(payer.publicKey, { mint: mint.publicKey }, 'finalized');
    assert(tokens.value.every(row => row.account.data.parsed.info.tokenAmount.amount === '0'), 'Sell left token inventory.');
    stage = 'creator-fee-collection';
    const before = await connection.getBalance(verified.address, 'finalized');
    const collection = await sdk.collectCoinCreatorFeeV2Instructions(verified.address, NATIVE_MINT, TOKEN_PROGRAM_ID, payer.publicKey);
    assert(collection.length, 'Creator-fee collection instructions missing.');
    await send(stage, collection, [payer]);
    const delta = await connection.getBalance(verified.address, 'finalized') - before;
    assert(delta > 0, 'Creator-fee collection did not credit the router.');
    record('creator-fee-delta', 'passed', { lamports: delta });
    evidence.coverage.isolatedChainLaunchTradeCollection = true;
    evidence.blockers.push('Allocation, claims, holder payouts, buyback, community reserve/claim and graduation are not verified by this isolated flow. They require configured application services and authorized isolated custody signers.');
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
  const result = await runAcceptance({ feeRecipientAddress: feeRecipientFlag?.slice(16) || null, walletFile: walletFlag?.slice(9) || null, manualFundingWaitSeconds: manualFundingFlag ? Number(manualFundingFlag.slice(30)) : 0, execute: flags.includes('--execute'), output: flags.find(flag => flag.startsWith('--output='))?.slice(9) || 'docs/audit/devnet-2026-10-04/live-acceptance.json' });
  process.exitCode = result.status === 'passed' ? 0 : 2;
}
