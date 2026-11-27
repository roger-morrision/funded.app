import { randomBytes } from 'node:crypto';
import { PublicKey, Transaction, TransactionMessage, VersionedTransaction, ComputeBudgetProgram } from '@solana/web3.js';
import { sendAndConfirmSigned as sendAndConfirmTransaction, signTransaction } from './transaction-signing.mjs';
import { OnlinePumpSdk, creatorVaultPda } from '@pump-fun/pump-sdk';
import { OnlinePumpAmmSdk, PUMP_AMM_SDK, buyQuoteInput, coinCreatorVaultAuthorityPda, coinCreatorVaultAtaPda } from '@pump-fun/pump-swap-sdk';
import BN from 'bn.js';
import { selectV3PumpBuy } from './v3-buyback-setup.mjs';
import { deriveMintPolicyV3 } from '../mint-router-v3.js';
import { createAssociatedTokenAccountIdempotentInstruction, getAssociatedTokenAddressSync } from '@solana/spl-token';
import { buildTokenAccountSetupInstructions, buildTokenLedgerInitializeInstruction, buildTokenSettlementInstruction,
  buildTokenApprovalInstruction, buildTokenDisbursementInstruction, buildTokenConversionInstruction,
  deriveTokenAccountsV3, deriveTokenLedgerV3, deriveAgencyPolicyV3, deriveTokenConversionV3, deriveSolCreditV3,
  decodeTokenLedgerV3, decodeTokenConversionV3, decodeSolCreditV3 } from '../mint-router-v3-token.js';

// Cumulative boundary rounding can temporarily decrease one tiny category's
// target (for example 1 -> 0), which the deployed contract rejects. Settle the
// largest safe prefix and retain the remainder in the router for later fees.
export function safeTokenSettlementAmount({ settled, paid, units, available, agency, scanLimit = 10_000 }) {
  const rates = units.map(BigInt), prior = paid.map(BigInt), balance = BigInt(available), count = agency ? 8 : 7;
  if (rates.length !== count - 1 || prior.length < count || balance < 0n
    || rates.reduce((sum, value) => sum + value, 8_000_000n) !== 10_000_000n
    || prior.slice(0, count).reduce((sum, value) => sum + value, 0n) !== BigInt(settled))
    throw new Error('The token policy or settled ledger is inconsistent.');
  const targets = total => {
    let cumulative = 8_000_000n, previous = 0n;
    return Array.from({ length:count }, (_, index) => {
      if (index) cumulative += rates[index - 1];
      const boundary = total * cumulative / 10_000_000n, target = boundary - previous;
      previous = boundary;
      return target;
    });
  };
  for (let amount = balance, checked = 0; amount > 0n && checked < scanLimit; amount--, checked++) {
    if (targets(BigInt(settled) + amount).every((target, index) => target >= prior[index])) return amount;
  }
  return 0n;
}

