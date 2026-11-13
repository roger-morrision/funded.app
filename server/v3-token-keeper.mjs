import { randomBytes } from 'node:crypto';
import { PublicKey, Transaction, TransactionMessage, VersionedTransaction, ComputeBudgetProgram, sendAndConfirmTransaction } from '@solana/web3.js';
import { OnlinePumpSdk, creatorVaultPda } from '@pump-fun/pump-sdk';
import { OnlinePumpAmmSdk, PUMP_AMM_SDK, buyQuoteInput, coinCreatorVaultAuthorityPda, coinCreatorVaultAtaPda } from '@pump-fun/pump-swap-sdk';
import BN from 'bn.js';
import { selectV3PumpBuy } from './v3-buyback-setup.mjs';
import { createAssociatedTokenAccountIdempotentInstruction, getAssociatedTokenAddressSync } from '@solana/spl-token';
import { buildTokenAccountSetupInstructions, buildTokenLedgerInitializeInstruction, buildTokenSettlementInstruction,
  buildTokenDisbursementInstruction, buildTokenConversionInstruction, deriveTokenAccountsV3, deriveTokenLedgerV3, deriveAgencyPolicyV3, decodeTokenLedgerV3 } from '../mint-router-v3-token.js';

// Keeper step for a coin paired with a token: make sure the router's and vaults'
// paired-token accounts and the coin's token ledger exist, collect Pump's
// creator fees in that token into the router, then settle them into the seven
// category vaults by the coin's policy. The keeper signs as router authority.
export async function collectAndSettleTokenFees({ connection, programId, keeper, mint, quoteMint, settle = true }) {
  const quote = new PublicKey(quoteMint), coin = new PublicKey(mint), program = new PublicKey(programId);
  const quoteInfo = await connection.getAccountInfo(quote, 'confirmed');
  if (!quoteInfo) throw new Error('Paired token not found.');
  const tokenProgram = quoteInfo.owner;
  const accounts = deriveTokenAccountsV3(program, coin, quote, tokenProgram);
  const ledger = deriveTokenLedgerV3(program, coin, quote);
  // Agency launches (all new launches) have an agency policy; older ones a protected policy.
  const agency = Boolean(await connection.getAccountInfo(deriveAgencyPolicyV3(program, coin), 'confirmed'));
  // Only create the paired-token accounts that do not exist yet.
  const owned = [accounts.routerToken, ...accounts.vaultTokens];
  const present = await connection.getMultipleAccountsInfo(owned, 'confirmed');
  const setup = buildTokenAccountSetupInstructions({ programId: program, mint: coin, quoteMint: quote, tokenProgram, payer: keeper.publicKey })
    .filter((_, index) => !present[index]);
  if (!await connection.getAccountInfo(ledger, 'confirmed'))
    setup.push(buildTokenLedgerInitializeInstruction({ programId: program, mint: coin, quoteMint: quote, authority: keeper.publicKey, agency }));
  // PumpSwap fees (after migration) move to Pump's creator vault first; Pump's
  // collection then pays the router's paired-token account.
  const collect = await new OnlinePumpSdk(connection).collectCoinCreatorFeeV2Instructions(accounts.router, quote, tokenProgram, keeper.publicKey);
  const ammVault = coinCreatorVaultAtaPda(coinCreatorVaultAuthorityPda(accounts.router), quote, tokenProgram);
  const ammAmount = await connection.getTokenAccountBalance(ammVault, 'confirmed').then(row => BigInt(row.value.amount)).catch(() => 0n);
  const transfer = ammAmount > 0n ? [await PUMP_AMM_SDK.transferCreatorFeesToPumpV2Instruction({ payer: keeper.publicKey, coinCreator: accounts.router, quoteMint: quote, quoteTokenProgram: tokenProgram })] : [];
  const before = await connection.getTokenAccountBalance(accounts.routerToken, 'confirmed').then(row => BigInt(row.value.amount)).catch(() => 0n);
  // Account setup (nine token accounts and the ledger) is too large for one
  // transaction: send it in small batches, then collect.
  const setupSignatures = [];
  for (let index = 0; index < setup.length; index += 4)
    setupSignatures.push(await sendAndConfirmTransaction(connection, new Transaction().add(...setup.slice(index, index + 4)), [keeper], { commitment: 'confirmed' }));
  const collectSignature = await sendAndConfirmTransaction(connection,
    new Transaction().add(ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }), ...transfer, ...collect), [keeper], { commitment: 'confirmed' });
  const balance = BigInt((await connection.getTokenAccountBalance(accounts.routerToken, 'confirmed')).value.amount);
  const result = { tokenProgram: tokenProgram.toBase58(), routerToken: accounts.routerToken.toBase58(), collectSignature,
    collected: String(balance - before), routerBalance: String(balance), settleSignature: null, settled: '0', agency };
  if (!settle || balance === 0n) return result;
  const claimId = randomBytes(32);
  result.settleSignature = await sendAndConfirmTransaction(connection, new Transaction().add(
    buildTokenSettlementInstruction({ programId: program, mint: coin, quoteMint: quote, tokenProgram, authority: keeper.publicKey, claimId, amount: balance, agency })),
  [keeper], { commitment: 'confirmed' });
  result.settled = String(balance);
  result.claimId = claimId.toString('hex');
  return result;
}

