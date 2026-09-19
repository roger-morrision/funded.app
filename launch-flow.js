import { buildLaunchTransaction, normalizeLaunchInput } from './launch-core.js';
import { Keypair, PublicKey, Transaction } from '@solana/web3.js';
import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID, createBurnCheckedInstruction, getAccount, getAssociatedTokenAddress, getMint } from '@solana/spl-token';
import { OnlinePumpSdk, PUMP_SDK } from '@pump-fun/pump-sdk';
import { tokensToBaseUnits } from './launch-burn-policy.js';

export async function submitLaunch({ connection, provider, payer, input, onStatus = () => {} }) {
  const launchInput = normalizeLaunchInput(input);
  onStatus('Preparing mint account and token account…');
  const { transaction, mint, ata, amount } = await buildLaunchTransaction({
    connection,
    payer,
    supply: launchInput.supply,
    decimals: launchInput.decimals,
  });
  const latest = await connection.getLatestBlockhash('confirmed');
  transaction.recentBlockhash = latest.blockhash;
  transaction.feePayer = payer;
  transaction.partialSign(mint);
  onStatus('Waiting for wallet approval…');
  const signed = await provider.signTransaction(transaction);
  const signature = await connection.sendRawTransaction(signed.serialize(), { skipPreflight: false });
  onStatus('Confirming on Solana Devnet…');
  await connection.confirmTransaction({ signature, blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight }, 'confirmed');
  return { ...launchInput, mint, ata, amount, signature };
}

export function verifyPermanentPumpCreatorRoute({ bondingCurve, feeRouter, payer }) {
  const creator = bondingCurve?.creator?.toBase58?.() || String(bondingCurve?.creator || '');
  const routerAddress = feeRouter.toBase58();
  const payerAddress = payer?.toBase58?.() || String(payer || '');
  return {
    verified: creator === routerAddress && creator !== payerAddress,
    creator,
    routerAddress,
    payerAddress,
    userHasCreatorFeeAuthority: creator === payerAddress,
  };
}

export async function prepareFundedLaunchBurn({ connection, payer, fundedMint, amountTokens }) {
  const mint = new PublicKey(String(fundedMint || '').trim());
  const mintAccount = await getMint(connection, mint, 'confirmed', TOKEN_PROGRAM_ID);
  const tokenAccount = await getAssociatedTokenAddress(mint, payer, false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
  const account = await getAccount(connection, tokenAccount, 'confirmed', TOKEN_PROGRAM_ID);
  if (!account.owner.equals(payer)) throw new Error('The connected wallet does not own its $FUNDED token account.');
  const amount = tokensToBaseUnits(Number(amountTokens), mintAccount.decimals);
  if (account.amount < amount) throw new Error(`This wallet needs ${Number(amountTokens).toLocaleString()} $FUNDED for the selected launch tier.`);
  return {
    instruction: createBurnCheckedInstruction(tokenAccount, mint, payer, amount, mintAccount.decimals, [], TOKEN_PROGRAM_ID),
    mint,
    tokenAccount,
    amount,
    amountTokens: Number(amountTokens),
    decimals: mintAccount.decimals,
    balanceBefore: account.amount,
    supplyBefore: mintAccount.supply,
  };
}

export async function submitPumpDevnetLaunch({ connection, provider, payer, input, metadataUri, feeRouterAddress, launchBurn = null, onStatus = () => {} }) {
  const launchInput = normalizeLaunchInput(input);
  const mint = Keypair.generate();
  const feeRouter = new PublicKey(String(feeRouterAddress || '').trim());
  onStatus('Preparing Pump Devnet bonding-curve launch…');
  const burnPlan = launchBurn?.amountTokens > 0
    ? await prepareFundedLaunchBurn({ connection, payer, fundedMint: launchBurn.fundedMint, amountTokens: launchBurn.amountTokens })
    : null;
  const createInstruction = await PUMP_SDK.createV2Instruction({
    mint: mint.publicKey,
    name: launchInput.name,
    symbol: launchInput.symbol,
    uri: metadataUri || `https://funded.vip/devnet-metadata/${mint.publicKey.toBase58()}`,
    creator: feeRouter,
    user: payer,
    mayhemMode: false,
    holderReward: false,
  });
  const transaction = new Transaction();
  if (burnPlan) transaction.add(burnPlan.instruction);
  transaction.add(createInstruction);
  const latest = await connection.getLatestBlockhash('confirmed');
  transaction.recentBlockhash = latest.blockhash;
  transaction.feePayer = payer;
  transaction.partialSign(mint);
  onStatus(burnPlan
    ? `Approve one atomic transaction: burn ${burnPlan.amountTokens.toLocaleString()} $FUNDED and create the Pump coin…`
    : 'Approve the Pump launch with funded.app permanently set as creator-fee owner…');
  const signed = await provider.signTransaction(transaction);
  const signature = await connection.sendRawTransaction(signed.serialize(), { skipPreflight: false });
  onStatus('Confirming Pump launch on Solana Devnet…');
  await connection.confirmTransaction({ signature, blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight }, 'confirmed');
  onStatus('Verifying Pump recorded funded.app—not the user—as creator-fee owner…');
  const bondingCurve = await new OnlinePumpSdk(connection).fetchBondingCurve(mint.publicKey);
  if (!bondingCurve) throw new Error(`Coin was created, but its Pump bonding curve could not be verified. Mint: ${mint.publicKey.toBase58()}`);
  const feeRoute = verifyPermanentPumpCreatorRoute({ bondingCurve, feeRouter, payer });
  if (!feeRoute.verified) throw new Error(`Coin was created, but funded.app is not its Pump creator-fee owner. Mint: ${mint.publicKey.toBase58()}`);
  let launchBurnReceipt = null;
  if (burnPlan) {
    const mintAfter = await getMint(connection, burnPlan.mint, 'confirmed', TOKEN_PROGRAM_ID);
    const expectedMaximumSupply = burnPlan.supplyBefore - burnPlan.amount;
    if (mintAfter.supply > expectedMaximumSupply) throw new Error('Launch confirmed, but the $FUNDED supply reduction could not be verified.');
    launchBurnReceipt = {
      signature,
      instruction: 'BurnChecked',
      mint: burnPlan.mint.toBase58(),
      tokenAccount: burnPlan.tokenAccount.toBase58(),
      amountTokens: burnPlan.amountTokens,
      amountBaseUnits: burnPlan.amount.toString(),
      decimals: burnPlan.decimals,
      supplyBefore: burnPlan.supplyBefore.toString(),
      supplyAfter: mintAfter.supply.toString(),
      atomicWithPumpLaunch: true,
      verified: true,
    };
  }
  return { ...launchInput, mint, signature, pump: true, feeRouter, feeRoute, launchBurnReceipt };
}