// Keeper step for a coin paired with a token: make sure the router's and vaults'
// paired-token accounts and the coin's token ledger exist, collect Pump's
// creator fees in that token into the router, then settle them into the seven
// category vaults by the coin's policy. The keeper signs as router authority.
export async function collectAndSettleTokenFees({ connection, programId, keeper, mint, quoteMint, settle = true, collect = true }) {
  const quote = new PublicKey(quoteMint), coin = new PublicKey(mint), program = new PublicKey(programId);
  const quoteInfo = await connection.getAccountInfo(quote, 'finalized');
  if (!quoteInfo) throw new Error('Paired token not found.');
  const tokenProgram = quoteInfo.owner;
  const accounts = deriveTokenAccountsV3(program, coin, quote, tokenProgram);
  const ledger = deriveTokenLedgerV3(program, coin, quote);
  // Agency launches (all new launches) have an agency policy; older ones a protected policy.
  const agency = Boolean(await connection.getAccountInfo(deriveAgencyPolicyV3(program, coin), 'finalized'));
  // Only create the paired-token accounts that do not exist yet.
  const owned = [accounts.routerToken, ...accounts.vaultTokens];
  const present = await connection.getMultipleAccountsInfo(owned, 'finalized');
  const setup = buildTokenAccountSetupInstructions({ programId: program, mint: coin, quoteMint: quote, tokenProgram, payer: keeper.publicKey })
    .filter((_, index) => !present[index]);
  if (!await connection.getAccountInfo(ledger, 'finalized'))
    setup.push(buildTokenLedgerInitializeInstruction({ programId: program, mint: coin, quoteMint: quote, authority: keeper.publicKey, agency }));
  // PumpSwap fees (after migration) move to Pump's creator vault first; Pump's
  // collection then pays the router's paired-token account.
  const collectInstructions = collect ? await new OnlinePumpSdk(connection).collectCoinCreatorFeeV2Instructions(accounts.router, quote, tokenProgram, keeper.publicKey) : [];
  const ammVault = coinCreatorVaultAtaPda(coinCreatorVaultAuthorityPda(accounts.router), quote, tokenProgram);
  const ammAmount = collect ? await connection.getTokenAccountBalance(ammVault, 'finalized').then(row => BigInt(row.value.amount)).catch(() => 0n) : 0n;
  const transfer = ammAmount > 0n ? [await PUMP_AMM_SDK.transferCreatorFeesToPumpV2Instruction({ payer: keeper.publicKey, coinCreator: accounts.router, quoteMint: quote, quoteTokenProgram: tokenProgram })] : [];
  const before = await connection.getTokenAccountBalance(accounts.routerToken, 'finalized').then(row => BigInt(row.value.amount)).catch(() => 0n);
  // Account setup (nine token accounts and the ledger) is too large for one
  // transaction: send it in small batches, then collect.
  const setupSignatures = [];
  for (let index = 0; index < setup.length; index += 4)
    setupSignatures.push(await sendAndConfirmTransaction(connection, new Transaction().add(...setup.slice(index, index + 4)), [keeper], { commitment: 'finalized' }));
  const collectSignature = collect ? await sendAndConfirmTransaction(connection,
    new Transaction().add(ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }), ...transfer, ...collectInstructions), [keeper], { commitment: 'finalized' }) : null;
  const balance = BigInt((await connection.getTokenAccountBalance(accounts.routerToken, 'finalized')).value.amount);
  const result = { tokenProgram: tokenProgram.toBase58(), routerToken: accounts.routerToken.toBase58(), collectSignature,
    collected: String(balance - before), routerBalance: String(balance), settleSignature: null, settled: '0', deferred: '0', agency };
  if (!settle || balance === 0n) return result;
  const policyAddress = agency ? deriveAgencyPolicyV3(program, coin) : deriveMintPolicyV3(program, coin).address;
  const [policyInfo, ledgerInfo] = await connection.getMultipleAccountsInfo([policyAddress, ledger], 'finalized');
  if (!policyInfo?.owner.equals(program) || !ledgerInfo?.owner.equals(program)) throw new Error('The paired-token policy or ledger is unavailable.');
  const previous = decodeTokenLedgerV3(ledgerInfo.data), count = agency ? 7 : 6;
  const units = Array.from({ length:count }, (_, index) => BigInt(policyInfo.data.readUInt32LE(104 + index * 4)));
  const amount = safeTokenSettlementAmount({ settled:previous.settled, paid:previous.paid, units, available:balance, agency });
  result.deferred = String(balance - amount);
  if (amount === 0n) return result;
  const claimId = randomBytes(32);
  result.settleSignature = await sendAndConfirmTransaction(connection, new Transaction().add(
    buildTokenSettlementInstruction({ programId: program, mint: coin, quoteMint: quote, tokenProgram, authority: keeper.publicKey, claimId, amount, agency })),
  [keeper], { commitment: 'finalized' });
  const finalizedLedger = decodeTokenLedgerV3((await connection.getAccountInfo(ledger, 'finalized')).data);
  if (finalizedLedger.settled - previous.settled !== amount) throw new Error(`Finalized token settlement ${result.settleSignature} lacks the exact ledger delta.`);
  result.settled = String(amount);
  result.claimId = claimId.toString('hex');
  return result;
}