// Holder rewards in the paired token: pay the holders' part of the creator-
// directed budget (category 0, beneficiary 1) into the coin's reward vault token
// account, then enroll it with the holder scheduler as a funded pool of that
// token. Signed by the creator when given, otherwise by the automation record.
export async function fundTokenHolderRewards({ connection, programId, keeper, creator, creatorSigner = null, mint, quoteMint, amount, scheduler, activatedAt }) {
  const quote = new PublicKey(quoteMint), coin = new PublicKey(mint), program = new PublicKey(programId);
  const tokenProgram = (await connection.getAccountInfo(quote, 'confirmed')).owner;
  const agency = Boolean(await connection.getAccountInfo(deriveAgencyPolicyV3(program, coin), 'confirmed'));
  const [vault] = PublicKey.findProgramAddressSync([Buffer.from('reward-vault-v1'), keeper.publicKey.toBuffer(), coin.toBuffer()], program);
  if (!await connection.getAccountInfo(vault, 'confirmed')) throw new Error('The coin has no reward vault.');
  const vaultToken = getAssociatedTokenAddressSync(quote, vault, true, tokenProgram);
  const ledger = decodeTokenLedgerV3((await connection.getAccountInfo(deriveTokenLedgerV3(program, coin, quote), 'confirmed')).data);
  const pay = BigInt(amount);
  if (pay <= 0n || pay > ledger.paid[0] - ledger.withdrawn[0]) throw new Error('The holder amount exceeds the creator-directed budget.');
  const before = await connection.getTokenAccountBalance(vaultToken, 'confirmed').then(row => BigInt(row.value.amount)).catch(() => 0n);
  const signature = await sendAndConfirmTransaction(connection, new Transaction().add(
    createAssociatedTokenAccountIdempotentInstruction(keeper.publicKey, vaultToken, vault, quote, tokenProgram),
    buildTokenDisbursementInstruction({ programId: program, mint: coin, quoteMint: quote, tokenProgram, authority: keeper.publicKey, creator,
      automation: !creatorSigner, recipientOwner: vault, withdrawalId: randomBytes(32), category: 0, beneficiary: 1, amount: pay, holderAmount: pay, agency })),
  [keeper, ...(creatorSigner ? [creatorSigner] : [])], { commitment: 'confirmed' });
  const after = BigInt((await connection.getTokenAccountBalance(vaultToken, 'confirmed')).value.amount);
  if (after - before !== pay) throw new Error('The reward vault did not receive the exact holder amount.');
  const fundedAt = Math.floor(Date.now() / 1000);
  if (scheduler) await scheduler.recordFundedPool({ id: `v3t:${signature}`, mint: coin.toBase58(), asset: quote.toBase58(), amount: String(pay),
    fundingSignature: signature, balanceDeltaVerified: true, fundedAt });
  return { signature, vault: vault.toBase58(), vaultToken: vaultToken.toBase58(), amount: String(pay), fundedAt, activatedAt };
}

