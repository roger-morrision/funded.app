import { buildLaunchTransaction, normalizeLaunchInput } from './launch-core.js';
import { Keypair, PublicKey, Transaction } from '@solana/web3.js';
import { ASSOCIATED_TOKEN_PROGRAM_ID, NATIVE_MINT, TOKEN_PROGRAM_ID, createBurnCheckedInstruction, getAccount, getAssociatedTokenAddress, getMint } from '@solana/spl-token';
import { getBuySolAmountFromTokenAmount, getBuyTokenAmountFromSolAmount, OnlinePumpSdk, PUMP_SDK } from '@pump-fun/pump-sdk';
import BN from 'bn.js';
import { tokensToBaseUnits } from './launch-burn-policy.js';
import { devnetMetadataUri } from './devnet-metadata.js';
import { verifyMintFeeRouterAccount } from './fee-router.js';
import { buildMintRouterInitializeInstruction, buildPumpLaunchPlan } from './mint-router-launch.js';
import { executeLaunchPlan } from './launch-executor.js';
import { initialCurvePremiumBps } from './launch-review.js';

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

export function normalizeInitialBuy(input = {}) {
  const percent = Number(input.initialBuyPercent ?? 0);
  if (!Number.isFinite(percent) || percent < 0 || percent > 20) throw new Error('Creator buy must be between 0% and 20% of supply.');
  const tenths = Math.round(percent * 10);
  const supplyBaseUnits = BigInt(input.supply) * (10n ** BigInt(input.decimals));
  const amountBaseUnits = supplyBaseUnits * BigInt(tenths) / 1000n;
  return { percent: tenths / 10, amountBaseUnits, amountTokens: Number(input.supply) * tenths / 1000 };
}