// Holder rewards in the paired token: pay the holders' part of the creator-
// directed budget (category 0, beneficiary 1) into the coin's reward vault token
// account, then enroll it with the holder scheduler as a funded pool of that
// token. Signed by the creator when given, otherwise by the automation record.
export async function fundTokenHolderRewards({ connection, programId, keeper, creator, creatorSigner = null, mint, quoteMint, amount, scheduler, activatedAt }) {
  const quote = new PublicKey(quoteMint), coin = new PublicKey(mint), program = new PublicKey(programId);
  const tokenProgram = (await connection.getAccountInfo(quote, 'finalized')).owner;
  const agency = Boolean(await connection.getAccountInfo(deriveAgencyPolicyV3(program, coin), 'finalized'));
  const [vault] = PublicKey.findProgramAddressSync([Buffer.from('reward-vault-v1'), keeper.publicKey.toBuffer(), coin.toBuffer()], program);
  if (!await connection.getAccountInfo(vault, 'finalized')) throw new Error('The coin has no reward vault.');
  const vaultToken = getAssociatedTokenAddressSync(quote, vault, true, tokenProgram);
  const ledgerAddress = deriveTokenLedgerV3(program, coin, quote);
  const ledger = decodeTokenLedgerV3((await connection.getAccountInfo(ledgerAddress, 'finalized')).data);
  const pay = BigInt(amount);
  if (pay <= 0n || pay > ledger.paid[0] - ledger.withdrawn[0]) throw new Error('The holder amount exceeds the creator-directed budget.');
  const before = await connection.getTokenAccountBalance(vaultToken, 'finalized').then(row => BigInt(row.value.amount)).catch(() => 0n);
  const signature = await sendAndConfirmTransaction(connection, new Transaction().add(
    createAssociatedTokenAccountIdempotentInstruction(keeper.publicKey, vaultToken, vault, quote, tokenProgram),
    buildTokenDisbursementInstruction({ programId: program, mint: coin, quoteMint: quote, tokenProgram, authority: keeper.publicKey, creator,
      automation: !creatorSigner, recipientOwner: vault, withdrawalId: randomBytes(32), category: 0, beneficiary: 1, amount: pay, holderAmount: pay, agency })),
  [keeper, ...(creatorSigner ? [creatorSigner] : [])], { commitment: 'finalized' });
  const after = BigInt((await connection.getTokenAccountBalance(vaultToken, 'finalized')).value.amount);
  const settled = decodeTokenLedgerV3((await connection.getAccountInfo(ledgerAddress, 'finalized')).data);
  if (after - before !== pay || settled.withdrawn[0] - ledger.withdrawn[0] !== pay
    || settled.released[1] - ledger.released[1] !== pay)
    throw new Error(`Finalized holder funding ${signature} lacks exact vault and ledger deltas.`);
  const fundedAt = Math.floor(Date.now() / 1000);
  if (scheduler) await scheduler.recordFundedPool({ id: `v3t:${signature}`, mint: coin.toBase58(), asset: quote.toBase58(), amount: String(pay),
    fundingSignature: signature, balanceDeltaVerified: true, fundedAt });
  return { signature, vault: vault.toBase58(), vaultToken: vaultToken.toBase58(), amount: String(pay), fundedAt, activatedAt };
}

// Paired-token creator fees waiting at Pump for this coin: the bonding-curve
// creator vault plus, after migration, PumpSwap's creator vault.
export async function pendingTokenFees({ connection, programId, mint, quoteMint, tokenProgram }) {
  const quote = new PublicKey(quoteMint), program = new PublicKey(programId);
  const owner = tokenProgram ? new PublicKey(tokenProgram) : (await connection.getAccountInfo(quote, 'finalized')).owner;
  const { router, routerToken } = deriveTokenAccountsV3(program, new PublicKey(mint), quote, owner);
  const read = account => connection.getTokenAccountBalance(account, 'finalized').then(row => BigInt(row.value.amount)).catch(() => 0n);
  const [curve, amm, unallocated] = await Promise.all([
    read(getAssociatedTokenAddressSync(quote, creatorVaultPda(router), true, owner)),
    read(coinCreatorVaultAtaPda(coinCreatorVaultAuthorityPda(router), quote, owner)), read(routerToken)]);
  return { curve, amm, total: curve + amm, unallocated, tokenProgram: owner.toBase58() };
}

// The creator-directed budget of a paired coin (category 0) split between the
// creator wallet, holders and the X account by the agency policy's directed
// units, against what the router has already released to each.
export async function readDirectedTokenBudget({ connection, programId, mint, quoteMint }) {
  const program = new PublicKey(programId), coin = new PublicKey(mint), quote = new PublicKey(quoteMint);
  const [policy, ledgerAccount] = await connection.getMultipleAccountsInfo(
    [deriveAgencyPolicyV3(program, coin), deriveTokenLedgerV3(program, coin, quote)], 'confirmed');
  if (!policy?.owner?.equals(program)) throw new Error('The coin has no agency policy.');
  if (!ledgerAccount) return null;
  const ledger = decodeTokenLedgerV3(ledgerAccount.data);
  const offset = 8 + 96 + 28 + 8 + 128;
  const units = [0, 1, 2].map(index => BigInt(policy.data.readUInt32LE(offset + index * 4)));
  let cumulative = 0n, prior = 0n;
  const targets = units.map(unit => { cumulative += unit; const bound = ledger.paid[0] * cumulative / 8_000_000n; const target = bound - prior; prior = bound; return target; });
  const owed = targets.map((target, index) => target > ledger.released[index] ? target - ledger.released[index] : 0n);
  return { units, targets, released: ledger.released, owed, available: ledger.paid[0] - ledger.withdrawn[0], ledger };
}