// Paired-token creator fees waiting at Pump for this coin: the bonding-curve
// creator vault plus, after migration, PumpSwap's creator vault.
export async function pendingTokenFees({ connection, programId, mint, quoteMint, tokenProgram }) {
  const quote = new PublicKey(quoteMint), program = new PublicKey(programId);
  const owner = tokenProgram ? new PublicKey(tokenProgram) : (await connection.getAccountInfo(quote, 'confirmed')).owner;
  const { router } = deriveTokenAccountsV3(program, new PublicKey(mint), quote, owner);
  const read = account => connection.getTokenAccountBalance(account, 'confirmed').then(row => BigInt(row.value.amount)).catch(() => 0n);
  const [curve, amm] = await Promise.all([
    read(getAssociatedTokenAddressSync(quote, creatorVaultPda(router), true, owner)),
    read(coinCreatorVaultAtaPda(coinCreatorVaultAuthorityPda(router), quote, owner))]);
  return { curve, amm, total: curve + amm, tokenProgram: owner.toBase58() };
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
  const tokenProgram = (await connection.getAccountInfo(quote, 'confirmed')).owner;
  const pay = BigInt(amount);
  if (pay <= 0n) throw new Error('A positive creator payout is required.');
  const account = getAssociatedTokenAddressSync(quote, owner, false, tokenProgram);
  const before = await connection.getTokenAccountBalance(account, 'confirmed').then(row => BigInt(row.value.amount)).catch(() => 0n);
  const signature = await sendAndConfirmTransaction(connection, new Transaction().add(
    createAssociatedTokenAccountIdempotentInstruction(keeper.publicKey, account, owner, quote, tokenProgram),
    buildTokenDisbursementInstruction({ programId: program, mint: coin, quoteMint: quote, tokenProgram, authority: keeper.publicKey, creator: owner,
      automation: true, recipientOwner: owner, withdrawalId: randomBytes(32), category: 0, beneficiary: 0, amount: pay, agency: true })),
  [keeper], { commitment: 'confirmed' });
  const after = BigInt((await connection.getTokenAccountBalance(account, 'confirmed')).value.amount);
  if (after - before !== pay) throw new Error('The creator wallet did not receive the exact payout.');
  return { signature, account: account.toBase58(), amount: String(pay) };
}

// The router's pinned WSOL/<paired token> PumpSwap pools (must match the program).
export const TOKEN_CONVERSION_POOLS = Object.freeze({
  devnet: Object.freeze({ '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU': 'BT8wc5m9pkTQ1wwVYTzsqrBwSYWxuPEQ4t8ZwHcwd7SR' }),
  'mainnet-beta': Object.freeze({}),
});

// Converts part of a paired coin's buyback (6) or AI-agency (7) token budget
// into SOL in that category's SOL vault, where the SOL buyback and agency flows
// spend it. The minimum SOL out is the pool quote less `slippageBps`.
export async function convertTokenBudgetToSol({ connection, programId, keeper, mint, quoteMint, category, amount, cluster = 'devnet', slippageBps = 300, lookupTable = null }) {
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
  const conversionId = randomBytes(32);
  const { instruction } = buildTokenConversionInstruction({ programId: program, mint: coin, quoteMint: quote, quoteTokenProgram: quoteProgram,
    authority: keeper.publicKey, conversionId, category, amountIn: amount, minSolOut, pumpBuyInstruction: buy });
  const before = await connection.getBalance(vault, 'confirmed');
  const instructions = [ComputeBudgetProgram.setComputeUnitLimit({ units: 600_000 }), ...setup, instruction];
  // The PumpSwap CPI accounts exceed a legacy transaction; the reviewed lookup
  // table holds the pool's fixed accounts.
  const table = lookupTable ? (await connection.getAddressLookupTable(new PublicKey(lookupTable))).value : null;
  if (lookupTable && !table) throw new Error('The conversion lookup table is unavailable.');
  let signature;
  if (table) {
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
    const tx = new VersionedTransaction(new TransactionMessage({ payerKey: keeper.publicKey, recentBlockhash: blockhash, instructions }).compileToV0Message([table]));
    tx.sign([keeper]);
    signature = await connection.sendTransaction(tx, { maxRetries: 5 });
    const status = await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, 'confirmed');
    if (status.value.err) throw new Error(`Conversion failed: ${JSON.stringify(status.value.err)}`);
  } else signature = await sendAndConfirmTransaction(connection, new Transaction().add(...instructions), [keeper], { commitment: 'confirmed' });
  const after = await connection.getBalance(vault, 'confirmed');
  return { signature, vault: vault.toBase58(), spent: String(amount), expectedLamports: String(expected), minSolOut: String(minSolOut),
    vaultLamportsDelta: String(after - before), conversionId: conversionId.toString('hex') };
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
