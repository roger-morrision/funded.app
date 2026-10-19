import { buildLaunchTransaction, normalizeLaunchInput } from './launch-core.js';
import { Keypair, PublicKey, Transaction } from '@solana/web3.js';
import { ASSOCIATED_TOKEN_PROGRAM_ID, NATIVE_MINT, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, createBurnCheckedInstruction, getAccount, getAssociatedTokenAddress, getMint } from '@solana/spl-token';
import { getBuySolAmountFromTokenAmount, getBuyTokenAmountFromSolAmount, OnlinePumpSdk, PUMP_SDK } from '@pump-fun/pump-sdk';
import BN from 'bn.js';
import { tokensToBaseUnits } from './launch-burn-policy.js';
import { devnetMetadataUri } from './devnet-metadata.js';
import { verifyFeeRouterAccount } from './fee-router.js';
import { buildPumpLaunchPlan } from './mint-router-launch.js';
import { buildProtectedMintRouterV3InitializeInstruction, directedGrossUnits,
  verifyMintPolicyV3Account,
  verifyMintRouterV3Account } from './mint-router-v3.js';
import { executeLaunchPlan } from './launch-executor.js';
import { initialCurvePremiumBps } from './launch-review.js';
import { launchReserveInstructions, quoteAtomicReserveBuy } from './launch-community-reserve.js';
import { launchServiceFeeInstructions } from './launch-service-fee.js';

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
  transaction.fundedLastValidBlockHeight = latest.lastValidBlockHeight;
  onStatus('Waiting for wallet approval…');
  const signed = await provider.signTransaction(transaction);
  const signature = await connection.sendRawTransaction(signed.serialize(), { skipPreflight: false });
  onStatus('Confirming on Solana…');
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