export async function getInitialBuyQuote({ connection, input }) {
  const launchInput = normalizeLaunchInput(input);
  const requestedSol = Number(input?.initialBuySol ?? 0);
  if (!Number.isFinite(requestedSol) || requestedSol < 0) throw new Error('Developer buy must be a valid SOL amount of zero or more.');
  if (requestedSol > 0) {
    const requestedLamports = BigInt(Math.round(requestedSol * 1_000_000_000));
    if (requestedLamports <= 0n || requestedLamports > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Developer buy SOL amount is outside the supported range.');
    const global = await new OnlinePumpSdk(connection).fetchGlobal();
    const amountBaseUnits = BigInt(getBuyTokenAmountFromSolAmount({
      global,
      feeConfig: null,
      mintSupply: null,
      bondingCurve: null,
      amount: new BN(requestedLamports.toString()),
      quoteMint: NATIVE_MINT,
    }).toString());
    const supplyBaseUnits = BigInt(launchInput.supply) * (10n ** BigInt(launchInput.decimals));
    if (amountBaseUnits <= 0n) throw new Error('Developer buy is too small to receive tokens.');
    if (amountBaseUnits * 100n > supplyBaseUnits * 20n) throw new Error('Developer buy cannot exceed 20% of the token supply.');
    const tokenDivisor = 10 ** launchInput.decimals;
    const amountTokens = Number(amountBaseUnits) / tokenDivisor;
    const percent = amountTokens / launchInput.supply * 100;
    return {
      percent,
      amountBaseUnits,
      amountTokens,
      solAmountLamports: requestedLamports,
      maxSolAmountLamports: requestedLamports + requestedLamports / 100n,
      curvePremiumBps: initialCurvePremiumBps(amountBaseUnits, global.initialVirtualTokenReserves.toString()),
    };
  }
  const buy = normalizeInitialBuy({ ...launchInput, initialBuyPercent: input?.initialBuyPercent });
  if (buy.amountBaseUnits === 0n) return { ...buy, solAmountLamports: 0n, maxSolAmountLamports:0n, curvePremiumBps:0 };
  const global = await new OnlinePumpSdk(connection).fetchGlobal();
  const solAmountLamports = getBuySolAmountFromTokenAmount({
    global,
    feeConfig: null,
    mintSupply: null,
    bondingCurve: null,
    amount: new BN(buy.amountBaseUnits.toString()),
    quoteMint: NATIVE_MINT,
  });
  const quoted=BigInt(solAmountLamports.toString());
  return { ...buy, solAmountLamports: quoted, maxSolAmountLamports:quoted+quoted/100n,
    curvePremiumBps:initialCurvePremiumBps(buy.amountBaseUnits,global.initialVirtualTokenReserves.toString()) };
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

export async function submitPumpDevnetLaunch({ connection, provider, payer, input, metadataUri, prepareMetadata, feeRouterAddress, feeRouterProgramId = null, useMintRouter = false, launchBurn = null, onStatus = () => {}, onJournal = () => {}, assertWalletCurrent = () => {} }) {
  const launchInput = normalizeLaunchInput(input);
  const initialBuy = await getInitialBuyQuote({ connection, input });
  if(input.maxInitialBuyLamports!=null&&initialBuy.maxSolAmountLamports>BigInt(input.maxInitialBuyLamports))throw new Error('The initial-buy cost increased beyond the reviewed maximum. Refresh the quote and review again; no transaction was sent.');
  const mint = Keypair.generate();
  onJournal({state:'prepared',mint:mint.publicKey.toBase58()});
  const mintRouter = useMintRouter ? buildMintRouterInitializeInstruction({ programId: feeRouterProgramId, mint: mint.publicKey, payer }) : null;
  const feeRouter = mintRouter?.router.address || new PublicKey(String(feeRouterAddress || '').trim());
  if (prepareMetadata) {
    onStatus('Storing signed Devnet image and metadata before wallet transaction approval…');
    metadataUri = await prepareMetadata({ mint: mint.publicKey.toBase58(), name: launchInput.name, symbol: launchInput.symbol });
    if (metadataUri !== devnetMetadataUri(mint.publicKey.toBase58())) throw new Error('Metadata service returned an unexpected URL. Launch was not submitted.');
  }
  onStatus('Preparing Pump Devnet bonding-curve launch…');
  const burnPlan = launchBurn?.amountTokens > 0
    ? await prepareFundedLaunchBurn({ connection, payer, fundedMint: launchBurn.fundedMint, amountTokens: launchBurn.amountTokens })
    : null;
  const launchInstructions = initialBuy.amountBaseUnits > 0n
    ? await PUMP_SDK.createV2AndBuyInstructions({
      global: await new OnlinePumpSdk(connection).fetchGlobal(),
      mint: mint.publicKey,
      name: launchInput.name,
      symbol: launchInput.symbol,
      uri: metadataUri || `https://funded.vip/devnet-metadata/${mint.publicKey.toBase58()}`,
      creator: feeRouter,
      user: payer,
      amount: new BN(initialBuy.amountBaseUnits.toString()),
      solAmount: new BN(initialBuy.solAmountLamports.toString()),
      mayhemMode: false,
      cashback: false,
      holderReward: false,
    })
    : [await PUMP_SDK.createV2Instruction({
      mint: mint.publicKey,
      name: launchInput.name,
      symbol: launchInput.symbol,
      uri: metadataUri || `https://funded.vip/devnet-metadata/${mint.publicKey.toBase58()}`,
      creator: feeRouter,
      user: payer,
      mayhemMode: false,
      holderReward: false,
    })];
  const latest = await connection.getLatestBlockhash('confirmed');
  const plan = buildPumpLaunchPlan({ payer, mint, blockhash: latest.blockhash, launchInstructions, burnInstruction: burnPlan?.instruction, mintRouterInstruction: mintRouter?.instruction });
  assertWalletCurrent();
  onStatus(plan.mintRouterSeparate ? 'Approve mint router initialization, then approve the Pump launch…' : burnPlan
    ? `Approve one transaction to create the Pump coin and burn ${burnPlan.amountTokens.toLocaleString()} $FUNDED…`
    : 'Approve the Pump launch with funded.app set as creator-fee owner…');
  const {signature,mintRouterSignature}=await executeLaunchPlan({connection,provider,payer,mint,plan,assertWalletCurrent,onEvent:onJournal});
  onJournal({state:'verification-pending',signature});
  onStatus('Verifying Pump recorded funded.app—not the user—as creator-fee owner…');
  if (mintRouter) {
    const legacyAccount = await connection.getAccountInfo(new PublicKey(feeRouterAddress), 'confirmed');
    const expectedAuthority = legacyAccount?.data?.length >= 74 ? new PublicKey(legacyAccount.data.subarray(41, 73)) : null;
    if (!expectedAuthority) throw new Error(`Coin was created, but the legacy router authority could not be verified. Mint: ${mint.publicKey.toBase58()}`);
    const verifiedRouter = await verifyMintFeeRouterAccount({ connection, programId: feeRouterProgramId, mint: mint.publicKey, expectedAuthority });
    if (!verifiedRouter.verified) throw new Error(`Coin was created, but its isolated fee router is not verified (${verifiedRouter.reason}). Mint: ${mint.publicKey.toBase58()}`);
  }
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
  return { ...launchInput, mint, signature, mintRouterSignature, mintRouterSeparate: plan.mintRouterSeparate, pump: true, feeRouter, feeRoute, launchBurnReceipt, initialBuy, metadataUri: metadataUri || `https://funded.vip/devnet-metadata/${mint.publicKey.toBase58()}` };
}
