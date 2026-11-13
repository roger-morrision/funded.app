import { randomBytes } from 'node:crypto';
import { PublicKey, Transaction, ComputeBudgetProgram, sendAndConfirmTransaction } from '@solana/web3.js';
import { OnlinePumpSdk } from '@pump-fun/pump-sdk';
import { PUMP_AMM_SDK, coinCreatorVaultAuthorityPda, coinCreatorVaultAtaPda } from '@pump-fun/pump-swap-sdk';
import { createAssociatedTokenAccountIdempotentInstruction, getAssociatedTokenAddressSync } from '@solana/spl-token';
import { buildTokenAccountSetupInstructions, buildTokenLedgerInitializeInstruction, buildTokenSettlementInstruction,
  buildTokenDisbursementInstruction, deriveTokenAccountsV3, deriveTokenLedgerV3, deriveAgencyPolicyV3, decodeTokenLedgerV3 } from '../mint-router-v3-token.js';

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
  const setup = [...buildTokenAccountSetupInstructions({ programId: program, mint: coin, quoteMint: quote, tokenProgram, payer: keeper.publicKey })];
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
