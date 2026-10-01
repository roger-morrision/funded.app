import { createHash } from 'node:crypto';
import bs58 from 'bs58';
import { Connection, PublicKey, SystemProgram, Transaction, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import { createBurnCheckedInstruction, getAssociatedTokenAddressSync, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { BUYBACK_POLICY, evaluateBuybackBatch } from '../buyback-policy.js';
import { buildVerifiedPoolTradeTransaction } from '../pump-trading.js';
import { verifyMintFeeRouterAccount } from '../fee-router.js';
import { buildMintRouterSettlementInstruction, readMintClaimRecord } from './mint-router-payout.mjs';
import { readProgramDataEvidence } from './automatic-reward-chain.mjs';

const LAMPORTS = 1_000_000_000n;
const MAX_TRANSACTION_BYTES = 1232;

export function verifiedBuybackAccruals(state) {
  return Object.values(state.settlements || {}).flatMap(settlement => {
    const collection = state.collections?.[settlement.claimSignature];
    const launch = collection?.mint && state.launches?.[collection.mint];
    if (!collection || collection.status !== 'collected' || collection.attribution !== 'mint-verified' || collection.cluster !== 'devnet'
      || collection.signature !== settlement.claimSignature || !launch?.onchainVerified || launch.cluster !== 'devnet'
      || launch.pumpFeeRoute?.scope !== 'per-mint-v2' || launch.pumpFeeRoute?.router !== launch.creator) return [];
    const gross = Number(collection.collectedLamports);
    const allocation = Number(settlement.fundedApp?.buyback);
    if (!Number.isSafeInteger(gross) || gross <= 0 || !Number.isFinite(allocation) || allocation <= 0) return [];
    const lamports = Math.round(allocation * 1_000_000_000);
    if (!Number.isSafeInteger(lamports) || Math.abs(lamports - Math.round(gross / 100)) > 1) return [];
    return [{ id: settlement.claimSignature, mint: collection.mint, router: launch.creator, lamports: String(lamports), claimedAt: settlement.claimedAt || collection.recordedAt }];
  });
}

export function buybackQueue(state, now = new Date()) {
  const orders = Object.values(state.buybackOrders || {});
  const groups = new Map();
  for (const accrual of verifiedBuybackAccruals(state)) {
    const group = groups.get(accrual.mint) || { mint: accrual.mint, router: accrual.router, accrualIds: [], accruedLamports: 0n, oldestPendingAt: accrual.claimedAt };
    group.accrualIds.push(accrual.id);
    group.accruedLamports += BigInt(accrual.lamports);
    if (Date.parse(accrual.claimedAt) < Date.parse(group.oldestPendingAt)) group.oldestPendingAt = accrual.claimedAt;
    groups.set(accrual.mint, group);
  }
  return [...groups.values()].map(group => {
    const mintOrders = orders.filter(order => order.mint === group.mint);
    const reserved = mintOrders.filter(order => ['submitted', 'burn-finalized-refund-pending', 'finalized'].includes(order.status)).reduce((sum, order) => sum + BigInt(order.settledLamports) - BigInt(order.refundVerified ? order.returnedLamports || '0' : '0'), 0n);
    const pending = group.accruedLamports - reserved;
    if (pending < 0n) throw new Error('Buyback settled amount exceeds verified accruals.');
    const qaWaitSeconds = Number(process.env.FUNDED_QA_BUYBACK_WAIT_SECONDS);
    const qaWaitEnabled = process.env.SOLANA_CLUSTER === 'devnet' && process.env.FUNDED_QA_BUYBACK_MINT === group.mint
      && Number.isSafeInteger(qaWaitSeconds) && qaWaitSeconds >= 60 && qaWaitSeconds <= 21_600;
    const policy = evaluateBuybackBatch({ pendingAmount: Number(pending) / Number(LAMPORTS), oldestPendingAt: group.oldestPendingAt,
      now: now.toISOString(), maximumWaitHours: qaWaitEnabled ? qaWaitSeconds / 3600 : BUYBACK_POLICY.maximumWaitHours });
    const residue = mintOrders.some(order => order.status === 'finalized') && pending < 10_000n;
    return { mint: group.mint, router: group.router, accrualIds: group.accrualIds.sort(), accruedLamports: String(group.accruedLamports), reservedLamports: String(reserved), pendingLamports: String(pending), oldestPendingAt: group.oldestPendingAt, eligible: policy.eligible && !residue, reason: residue ? 'rounding-residue-awaiting-next-accrual' : policy.reason, activeOrder: mintOrders.find(order => ['submitted','burn-finalized-refund-pending'].includes(order.status))?.id || null };
  });
}

function orderId(row) {
  return createHash('sha256').update(`funded.buyback.order.v1:${row.mint}:${row.accrualIds.join(',')}:${row.reservedLamports}`).digest('hex');
}

function tradeAmountLamports(pending) {
  // Leave room for both maximum swap slippage and the app trade fee.
  return pending * 10_000n / (10_000n + BigInt(BUYBACK_POLICY.maximumSlippageBps) + 100n);
}

export function createDevnetBuybackExecutor({ store, rpcUrl, programId, programDataSha256, fundedMint, poolAddress, authority, operator, lookupTableAddress, feeOwner, feeBps = 50, enabled = false }) {
  const connection = new Connection(rpcUrl, 'confirmed');

  async function refundUnspent(order) {
    if (!['burn-finalized-refund-pending', 'finalized'].includes(order.status) || order.refundVerified) return order;
    const [purchase, parsed] = await Promise.all([
      connection.getTransaction(order.signature, { commitment:'finalized', maxSupportedTransactionVersion:0 }),
      connection.getParsedTransaction(order.signature, { commitment:'finalized', maxSupportedTransactionVersion:0 }),
    ]);
    if (!purchase || !parsed || purchase.meta?.err || parsed.meta?.err) throw new Error('Buyback refund requires the finalized purchase transaction.');
    const keys = purchase.transaction.message.getAccountKeys({ accountKeysFromLookups:purchase.meta.loadedAddresses });
    const indexOf = key => Array.from({ length:keys.length }, (_, index) => keys.get(index)).findIndex(item => item.toBase58() === key);
    const operatorIndex = indexOf(operator.publicKey.toBase58());
    if (operatorIndex < 0) throw new Error('Buyback operator is absent from the finalized purchase.');
    const fundedAccounts = new Set();
    for (const instruction of parsed.meta.innerInstructions?.flatMap(group => group.instructions) || []) {
      if (instruction.program !== 'system' || !['createAccount','createAccountWithSeed'].includes(instruction.parsed?.type)) continue;
      const info = instruction.parsed.info;
      if (info.source === operator.publicKey.toBase58()) {
        if (!info.newAccount) throw new Error('Cannot attribute buyback operator rent.');
        fundedAccounts.add(info.newAccount);
      }
    }
    const retainedRent = [...fundedAccounts].reduce((sum, key) => {
      const index = indexOf(key);
      if (index < 0) throw new Error('Operator-funded account is absent from finalized balances.');
      return sum + BigInt(purchase.meta.postBalances[index] - purchase.meta.preBalances[index]);
    }, 0n);
    const operatorDelta = BigInt(purchase.meta.postBalances[operatorIndex] - purchase.meta.preBalances[operatorIndex]);
    const surplus = operatorDelta + BigInt(purchase.meta.fee) + retainedRent;
    if (surplus < 0n || surplus > BigInt(order.settledLamports)) throw new Error('Buyback operator settlement has an unverified SOL surplus or shortfall.');
    if (surplus === 0n) return store.update(state => {
      const current = state.buybackOrders[order.id];
      state.buybackOrders[order.id] = { ...current, status:'finalized', returnedLamports:'0', refundVerified:true, refundAt:new Date().toISOString() };
      return structuredClone(state.buybackOrders[order.id]);
    });
    let current = (await store.read()).buybackOrders?.[order.id];
    if (!current.refundSignature) {
      const blockhash = await connection.getLatestBlockhash('finalized');
      const transaction = new Transaction({ feePayer:operator.publicKey, recentBlockhash:blockhash.blockhash }).add(SystemProgram.transfer({ fromPubkey:operator.publicKey, toPubkey:new PublicKey(order.router), lamports:Number(surplus) }));
      transaction.sign(operator);
      const signed = transaction.serialize();
      const refundSignature = bs58.encode(transaction.signature);
      current = await store.update(state => {
        const prior = state.buybackOrders?.[order.id];
        if (!prior || prior.refundSignature || prior.refundVerified) return prior;
        state.buybackOrders[order.id] = { ...prior, status:'burn-finalized-refund-pending', refundSignature, refundTransaction:signed.toString('base64'), refundLastValidBlockHeight:blockhash.lastValidBlockHeight, refundLamports:String(surplus) };
        return structuredClone(state.buybackOrders[order.id]);
      });
      if (current.refundSignature === refundSignature) await connection.sendRawTransaction(signed, { skipPreflight:false, maxRetries:3 });
    }
    if (BigInt(current.refundLamports) !== surplus) throw new Error('Persisted buyback refund conflicts with finalized purchase accounting.');
    const refund = await connection.getTransaction(current.refundSignature, { commitment:'finalized', maxSupportedTransactionVersion:0 });
    if (!refund) {
      const status = await connection.getSignatureStatus(current.refundSignature, { searchTransactionHistory:true });
      if (!status?.value && current.refundTransaction && await connection.getBlockHeight('confirmed') < current.refundLastValidBlockHeight) await connection.sendRawTransaction(Buffer.from(current.refundTransaction, 'base64'), { skipPreflight:false, maxRetries:3 }).catch(() => {});
      return { ...current, reason:status?.value?.err ? 'refund-failed-requires-reconciliation' : 'refund-awaiting-finality' };
    }
    if (refund.meta?.err) throw new Error('Finalized buyback refund failed and requires operator reconciliation.');
    const refundKeys = refund.transaction.message.getAccountKeys().staticAccountKeys;
    const routerIndex = refundKeys.findIndex(key => key.toBase58() === order.router);
    if (routerIndex < 0 || BigInt(refund.meta.postBalances[routerIndex] - refund.meta.preBalances[routerIndex]) !== surplus) throw new Error('Buyback refund did not credit the source router by the exact unspent amount.');
    return store.update(state => {
      const prior = state.buybackOrders?.[order.id];
      if (!prior || prior.refundSignature !== current.refundSignature) throw new Error('Buyback refund changed during finalization.');
      state.buybackOrders[order.id] = { ...prior, status:'finalized', returnedLamports:String(surplus), refundVerified:true, refundAt:new Date().toISOString() };
      return structuredClone(state.buybackOrders[order.id]);
    });
  }
  async function status() {
    const state = await store.read();
    return { cluster: 'devnet', enabled, route: 'atomic-mint-router-payout-pumpswap-buy-burn', custody: 'per-mint-fee-router-pda-before-execution', productionReady: false, pending: buybackQueue(state), receipts: Object.values(state.buybackOrders || {}).filter(row => row.status === 'finalized' && row.refundVerified).map(({ signedTransaction, refundTransaction, ...row }) => row) };
  }

  async function reconcile(order) {
    if (order.status !== 'submitted') return order;
    const [signatureStatus, claim, tx] = await Promise.all([
      connection.getSignatureStatus(order.signature, { searchTransactionHistory: true }),
      connection.getAccountInfo(new PublicKey(order.claim), 'finalized'),
      connection.getTransaction(order.signature, { commitment: 'finalized', maxSupportedTransactionVersion: 0 }),
    ]);
    if (!signatureStatus?.value || signatureStatus.value.confirmationStatus !== 'finalized' || signatureStatus.value.err || !tx || tx.meta?.err) {
      if (!signatureStatus?.value && !claim && order.signedTransaction && await connection.getBlockHeight('confirmed') < order.lastValidBlockHeight) await connection.sendRawTransaction(Buffer.from(order.signedTransaction, 'base64'), { skipPreflight:false, maxRetries:3 }).catch(() => {});
      return { ...order, status: 'submitted', reason: signatureStatus?.value?.err ? 'transaction-failed-requires-reconciliation' : 'awaiting-finality' };
    }
    const matches = readMintClaimRecord(claim, { programId, mint: order.mint, recipient: operator.publicKey, amountLamports: order.settledLamports, claimId: Buffer.from(order.claimId, 'hex') });
    if (!matches) throw new Error('Finalized buyback transaction lacks its exact mint-router claim record.');
    const keys = tx.transaction.message.getAccountKeys({ accountKeysFromLookups: tx.meta.loadedAddresses });
    const routerIndex = Array.from({ length:keys.length }, (_, index) => keys.get(index)).findIndex(key => key.toBase58() === order.router);
    if (routerIndex < 0 || BigInt(tx.meta.preBalances[routerIndex] - tx.meta.postBalances[routerIndex]) !== BigInt(order.settledLamports)) throw new Error('Finalized buyback router debit does not equal its verified accrual payout.');
    const afterSupply = BigInt((await connection.getTokenSupply(new PublicKey(fundedMint), 'finalized')).value.amount);
    const beforeSupply = BigInt(order.supplyBefore);
    const burned = BigInt(order.burnedBaseUnits);
    if (beforeSupply - afterSupply !== burned) throw new Error('Finalized buyback lacks the exact $FUNDED supply reduction; retain for manual reconciliation.');
    const receipt = { id: order.id, status: 'burn-finalized-refund-pending', signature: order.signature, mint: order.mint, accrualIds: order.accrualIds, router: order.router, claim: order.claim, settledLamports: order.settledLamports, boughtAndBurnedBaseUnits: order.burnedBaseUnits, tokenDecimals:order.tokenDecimals, fundedMint, poolAddress, supplyBefore: order.supplyBefore, supplyAfter: String(afterSupply), burnFinalizedAt: new Date().toISOString(), mode: 'devnet-atomic' };
    const recorded = await store.update(state => {
      const current = state.buybackOrders?.[order.id];
      if (!current || current.signature !== order.signature) throw new Error('Buyback order changed during finalization.');
      state.buybackOrders[order.id] = { ...current, ...receipt };
      return structuredClone(state.buybackOrders[order.id]);
    });
    return refundUnspent(recorded);
  }

  async function execute(mint) {
    if (!enabled) throw new Error('Devnet buyback executor is disabled.');
    if (!authority?.publicKey || !new PublicKey(authority.publicKey).equals(new PublicKey(process.env.FUNDED_REWARD_AUTHORITY || authority.publicKey))) throw new Error('Buyback authority does not match the configured reward authority.');
    if (!operator?.publicKey || operator.publicKey.equals(authority.publicKey)) throw new Error('A separate Devnet buyback operator signer is required by the mint router.');
    const genesis = await connection.getGenesisHash();
    if (genesis !== 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG') throw new Error('Buyback execution is Devnet-only.');
    const programEvidence = await readProgramDataEvidence(connection, new PublicKey(programId));
    if (!programEvidence.account?.executable || !programDataSha256 || programEvidence.sha256 !== String(programDataSha256).toLowerCase()) throw new Error('Mint-router program bytes do not match the approved Devnet deployment.');
    const state = await store.read();
    const existing = Object.values(state.buybackOrders || {}).find(row => row.mint === mint && ['submitted','burn-finalized-refund-pending'].includes(row.status));
    if (existing) return existing.status === 'submitted' ? reconcile(existing) : refundUnspent(existing);
    const row = buybackQueue(state).find(item => item.mint === mint);
    if (!row || !row.eligible || BigInt(row.pendingLamports) < 2n) throw new Error('No eligible, verified buyback accrual is available for this mint.');
    const id = orderId(row);
    const prior = state.buybackOrders?.[id];
    if (prior) return prior.status === 'submitted' ? reconcile(prior) : prior.status === 'burn-finalized-refund-pending' ? refundUnspent(prior) : prior;
    const router = await verifyMintFeeRouterAccount({ connection, programId, mint, expectedAuthority: authority.publicKey });
    if (!router.verified || router.address.toBase58() !== row.router) throw new Error('Buyback accrual router does not match the verified onchain mint router.');
    const mintKey = new PublicKey(fundedMint), mintInfo = await connection.getAccountInfo(mintKey, 'finalized');
    if (!mintInfo || (!mintInfo.owner.equals(TOKEN_PROGRAM_ID) && !mintInfo.owner.equals(TOKEN_2022_PROGRAM_ID))) throw new Error('Configured $FUNDED mint is not finalized or supported.');
    const budget = BigInt(row.pendingLamports);
    const desiredInput = tradeAmountLamports(budget);
    if (desiredInput < 1n || desiredInput > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Buyback quote input is outside safe bounds.');
    const quotedAt = Date.now();
    const trade = await buildVerifiedPoolTradeTransaction({ connection, side: 'buy', mint: mintKey, user: operator.publicKey, amount: Number(desiredInput) / Number(LAMPORTS), slippagePercent: BUYBACK_POLICY.maximumSlippageBps / 100, feeOwner, feeBps, poolAddress });
    if (trade.pool !== poolAddress || trade.outputAmount.lte(0)) throw new Error('Verified $FUNDED market quote is unavailable.');
    const settled = BigInt(trade.maximumInputAmount.toString()) + BigInt(trade.feeLamports.toString());
    if (settled > budget || settled <= 0n) throw new Error('Protected buyback quote exceeds verified fee accrual.');
    const liquidity = BigInt(Math.floor(Number(trade.snapshot?.swapQuoteReservesSol || 0) * Number(LAMPORTS)));
    if (liquidity <= 0n || desiredInput * 10_000n > liquidity * BigInt(BUYBACK_POLICY.maximumPriceImpactBps)
      || desiredInput * 10_000n > liquidity * BigInt(BUYBACK_POLICY.maximumLiquidityClipBps)) throw new Error('Buyback quote exceeds verified pool impact or liquidity limits.');
    if (Date.now() - quotedAt > 10_000) throw new Error('Buyback quote is stale.');
    const routerBalance = BigInt(await connection.getBalance(router.address, 'finalized'));
    const routerInfo = await connection.getAccountInfo(router.address, 'finalized');
    const rent = BigInt(await connection.getMinimumBalanceForRentExemption(routerInfo.data.length));
    if (routerBalance - rent < settled) throw new Error('Verified fee router lacks spendable buyback funds.');
    const settle = buildMintRouterSettlementInstruction({ programId, mint, authority: authority.publicKey, recipient: operator.publicKey, amountLamports: settled, obligationId: id, claimDomain: 'buyback' });
    if (await connection.getAccountInfo(settle.claim, 'finalized')) throw new Error('Buyback claim already exists and requires reconciliation.');
    const ata = getAssociatedTokenAddressSync(mintKey, operator.publicKey, false, mintInfo.owner);
    const burn = createBurnCheckedInstruction(ata, mintKey, operator.publicKey, BigInt(trade.outputAmount.toString()), trade.tokenDecimals, [], mintInfo.owner);
    const lookup = await connection.getAddressLookupTable(new PublicKey(lookupTableAddress), { commitment:'finalized' });
    if (!lookup.value || lookup.value.state.addresses.length < 10) throw new Error('Verified Devnet buyback address lookup table is unavailable.');
    if (await connection.getBalance(operator.publicKey, 'finalized') < 10_000_000) throw new Error('Devnet buyback operator lacks transaction/rent balance.');
    const blockhash = await connection.getLatestBlockhash('finalized');
    const message = new TransactionMessage({ payerKey:operator.publicKey, recentBlockhash:blockhash.blockhash, instructions:[settle.instruction, ...trade.instructions, burn] }).compileToV0Message([lookup.value]);
    const transaction = new VersionedTransaction(message);
    transaction.sign([operator, authority]);
    const signed = transaction.serialize();
    if (signed.length > MAX_TRANSACTION_BYTES) throw new Error('Atomic buyback transaction exceeds Solana size limit.');
    const simulation = await connection.simulateTransaction(transaction, { sigVerify: true, commitment: 'confirmed' });
    if (simulation.value.err) throw new Error(`Atomic buyback simulation failed: ${JSON.stringify(simulation.value.err)}`);
    const supplyBefore = BigInt((await connection.getTokenSupply(mintKey, 'finalized')).value.amount);
    const signature = bs58.encode(transaction.signatures[0]);
    const order = { id, mint, router: row.router, accrualIds: row.accrualIds, status: 'submitted', signature, claim: settle.claim.toBase58(), claimId: settle.claimId.toString('hex'), settledLamports: String(settled), quoteInputLamports: String(desiredInput), burnedBaseUnits: trade.outputAmount.toString(), tokenDecimals:trade.tokenDecimals, supplyBefore: String(supplyBefore), signedTransaction: signed.toString('base64'), lastValidBlockHeight: blockhash.lastValidBlockHeight, createdAt: new Date().toISOString() };
    // A signed transaction is durable before broadcast; an uncertain send can be reconciled by its claim PDA.
    const claimed = await store.update(current => {
      current.buybackOrders ||= {};
      if (current.buybackOrders[id] || Object.values(current.buybackOrders).some(item => item.mint === mint && ['submitted','burn-finalized-refund-pending'].includes(item.status))) return null;
      current.buybackOrders[id] = order;
      return structuredClone(order);
    });
    if (!claimed) throw new Error('Another buyback executor already claimed this mint.');
    await connection.sendRawTransaction(signed, { skipPreflight: false, maxRetries: 3 });
    await connection.confirmTransaction({ signature, ...blockhash }, 'finalized');
    return reconcile(order);
  }
  return { status, execute, reconcile, refundUnspent };
}