// Pays the creator wallet's part of the creator-directed budget (category 0,
// beneficiary 0) in the paired token, signed by the coin's automation record.
export async function payTokenCreatorWallet({ connection, programId, keeper, creator, mint, quoteMint, amount }) {
  const quote = new PublicKey(quoteMint), coin = new PublicKey(mint), program = new PublicKey(programId), owner = new PublicKey(creator);
  const tokenProgram = (await connection.getAccountInfo(quote, 'finalized')).owner;
  const pay = BigInt(amount);
  if (pay <= 0n) throw new Error('A positive creator payout is required.');
  const account = getAssociatedTokenAddressSync(quote, owner, false, tokenProgram);
  const ledgerAddress = deriveTokenLedgerV3(program, coin, quote);
  const ledger = decodeTokenLedgerV3((await connection.getAccountInfo(ledgerAddress, 'finalized')).data);
  const before = await connection.getTokenAccountBalance(account, 'finalized').then(row => BigInt(row.value.amount)).catch(() => 0n);
  const signature = await sendAndConfirmTransaction(connection, new Transaction().add(
    createAssociatedTokenAccountIdempotentInstruction(keeper.publicKey, account, owner, quote, tokenProgram),
    buildTokenDisbursementInstruction({ programId: program, mint: coin, quoteMint: quote, tokenProgram, authority: keeper.publicKey, creator: owner,
      automation: true, recipientOwner: owner, withdrawalId: randomBytes(32), category: 0, beneficiary: 0, amount: pay, agency: true })),
  [keeper], { commitment: 'finalized' });
  const after = BigInt((await connection.getTokenAccountBalance(account, 'finalized')).value.amount);
  const settled = decodeTokenLedgerV3((await connection.getAccountInfo(ledgerAddress, 'finalized')).data);
  if (after - before !== pay || settled.withdrawn[0] - ledger.withdrawn[0] !== pay
    || settled.released[0] - ledger.released[0] !== pay)
    throw new Error(`Finalized creator payout ${signature} lacks exact wallet and ledger deltas.`);
  return { signature, account: account.toBase58(), amount: String(pay) };
}

