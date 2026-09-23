import { createHash } from 'node:crypto';
import { PublicKey, Transaction, sendAndConfirmTransaction } from '@solana/web3.js';
import { getAssociatedTokenAddressSync, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { buildTradeTransaction } from '../pump-trading.js';

export function validateBuyAndDistributePolicy(input = {}) {
  const slippagePercent = Number(input.slippagePercent ?? 1);
  const maxPriceImpactPercent = Number(input.maxPriceImpactPercent ?? 3);
  const budgetLamports = BigInt(String(input.budgetLamports || '0'));
  const maxBudgetLamports = BigInt(String(input.maxBudgetLamports || '0'));
  const valid = input.enabled === true && budgetLamports > 0n && maxBudgetLamports > 0n && budgetLamports <= maxBudgetLamports && Number.isFinite(slippagePercent) && slippagePercent > 0 && slippagePercent <= 5 && Number.isFinite(maxPriceImpactPercent) && maxPriceImpactPercent > 0 && maxPriceImpactPercent <= 10;
  return { valid, slippagePercent, maxPriceImpactPercent, budgetLamports, maxBudgetLamports, reason: valid ? null : 'Buy-and-distribute requires explicit enablement, a bounded budget, slippage at most 5%, and price impact at most 10%.' };
}

function orderId({ mint, budgetLamports, sourceId }) {
  return createHash('sha256').update(`funded-buy-distribute-v1:${mint}:${budgetLamports}:${sourceId}`).digest('hex');
}

export function estimateBuyPriceImpactPercent(trade, amountSol) {
  const reserveSol = Number(trade?.route === 'graduated-pool' ? trade?.snapshot?.swapQuoteReservesSol : trade?.snapshot?.virtualQuoteReservesSol);
  return Number.isFinite(reserveSol) && reserveSol > 0 ? Number(amountSol) / reserveSol * 100 : Infinity;
}

async function finalizedSend(connection, transaction, signer) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const fresh = new Transaction().add(...transaction.instructions);
    if (transaction.feePayer) fresh.feePayer = transaction.feePayer;
    try {
      const signature = await sendAndConfirmTransaction(connection, fresh, [signer], { commitment: 'finalized', preflightCommitment: 'confirmed' });
      const status = await connection.getSignatureStatus(signature, { searchTransactionHistory: true });
      if (!status?.value || status.value.err || status.value.confirmationStatus !== 'finalized') throw new Error('Buy transaction did not finalize successfully.');
      return signature;
    } catch (error) {
      lastError = error;
      const message = String(error?.message || error);
      if (attempt === 2 || !/blockhash not found|429|too many requests/i.test(message)) throw error;
      await new Promise(resolveWait => setTimeout(resolveWait, 500 * (attempt + 1)));
    }
  }
  throw lastError;
}

export function createBuyAndDistributeExecutor({ connection, authority, feeOwner, feeBps, store, rewardChain, scheduler }) {
  async function execute(input) {
    const policy = validateBuyAndDistributePolicy(input);
    if (!policy.valid) throw new Error(policy.reason);
    if (!String(input.sourceId || '').trim()) throw new Error('A deterministic buy-and-distribute source ID is required.');
    const readiness = await rewardChain.readiness();
    if (!readiness.constrainedPayouts) throw new Error(`Reward payout contract is unavailable: ${(readiness.reasons || []).join(', ')}`);
    const mint = new PublicKey(input.mint), id = orderId({ mint: mint.toBase58(), budgetLamports: policy.budgetLamports, sourceId: input.sourceId });
    const claimed = await store.transaction(state => {
      state.buyOrders ||= {};
      const prior = state.buyOrders[id];
      if (prior) return { execute: false, order: structuredClone(prior) };
      const order = { id, mint: mint.toBase58(), sourceId: String(input.sourceId), budgetLamports: String(policy.budgetLamports), status: 'executing-buy', createdAt: new Date().toISOString() };
      state.buyOrders[id] = order;
      return { execute: true, order: structuredClone(order) };
    });
    if (!claimed.execute) return claimed.order;
    try {
      const mintAccount = await connection.getAccountInfo(mint, 'finalized');
      if (!mintAccount || (!mintAccount.owner.equals(TOKEN_PROGRAM_ID) && !mintAccount.owner.equals(TOKEN_2022_PROGRAM_ID))) throw new Error('Buy target is not a finalized supported SPL mint.');
      const tokenProgram = mintAccount.owner;
      const recipientToken = getAssociatedTokenAddressSync(mint, authority.publicKey, false, tokenProgram);
      const before = await connection.getTokenAccountBalance(recipientToken, 'finalized').then(row => BigInt(row.value.amount)).catch(() => 0n);
      const amountSol = Number(policy.budgetLamports) / 1_000_000_000;
      if (!Number.isSafeInteger(Number(policy.budgetLamports))) throw new Error('Buy budget exceeds safe transaction precision.');
      const trade = await buildTradeTransaction({ connection, side: 'buy', mint, user: authority.publicKey, amount: amountSol, slippagePercent: policy.slippagePercent, feeOwner, feeBps });
      const estimatedImpact = estimateBuyPriceImpactPercent(trade, amountSol);
      if (!Number.isFinite(estimatedImpact) || estimatedImpact > policy.maxPriceImpactPercent) throw new Error(`Estimated price impact ${estimatedImpact.toFixed(2)}% exceeds policy.`);
      const latest = await connection.getLatestBlockhash('finalized');
      const transaction = new Transaction({ feePayer: authority.publicKey, recentBlockhash: latest.blockhash }).add(...trade.instructions);
      const signature = await finalizedSend(connection, transaction, authority);
      const after = BigInt((await connection.getTokenAccountBalance(recipientToken, 'finalized')).value.amount), acquired = after - before;
      const minimum = BigInt(trade.minimumOutputAmount?.toString?.() || trade.outputAmount.toString());
      if (acquired <= 0n || acquired < minimum) throw new Error('Buy finalized without the minimum expected token balance delta.');
      await store.transaction(state => { state.buyOrders[id] = { ...state.buyOrders[id], status: 'bought', buySignature: signature, acquiredAmount: String(acquired), tokenAccount: recipientToken.toBase58(), balanceDeltaVerified: true, boughtAt: new Date().toISOString() }; });
      const funding = await rewardChain.fundTokenVault({ mint: mint.toBase58(), asset: mint.toBase58(), amount: String(acquired), decimals: trade.tokenDecimals });
      const pool = await scheduler.recordFundedPool({ id: `buy:${id}`, mint: mint.toBase58(), asset: mint.toBase58(), amount: String(acquired), fundingSignature: funding.signature || signature, balanceDeltaVerified: funding.balanceDeltaVerified, fundedAt: Math.floor(Date.now() / 1000) });
      return store.transaction(state => {
        state.buyOrders[id] = { ...state.buyOrders[id], status: 'funded-for-distribution', fundingSignature: funding.signature, poolId: pool.id, fundedAt: new Date().toISOString() };
        return structuredClone(state.buyOrders[id]);
      });
    } catch (error) {
      await store.transaction(state => { state.buyOrders[id] = { ...state.buyOrders[id], status: 'verification-pending', reason: String(error.message || error), lastAttemptAt: new Date().toISOString() }; });
      throw error;
    }
  }
  return { execute };
}