export function buildLaunchMintRouter({ mint, payer, v3FeeRouter, feeShares }) {
  if (!v3FeeRouter?.programId || !v3FeeRouter.initialAuthority || !v3FeeRouter.split) {
    throw new Error('An approved V3 program, authority, and protocol split are required.');
  }
  return { scope:'per-mint-v3', ...buildProtectedMintRouterV3InitializeInstruction({
    programId:v3FeeRouter.programId, mint, authority:v3FeeRouter.initialAuthority,
    creator:payer, split:v3FeeRouter.split, shares:feeShares,
  }) };
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
    if (amountBaseUnits * 100n > supplyBaseUnits * 20n) {
      const limitBaseUnits = supplyBaseUnits / 5n;
      let low = 0n;
      let high = BigInt(getBuySolAmountFromTokenAmount({
        global, feeConfig: null, mintSupply: null, bondingCurve: null,
        amount: new BN(limitBaseUnits.toString()), quoteMint: NATIVE_MINT,
      }).toString());
      const tokensAt = lamports => BigInt(getBuyTokenAmountFromSolAmount({
        global, feeConfig: null, mintSupply: null, bondingCurve: null,
        amount: new BN(lamports.toString()), quoteMint: NATIVE_MINT,
      }).toString());
      if (tokensAt(high) > limitBaseUnits) {
        while (low + 1n < high) {
          const midpoint = (low + high) / 2n;
          if (tokensAt(midpoint) <= limitBaseUnits) low = midpoint;
          else high = midpoint;
        }
      } else low = high;
      const safeSixDecimalLamports = low / 1000n * 1000n;
      const maxSol = `${safeSixDecimalLamports / 1_000_000_000n}.${String(safeSixDecimalLamports % 1_000_000_000n).padStart(9, '0').slice(0, 6)}`.replace(/\.?0+$/, '');
      const estimatedPercent = Number(amountBaseUnits * 10_000n / supplyBaseUnits) / 100;
      throw new Error(`Developer buy cannot exceed 20% of the token supply. ${requestedSol} SOL would buy about ${estimatedPercent.toFixed(1)}%; enter ${maxSol} SOL or less at the current Devnet quote.`);
    }
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

export async function submitPumpDevnetLaunch({ cluster = 'devnet', connection, provider, payer, input, metadataUri, prepareMetadata, feeRouterProgramId = null, useMintRouter = false, v3FeeRouter = null, launchBurn = null, launchServiceQuote = null, reserveConfig = null, onStatus = () => {}, onJournal = () => {}, assertWalletCurrent = () => {} }) {
  if (cluster !== 'devnet') throw new Error('Mainnet coin launching is not enabled. No transaction was prepared or sent.');
  if (!v3FeeRouter?.programId || !v3FeeRouter.initialAuthority || !v3FeeRouter.split || !useMintRouter)
    throw new Error('Only verified V3 mint-router launches are supported. No transaction was prepared or sent.');
  const launchInput = normalizeLaunchInput(input);
  if (!reserveConfig?.authority || !reserveConfig?.lookupTable || !Number.isSafeInteger(input.reserveTokens) || input.reserveTokens <= 0)
    throw new Error('An active, configured community reward vault is required before coin creation.');
  const global = await verifyFeeRouterAccount({ connection, programId:v3FeeRouter.programId,
    commitment:'finalized' });
  if (!global.verified || !global.authority.equals(new PublicKey(v3FeeRouter.initialAuthority))) {
    throw new Error('The approved V3 router authority could not be verified before launch.');
  }
  const developerBuy = await getInitialBuyQuote({ connection, input });
  const initialBuy = await quoteAtomicReserveBuy({ connection, supply:launchInput.supply, decimals:launchInput.decimals,
    reserveTokens:input.reserveTokens, developerBaseUnits:developerBuy.amountBaseUnits });
  initialBuy.curvePremiumBps = initialCurvePremiumBps(initialBuy.amountBaseUnits, initialBuy.global.initialVirtualTokenReserves.toString());
  initialBuy.percent = Number(initialBuy.amountBaseUnits) / (launchInput.supply * 10 ** launchInput.decimals) * 100;
  initialBuy.developerAmountTokens = developerBuy.amountTokens;
  if(input.maxInitialBuyLamports!=null&&initialBuy.maxSolAmountLamports>BigInt(input.maxInitialBuyLamports))throw new Error('The initial-buy cost increased beyond the reviewed maximum. Refresh the quote and review again; no transaction was sent.');
  const mint = Keypair.generate();
  const serviceInstructions = launchServiceFeeInstructions({ payer, mint:mint.publicKey, quote:launchServiceQuote });
  onJournal({state:'prepared',mint:mint.publicKey.toBase58()});
  const mintRouter = buildLaunchMintRouter({ mint:mint.publicKey, payer, v3FeeRouter,
    feeShares:input.feeShares });
  const feeRouter = mintRouter.router.address;
  const lookupTable = (await connection.getAddressLookupTable(new PublicKey(reserveConfig.lookupTable), { commitment:'finalized' })).value;
  if (!lookupTable?.isActive()) throw new Error('Solana launch reserve lookup table is missing or inactive. No coin was created.');
  const reserve = launchReserveInstructions({ mint:mint.publicKey, payer, programId:feeRouterProgramId,
    authority:reserveConfig.authority, reserveTokens:input.reserveTokens, decimals:launchInput.decimals });
  if (prepareMetadata) {
    onStatus('Storing signed Solana image and metadata before wallet transaction approval…');
    metadataUri = await prepareMetadata({ mint: mint.publicKey.toBase58(), name: launchInput.name, symbol: launchInput.symbol });
    if (metadataUri !== devnetMetadataUri(mint.publicKey.toBase58())) throw new Error('Metadata service returned an unexpected URL. Launch was not submitted.');
  }
  onStatus('Preparing Pump Solana bonding-curve launch…');
  const burnPlan = launchBurn?.amountTokens > 0
    ? await prepareFundedLaunchBurn({ connection, payer, fundedMint: launchBurn.fundedMint, amountTokens: launchBurn.amountTokens })
    : null;
  const launchInstructions = initialBuy.amountBaseUnits > 0n
    ? await PUMP_SDK.createV2AndBuyInstructions({
      global: initialBuy.global,
      mint: mint.publicKey,
      name: launchInput.name,
      symbol: launchInput.symbol,
      uri: metadataUri || devnetMetadataUri(mint.publicKey.toBase58()),
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
      uri: metadataUri || devnetMetadataUri(mint.publicKey.toBase58()),
      creator: feeRouter,
      user: payer,
      mayhemMode: false,
      holderReward: false,
    })];
  const latest = await connection.getLatestBlockhash('confirmed');
  const plan = buildPumpLaunchPlan({ payer, mint, blockhash: latest.blockhash, launchInstructions,
    burnInstruction: burnPlan?.instruction, mintRouterInstruction: mintRouter?.instruction,
    reserveInstructions:[...reserve.instructions,...serviceInstructions], lookupTable });
  plan.steps.find(step => step.kind === 'launch').transaction.fundedLaunchSummary = {
    kind:'launch', mint:mint.publicKey.toBase58(), tokenName:launchInput.name, tokenSymbol:launchInput.symbol,
    reserveTokens:String(input.reserveTokens), vault:reserve.vault.toBase58(),
    expectedSol:(Number(initialBuy.solAmountLamports) / 1_000_000_000).toFixed(9),
    maximumSol:(Number(initialBuy.maxSolAmountLamports) / 1_000_000_000).toFixed(9),
  };
  assertWalletCurrent();
  onStatus(plan.mintRouterSeparate ? 'Approve mint router initialization, then approve the Pump launch…' : burnPlan
    ? `Approve one transaction to create the Pump coin and burn ${burnPlan.amountTokens.toLocaleString()} $FUNDED…`
    : 'Approve the Pump launch with funded.app set as creator-fee owner…');
  const {signature,mintRouterSignature}=await executeLaunchPlan({connection,provider,payer,mint,plan,assertWalletCurrent,onEvent:onJournal});
  onJournal({state:'verification-pending',signature});
  const reserveAccount = await getAccount(connection, reserve.destination, 'finalized', TOKEN_2022_PROGRAM_ID);
  if (!reserveAccount.owner.equals(reserve.vault) || !reserveAccount.mint.equals(mint.publicKey) || reserveAccount.amount !== reserve.amount)
    throw new Error(`Coin was created but its exact community reserve is not verified. Mint: ${mint.publicKey.toBase58()}; transaction: ${signature}`);
  const reserveTransaction = await connection.getTransaction(signature, { commitment:'finalized', maxSupportedTransactionVersion:0 });
  const fundedInTransaction = reserveTransaction && !reserveTransaction.meta?.err
    && (reserveTransaction.meta.postTokenBalances || []).some(row => row.mint === mint.publicKey.toBase58()
      && row.owner === reserve.vault.toBase58() && BigInt(row.uiTokenAmount.amount) === reserve.amount)
    && !(reserveTransaction.meta.preTokenBalances || []).some(row => row.mint === mint.publicKey.toBase58()
      && row.owner === reserve.vault.toBase58() && BigInt(row.uiTokenAmount.amount) !== 0n);
  if (!fundedInTransaction) throw new Error(`Coin was created but its atomic reserve receipt could not be verified. Mint: ${mint.publicKey.toBase58()}; transaction: ${signature}`);
  onStatus('Verifying Pump recorded funded.app—not the user—as creator-fee owner…');
  const [router, policy] = await Promise.all([
    verifyMintRouterV3Account({ connection, programId:v3FeeRouter.programId,
      mint:mint.publicKey, initialAuthority:v3FeeRouter.initialAuthority }),
    verifyMintPolicyV3Account({ connection, programId:v3FeeRouter.programId,
      mint:mint.publicKey, creator:payer, initialAuthority:v3FeeRouter.initialAuthority,
      split:v3FeeRouter.split }),
  ]);
  if (!router.verified || !policy.verified || !policy.protectedPolicy
    || policy.directedUnits.some((value, index) => value !== directedGrossUnits(input.feeShares)[index])) {
    throw new Error(`Coin was created, but its V3 fee router or policy is not verified. Mint: ${mint.publicKey.toBase58()}`);
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
  return { ...launchInput, mint, signature, mintRouterSignature, mintRouterSeparate: plan.mintRouterSeparate,
    mintRouterScope:mintRouter.scope, pump: true, feeRouter, feeRoute, launchBurnReceipt, initialBuy,
    reserveReceipt:{ signature, vault:reserve.vault.toBase58(), tokenAccount:reserve.destination.toBase58(), fundedTokens:input.reserveTokens, atomic:true },
    metadataUri: metadataUri || devnetMetadataUri(mint.publicKey.toBase58()) };
}