// The immutable automation record fixes operations and referral recipients.
// Approve and pay the exact remaining category budget in one finalized
// transaction; the on-chain ledger is the idempotency source on later ticks.
export async function payTokenProtocolBudget({ connection, programId, keeper, creator, mint, quoteMint, category, recipient, amount }) {
  if (!Number.isInteger(category) || category < 1 || category > 4) throw new Error('Only operations and referral token budgets use protocol payouts.');
  const program = new PublicKey(programId), coin = new PublicKey(mint), quote = new PublicKey(quoteMint);
  const owner = new PublicKey(recipient), creatorKey = new PublicKey(creator), pay = BigInt(amount);
  if (owner.equals(PublicKey.default) || owner.equals(creatorKey) || pay <= 0n) throw new Error('Invalid token protocol recipient or amount.');
  const ownerInfo = await connection.getAccountInfo(owner, 'finalized');
  if (ownerInfo && (!ownerInfo.owner.equals(PublicKey.default) || ownerInfo.data.length))
    throw new Error('The protocol recipient must be a plain system wallet.');
  const quoteInfo = await connection.getAccountInfo(quote, 'finalized');
  if (!quoteInfo) throw new Error('The paired token is unavailable.');
  const tokenProgram = quoteInfo.owner, accounts = deriveTokenAccountsV3(program, coin, quote, tokenProgram);
  const ledgerAddress = deriveTokenLedgerV3(program, coin, quote);
  const ledgerInfo = await connection.getAccountInfo(ledgerAddress, 'finalized');
  if (!ledgerInfo?.owner.equals(program)) throw new Error('The paired-token ledger is unavailable.');
  const beforeLedger = decodeTokenLedgerV3(ledgerInfo.data);
  if (pay > beforeLedger.paid[category] - beforeLedger.withdrawn[category]) throw new Error('The token protocol payout exceeds its category budget.');
  const destination = getAssociatedTokenAddressSync(quote, owner, false, tokenProgram);
  const balance = async (address, missingAllowed = false) => {
    try { return BigInt((await connection.getTokenAccountBalance(address, 'finalized')).value.amount); }
    catch (error) { if (missingAllowed && !await connection.getAccountInfo(address, 'finalized')) return 0n; throw error; }
  };
  const beforeVault = await balance(accounts.vaultTokens[category]), beforeRecipient = await balance(destination, true);
  const withdrawalId = randomBytes(32);
  const signature = await sendAndConfirmTransaction(connection, new Transaction().add(
    createAssociatedTokenAccountIdempotentInstruction(keeper.publicKey, destination, owner, quote, tokenProgram),
    buildTokenApprovalInstruction({ programId: program, mint: coin, quoteMint: quote, authority: keeper.publicKey,
      creator: creatorKey, recipient: owner, withdrawalId, category, beneficiary: category + 2, amount: pay, automation: true }),
    buildTokenDisbursementInstruction({ programId: program, mint: coin, quoteMint: quote, tokenProgram, authority: keeper.publicKey,
      creator: creatorKey, recipientOwner: owner, withdrawalId, category, beneficiary: category + 2, amount: pay, automation: true })),
  [keeper], { commitment: 'finalized' });
  const afterInfo = await connection.getAccountInfo(ledgerAddress, 'finalized');
  if (!afterInfo?.owner.equals(program)) throw new Error('The finalized token ledger disappeared.');
  const afterLedger = decodeTokenLedgerV3(afterInfo.data);
  const afterVault = await balance(accounts.vaultTokens[category]), afterRecipient = await balance(destination);
  if (afterLedger.withdrawn[category] - beforeLedger.withdrawn[category] !== pay || beforeVault - afterVault !== pay
    || afterRecipient - beforeRecipient !== pay)
    throw new Error(`Finalized token protocol payout ${signature} lacks exact ledger, vault and recipient deltas.`);
  return { signature, category, recipient: owner.toBase58(), amount: String(pay), quoteMint: quote.toBase58(),
    withdrawalId: withdrawalId.toString('hex'), balanceDeltaVerified: true };
}

async function tokenProtocolBudgetContext({ connection, programId, mint, quoteMint, category, recipient, creator, amount }) {
  if (!Number.isInteger(category) || category < 1 || category > 4) throw new Error('Only operations and referral token budgets use protocol payouts.');
  const program = new PublicKey(programId), coin = new PublicKey(mint), quote = new PublicKey(quoteMint);
  const owner = new PublicKey(recipient), creatorKey = new PublicKey(creator), pay = BigInt(amount);
  if (owner.equals(PublicKey.default) || owner.equals(creatorKey) || pay <= 0n) throw new Error('Invalid token protocol recipient or amount.');
  const ownerInfo = await connection.getAccountInfo(owner, 'finalized');
  if (ownerInfo && (!ownerInfo.owner.equals(PublicKey.default) || ownerInfo.data.length))
    throw new Error('The protocol recipient must be a plain system wallet.');
  const quoteInfo = await connection.getAccountInfo(quote, 'finalized');
  if (!quoteInfo) throw new Error('The paired token is unavailable.');
  const tokenProgram = quoteInfo.owner, accounts = deriveTokenAccountsV3(program, coin, quote, tokenProgram);
  const ledgerAddress = deriveTokenLedgerV3(program, coin, quote);
  const destination = getAssociatedTokenAddressSync(quote, owner, false, tokenProgram);
  return { program, coin, quote, owner, creatorKey, pay, tokenProgram, accounts, ledgerAddress, destination };
}

const tokenBalance = async (connection, address, missingAllowed = false) => {
  try { return BigInt((await connection.getTokenAccountBalance(address, 'finalized')).value.amount); }
  catch (error) { if (missingAllowed && !await connection.getAccountInfo(address, 'finalized')) return 0n; throw error; }
};

// Mainnet two-phase split of payTokenProtocolBudget: the program requires a
// guardian review delay between the on-chain approval and the disbursement
// for the automation-bypass path (category 1, no live creator signature), so
// they can no longer be submitted in the same transaction there. Devnet has
// no such delay and keeps using payTokenProtocolBudget above unchanged.
export async function approveTokenProtocolBudget({ connection, programId, keeper, creator, mint, quoteMint, category, recipient, amount }) {
  const ctx = await tokenProtocolBudgetContext({ connection, programId, mint, quoteMint, category, recipient, creator, amount });
  const ledgerInfo = await connection.getAccountInfo(ctx.ledgerAddress, 'finalized');
  if (!ledgerInfo?.owner.equals(ctx.program)) throw new Error('The paired-token ledger is unavailable.');
  const ledger = decodeTokenLedgerV3(ledgerInfo.data);
  if (ctx.pay > ledger.paid[category] - ledger.withdrawn[category]) throw new Error('The token protocol payout exceeds its category budget.');
  const withdrawalId = randomBytes(32);
  const signature = await sendAndConfirmTransaction(connection, new Transaction().add(
    createAssociatedTokenAccountIdempotentInstruction(keeper.publicKey, ctx.destination, ctx.owner, ctx.quote, ctx.tokenProgram),
    buildTokenApprovalInstruction({ programId: ctx.program, mint: ctx.coin, quoteMint: ctx.quote, authority: keeper.publicKey,
      creator: ctx.creatorKey, recipient: ctx.owner, withdrawalId, category, beneficiary: category + 2, amount: ctx.pay, automation: true })),
  [keeper], { commitment: 'finalized' });
  return { signature, withdrawalId: withdrawalId.toString('hex'), category, recipient: ctx.owner.toBase58(), amount: String(ctx.pay), quoteMint: ctx.quote.toBase58() };
}

// Retried on each worker tick for a request already recorded as on-chain
// approved; throws (and should be left pending for the next tick) until the
// program's guardian review delay has elapsed since the approval.
export async function disburseTokenProtocolBudget({ connection, programId, keeper, creator, mint, quoteMint, category, recipient, amount, withdrawalId }) {
  const ctx = await tokenProtocolBudgetContext({ connection, programId, mint, quoteMint, category, recipient, creator, amount });
  const withdrawal = Buffer.isBuffer(withdrawalId) ? withdrawalId : Buffer.from(withdrawalId, 'hex');
  if (withdrawal.length !== 32) throw new Error('A 32-byte withdrawal ID is required.');
  const ledgerInfo = await connection.getAccountInfo(ctx.ledgerAddress, 'finalized');
  if (!ledgerInfo?.owner.equals(ctx.program)) throw new Error('The paired-token ledger is unavailable.');
  const beforeLedger = decodeTokenLedgerV3(ledgerInfo.data);
  const beforeVault = await tokenBalance(connection, ctx.accounts.vaultTokens[category]);
  const beforeRecipient = await tokenBalance(connection, ctx.destination, true);
  const signature = await sendAndConfirmTransaction(connection, new Transaction().add(
    createAssociatedTokenAccountIdempotentInstruction(keeper.publicKey, ctx.destination, ctx.owner, ctx.quote, ctx.tokenProgram),
    buildTokenDisbursementInstruction({ programId: ctx.program, mint: ctx.coin, quoteMint: ctx.quote, tokenProgram: ctx.tokenProgram,
      authority: keeper.publicKey, creator: ctx.creatorKey, recipientOwner: ctx.owner, withdrawalId: withdrawal, category,
      beneficiary: category + 2, amount: ctx.pay, automation: true })),
  [keeper], { commitment: 'finalized' });
  const afterInfo = await connection.getAccountInfo(ctx.ledgerAddress, 'finalized');
  if (!afterInfo?.owner.equals(ctx.program)) throw new Error('The finalized token ledger disappeared.');
  const afterLedger = decodeTokenLedgerV3(afterInfo.data);
  const afterVault = await tokenBalance(connection, ctx.accounts.vaultTokens[category]);
  const afterRecipient = await tokenBalance(connection, ctx.destination);
  if (afterLedger.withdrawn[category] - beforeLedger.withdrawn[category] !== ctx.pay || beforeVault - afterVault !== ctx.pay
    || afterRecipient - beforeRecipient !== ctx.pay)
    throw new Error(`Finalized token protocol payout ${signature} lacks exact ledger, vault and recipient deltas.`);
  return { signature, category, recipient: ctx.owner.toBase58(), amount: String(ctx.pay), quoteMint: ctx.quote.toBase58(),
    withdrawalId: withdrawal.toString('hex'), balanceDeltaVerified: true };
}

// The router's pinned WSOL/<paired token> PumpSwap pools (must match the program).
export const TOKEN_CONVERSION_POOLS = Object.freeze({
  devnet: Object.freeze({ '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU': 'BT8wc5m9pkTQ1wwVYTzsqrBwSYWxuPEQ4t8ZwHcwd7SR' }),
  'mainnet-beta': Object.freeze({}),
});

// Converts part of a paired coin's Daily bonus (5), buyback (6), or AI-agency (7) token budget
// into SOL in that category's SOL vault, where the SOL buyback and agency flows
// spend it. The minimum SOL out is the pool quote less `slippageBps`.
export async function convertTokenBudgetToSol({ connection, programId, keeper, mint, quoteMint, category, amount, cluster = 'devnet', slippageBps = 300, lookupTable = null, conversionId:requestedId = null }) {
  const pool = TOKEN_CONVERSION_POOLS[cluster]?.[String(quoteMint)];
  if (!pool) throw new Error('No reviewed SOL conversion pool exists for this paired token.');
  const quote = new PublicKey(quoteMint), coin = new PublicKey(mint), program = new PublicKey(programId);
  const quoteProgram = (await connection.getAccountInfo(quote, 'confirmed')).owner;
  const vault = PublicKey.findProgramAddressSync([Buffer.from('mint-fee-vault-v3'), coin.toBuffer(), Buffer.from([Number(category)])], program)[0];
  const state = await new OnlinePumpAmmSdk(connection).swapSolanaState(new PublicKey(pool), vault);
  if (!state.pool?.quoteMint?.equals(quote) || state.pool.baseMint.toBase58() !== 'So11111111111111111111111111111111111111112')
    throw new Error('The conversion pool is not WSOL/<paired token>.');
  const spend = new BN(String(amount));
  const quoted = buyQuoteInput({ quote: spend, slippage: 1, baseReserve: state.poolBaseAmount, quoteReserve: state.poolQuoteAmount,
    virtualQuoteReserves: state.pool.virtualQuoteReserves, globalConfig: state.globalConfig, feeConfig: state.feeConfig,
    baseMint: state.baseMint, baseMintAccount: state.baseMintAccount, coinCreator: state.pool.coinCreator, creator: state.pool.creator,
    quoteMint: state.pool.quoteMint, isMayhemMode: state.pool.isMayhemMode, creatorFeeBps: state.pool.creatorFeeBps });
  const expected = BigInt(quoted.base.toString());
  const minSolOut = expected * BigInt(10_000 - slippageBps) / 10_000n;
  if (minSolOut <= 0n) throw new Error('The conversion is too small to quote a SOL output.');
  const buy = selectV3PumpBuy(await PUMP_AMM_SDK.buyQuoteInput(state, spend, 1));
  // Fee custody accounts are paid by the keeper, never by the category budget.
  const setup = [[9, 10], [18, 17], [buy.keys.length - 2, buy.keys.length - 1]].flatMap(([ownerIndex, ataIndex]) => {
    const owner = buy.keys[ownerIndex]?.pubkey, account = buy.keys[ataIndex]?.pubkey;
    return owner && account && getAssociatedTokenAddressSync(quote, owner, true, quoteProgram).equals(account)
      ? [createAssociatedTokenAccountIdempotentInstruction(keeper.publicKey, account, owner, quote, quoteProgram)] : [];
  });
  const conversionId = requestedId === null ? randomBytes(32) : Buffer.from(requestedId);
  if (conversionId.length !== 32) throw new Error('A 32-byte token conversion identity is required.');
  const receiptAddress = deriveTokenConversionV3(program, coin, conversionId);
  if (await connection.getAccountInfo(receiptAddress, 'finalized'))
    throw new Error('Token conversion identity already exists; recover its finalized receipt before retrying.');
  const { instruction } = buildTokenConversionInstruction({ programId: program, mint: coin, quoteMint: quote, quoteTokenProgram: quoteProgram,
    authority: keeper.publicKey, conversionId, category, amountIn: amount, minSolOut, pumpBuyInstruction: buy });
  const instructions = [ComputeBudgetProgram.setComputeUnitLimit({ units: 600_000 }), ...setup, instruction];
  // The PumpSwap CPI accounts exceed a legacy transaction; the reviewed lookup
  // table holds the pool's fixed accounts.
  const table = lookupTable ? (await connection.getAddressLookupTable(new PublicKey(lookupTable))).value : null;
  if (lookupTable && !table) throw new Error('The conversion lookup table is unavailable.');
  let signature;
  if (table) {
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
    const tx = new VersionedTransaction(new TransactionMessage({ payerKey: keeper.publicKey, recentBlockhash: blockhash, instructions }).compileToV0Message([table]));
    await signTransaction(tx, [keeper]);
    signature = await connection.sendTransaction(tx, { maxRetries: 5 });
    const status = await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, 'finalized');
    if (status.value.err) throw new Error(`Conversion failed: ${JSON.stringify(status.value.err)}`);
  } else signature = await sendAndConfirmTransaction(connection, new Transaction().add(...instructions), [keeper], { commitment: 'finalized' });
  const [receiptInfo, creditInfo, tx] = await Promise.all([
    connection.getAccountInfo(receiptAddress, 'finalized'),
    connection.getAccountInfo(deriveSolCreditV3(program, coin), 'finalized'),
    connection.getTransaction(signature, { commitment:'finalized', maxSupportedTransactionVersion:0 }),
  ]);
  if (!receiptInfo?.owner.equals(program) || !creditInfo?.owner.equals(program)
    || !tx || tx.meta?.err !== null || tx.transaction.signatures[0] !== signature)
    throw new Error(`Finalized token conversion ${signature} lacks its program receipt or transaction.`);
  const receipt = decodeTokenConversionV3(receiptInfo.data), credit = decodeSolCreditV3(creditInfo.data);
  if (receipt.conversionId !== conversionId.toString('hex') || receipt.mint !== coin.toBase58()
    || receipt.quoteMint !== quote.toBase58() || receipt.pool !== pool || receipt.category !== category
    || receipt.spentQuote <= 0n || receipt.spentQuote > BigInt(amount)
    || receipt.receivedLamports < minSolOut || credit.mint !== coin.toBase58()
    || credit.credited[category] < receipt.receivedLamports)
    throw new Error(`Finalized token conversion ${signature} conflicts with its receipt or credit.`);
  const keys = [...(tx.transaction.message.accountKeys || tx.transaction.message.staticAccountKeys || []),
    ...(tx.meta.loadedAddresses?.writable || []), ...(tx.meta.loadedAddresses?.readonly || [])].map(key => key.toBase58());
  const vaultIndex = keys.indexOf(vault.toBase58());
  const tokenAccount = getAssociatedTokenAddressSync(quote, vault, true, quoteProgram).toBase58();
  const tokenIndex = keys.indexOf(tokenAccount);
  const preToken = tx.meta.preTokenBalances?.find(row => row.accountIndex === tokenIndex);
  const postToken = tx.meta.postTokenBalances?.find(row => row.accountIndex === tokenIndex);
  const vaultDelta = vaultIndex < 0 ? -1n : BigInt(tx.meta.postBalances[vaultIndex]) - BigInt(tx.meta.preBalances[vaultIndex]);
  const tokenDebit = !preToken || !postToken ? -1n
    : BigInt(preToken.uiTokenAmount.amount) - BigInt(postToken.uiTokenAmount.amount);
  const rentReserve = BigInt(await connection.getMinimumBalanceForRentExemption(0, 'finalized'));
  if (tokenDebit !== receipt.spentQuote || vaultDelta < receipt.receivedLamports
    || vaultDelta - receipt.receivedLamports > rentReserve)
    throw new Error(`Finalized token conversion ${signature} lacks matching token and SOL vault deltas.`);
  return { signature, vault: vault.toBase58(), spent: String(receipt.spentQuote),
    receivedLamports:String(receipt.receivedLamports), expectedLamports: String(expected), minSolOut: String(minSolOut),
    vaultLamportsDelta: String(vaultDelta), conversionId: conversionId.toString('hex'), balanceDeltaVerified:true };
}

// The fixed accounts of a conversion (programs, pool and Pump fee accounts) that
// a lookup table should hold; per-coin vault accounts are left out.
export async function tokenConversionTableAddresses({ connection, programId, mint, quoteMint, cluster = 'devnet' }) {
  const pool = TOKEN_CONVERSION_POOLS[cluster]?.[String(quoteMint)];
  if (!pool) throw new Error('No reviewed SOL conversion pool exists for this paired token.');
  const vault = PublicKey.findProgramAddressSync([Buffer.from('mint-fee-vault-v3'), new PublicKey(mint).toBuffer(), Buffer.from([6])], new PublicKey(programId))[0];
  const state = await new OnlinePumpAmmSdk(connection).swapSolanaState(new PublicKey(pool), vault);
  const buy = selectV3PumpBuy(await PUMP_AMM_SDK.buyQuoteInput(state, new BN(1000), 1));
  const skip = new Set([1, 5, 6, 20]);
  return [...new Set([...buy.keys.filter((_, index) => !skip.has(index)).map(row => row.pubkey.toBase58()),
    new PublicKey(programId).toBase58(), String(quoteMint), 'ComputeBudget111111111111111111111111111111'])];
}
