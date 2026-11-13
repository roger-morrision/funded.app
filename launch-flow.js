import { assertRpcNetwork } from './solana-network.js';
import {normalizeDeveloperLockSeconds} from './developer-lock-period.js';
import { buildLaunchTransaction, normalizeLaunchInput } from './launch-core.js';
import { Keypair, PublicKey, Transaction } from '@solana/web3.js';
import { ASSOCIATED_TOKEN_PROGRAM_ID, NATIVE_MINT, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, createBurnCheckedInstruction, getAccount, getAssociatedTokenAddress, getAssociatedTokenAddressSync, getMint } from '@solana/spl-token';
import { getBuySolAmountFromTokenAmount, getBuyTokenAmountFromSolAmount, OnlinePumpSdk, PUMP_SDK } from '@pump-fun/pump-sdk';
import BN from 'bn.js';
import { tokensToBaseUnits } from './launch-burn-policy.js';
import { devnetLaunchMetadataUri } from './devnet-metadata.js';
import { isPinnedMetadataUri, onchainMetadataUri } from './metadata-publication.js';
import { developerLockLaunchInstructions } from './developer-token-lock.js';
import { verifyFeeRouterAccount } from './fee-router.js';
import { buildPumpLaunchPlan } from './mint-router-launch.js';
import { buildProtectedMintRouterV3InitializeInstruction, directedGrossUnits, protocolGrossUnits,
  verifyMintPolicyV3Account,
  verifyMintRouterV3Account } from './mint-router-v3.js';
import { executeLaunchPlan } from './launch-executor.js';
import { confirmPromotionBurn } from './launch-promotion-burn.js';
import { initialCurvePremiumBps } from './launch-review.js';
import { launchReserveInstructions, quoteAtomicReserveBuy, launchBuyCapacity } from './launch-community-reserve.js';
import { launchServiceFeeInstructions } from './launch-service-fee.js';
import {buildAgencyMintV3InitializeInstruction,agencySelectionMask} from './agency-mint-router-v3.js';
import {MARKETING_AGENCY_POLICY,canonicalAgencySelection,newLaunchAgencySelection} from './config/marketing-agency.js';

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
  const confirmation = await connection.confirmTransaction({ signature, blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight }, 'confirmed');
  if (confirmation?.value?.err !== null) throw new Error(`Launch transaction ${signature} did not confirm successfully.`);
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
  if(v3FeeRouter.split.agencyPercent!==undefined){
    const agency=v3FeeRouter.agency;
    if(agency?.version!==MARKETING_AGENCY_POLICY.version)
      throw new Error('A verified dedicated agency launch configuration is required.');
    protocolGrossUnits(v3FeeRouter.split);
    return{scope:'per-mint-v3',...buildAgencyMintV3InitializeInstruction({programId:v3FeeRouter.programId,mint,
      authority:v3FeeRouter.initialAuthority,creator:payer,shares:feeShares,
      selectedAgents:canonicalAgencySelection(agency.selectedAgents),configRevision:agency.configRevision})};
  }
  return { scope:'per-mint-v3', ...buildProtectedMintRouterV3InitializeInstruction({
    programId:v3FeeRouter.programId, mint, authority:v3FeeRouter.initialAuthority,
    creator:payer, split:v3FeeRouter.split, shares:feeShares,
  }) };
}

export function normalizeInitialBuy(input = {}) {
  const percent = Number(input.initialBuyPercent ?? 0);
  if (!Number.isFinite(percent) || percent < 0 || percent > 20) throw new Error('Creator buy must be between 0% and 20% of supply.');
  const hundredths = Math.round(percent * 100);
  const supplyBaseUnits = BigInt(input.supply) * (10n ** BigInt(input.decimals));
  const amountBaseUnits = supplyBaseUnits * BigInt(hundredths) / 10000n;
  return { percent: hundredths / 100, amountBaseUnits, amountTokens: Number(input.supply) * hundredths / 10000 };
}

export async function getInitialBuyQuote({ connection, input }) {
  const launchInput = normalizeLaunchInput(input);
  const requestedSol = Number(input?.initialBuySol ?? 0);
  if (!Number.isFinite(requestedSol) || requestedSol < 0) throw new Error('Developer buy must be a valid SOL amount of zero or more.');
  if (requestedSol > 0) {
    const requestedLamports = BigInt(Math.round(requestedSol * 1_000_000_000));
    if (requestedLamports <= 0n || requestedLamports > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Developer buy SOL amount is outside the supported range.');
    const global = await new OnlinePumpSdk(connection).fetchGlobal();
    const capacity = launchBuyCapacity({ global, decimals: launchInput.decimals, reserveTokens: input.reserveTokens });
    const limitBaseUnits = capacity.developerBaseUnits;
    const limitLamports = BigInt(getBuySolAmountFromTokenAmount({
      global, feeConfig: null, mintSupply: null, bondingCurve: null,
      amount: new BN(limitBaseUnits.toString()), quoteMint: NATIVE_MINT,
    }).toString());
    const amountBaseUnits = BigInt(getBuyTokenAmountFromSolAmount({
      global,
      feeConfig: null,
      mintSupply: null,
      bondingCurve: null,
      amount: new BN(requestedLamports.toString()),
      quoteMint: NATIVE_MINT,
    }).toString());
    if (amountBaseUnits <= 0n) throw new Error('Developer buy is too small to receive tokens.');
    if (amountBaseUnits > limitBaseUnits || requestedLamports > limitLamports) {
      let low = 0n;
      let high = limitLamports;
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
      const reason = limitBaseUnits === capacity.creatorCapBaseUnits
        ? 'Developer buy cannot exceed 20% of the token supply.'
        : 'Developer buy exceeds the available launch supply after the community reserve.';
      throw new Error(`${reason} Enter ${maxSol} SOL or less at the current quote.`);
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
  const capacity = launchBuyCapacity({ global, decimals: launchInput.decimals, reserveTokens: input.reserveTokens });
  if (buy.amountBaseUnits > capacity.developerBaseUnits)
    throw new Error('Developer buy exceeds the available launch supply after the community reserve. Lower the purchase percentage.');
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
  if (!account.owner.equals(payer)) throw new Error('The connected wallet does not own its $RICH token account.');
  const amount = tokensToBaseUnits(Number(amountTokens), mintAccount.decimals);
  if (account.amount < amount) throw new Error(`This wallet needs ${Number(amountTokens).toLocaleString()} $RICH for the selected launch tier.`);
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
  if (launchBurn && launchBurn.tier !== 'standard' && (!Number.isSafeInteger(launchBurn.amountTokens) || launchBurn.amountTokens <= 0))
    throw Error('A valid promotion burn quote is required before coin creation.');
  if (!v3FeeRouter?.programId || !v3FeeRouter.initialAuthority || !v3FeeRouter.split || !useMintRouter)
    throw new Error('Only verified V3 mint-router launches are supported. No transaction was prepared or sent.');
  if (v3FeeRouter.agency) {
    const selected = canonicalAgencySelection(v3FeeRouter.agency.selectedAgents);
    const required = newLaunchAgencySelection({ promotion: Boolean(launchBurn && launchBurn.tier !== 'standard') });
    if (selected.length !== required.length || selected.some((agent, index) => agent !== required[index])) {
      throw new Error('The selected agents must match the launch package before signing. Refresh the launch review.');
    }
  }
  const launchInput = normalizeLaunchInput(input);
  if (!reserveConfig?.authority || !reserveConfig?.lookupTable || !Number.isSafeInteger(input.reserveTokens) || input.reserveTokens <= 0)
    throw new Error('An active, configured community reward vault is required before coin creation.');
  await assertRpcNetwork(connection,cluster);
  assertWalletCurrent();
  const global = await verifyFeeRouterAccount({ connection, programId:v3FeeRouter.programId,
    commitment:'finalized' });
  if (!global.verified || !global.authority.equals(new PublicKey(v3FeeRouter.initialAuthority))) {
    throw new Error('The approved V3 router authority could not be verified before launch.');
  }
  // Paired coin: its Pump curve is quoted in `input.quoteMint` (USDC, an xStock, ...).
  // The community reserve is bought with that token; developer buy is SOL-only for now.
  const quoteMint = input.quoteMint ? new PublicKey(input.quoteMint) : NATIVE_MINT;
  const paired = !quoteMint.equals(NATIVE_MINT);
  if (paired && Number(input.initialBuySol || 0) > 0) throw new Error('Developer buy is available for SOL launches only. Set the developer buy to 0 for a paired coin.');
  const developerBuy = await getInitialBuyQuote({ connection, input });
  const initialBuy = await quoteAtomicReserveBuy({ connection, supply:launchInput.supply, decimals:launchInput.decimals,
    reserveTokens:input.reserveTokens, developerBaseUnits:developerBuy.amountBaseUnits, quoteMint });
  let quoteTokenProgram = TOKEN_PROGRAM_ID;
  if (paired) {
    const quoteInfo = await connection.getAccountInfo(quoteMint, 'confirmed');
    if (!quoteInfo) throw new Error('The paired token was not found on Solana. No coin was created.');
    quoteTokenProgram = quoteInfo.owner;
    const payerQuote = getAssociatedTokenAddressSync(quoteMint, payer, false, quoteTokenProgram);
    const held = await connection.getTokenAccountBalance(payerQuote, 'confirmed').then(result => BigInt(result.value.amount)).catch(() => 0n);
    if (held < initialBuy.maxSolAmountLamports)
      throw new Error(`The community reserve is bought with the paired token. Your wallet needs ${initialBuy.maxSolAmountLamports} base units of it and holds ${held}. No coin was created.`);
  }
  initialBuy.curvePremiumBps = initialCurvePremiumBps(initialBuy.amountBaseUnits, initialBuy.global.initialVirtualTokenReserves.toString());
  initialBuy.percent = Number(initialBuy.amountBaseUnits) / (launchInput.supply * 10 ** launchInput.decimals) * 100;
  initialBuy.developerAmountTokens = developerBuy.amountTokens;
  if(input.maxInitialBuyLamports!=null&&initialBuy.maxSolAmountLamports>BigInt(input.maxInitialBuyLamports))throw new Error('The initial-buy cost increased beyond the reviewed maximum. Refresh the quote and review again; no transaction was sent.');
  const mint = Keypair.generate();
  const serviceInstructions = launchServiceFeeInstructions({ payer, mint:mint.publicKey, quote:launchServiceQuote, cluster,escrowReceiptMarker:developerBuy.amountBaseUnits>0n });
  onJournal({state:'prepared',mint:mint.publicKey.toBase58()});
  const mintRouter = buildLaunchMintRouter({ mint:mint.publicKey, payer, v3FeeRouter,
    feeShares:input.feeShares });
  const feeRouter = mintRouter.router.address;
  const lookupTable = (await connection.getAddressLookupTable(new PublicKey(reserveConfig.lookupTable), { commitment:'finalized' })).value;
  if (!lookupTable?.isActive()) throw new Error('Solana launch reserve lookup table is missing or inactive. No coin was created.');
  const reserve = launchReserveInstructions({ mint:mint.publicKey, payer, programId:feeRouterProgramId,
    authority:reserveConfig.authority, reserveTokens:input.reserveTokens, decimals:launchInput.decimals });
  const developerLockInstructions = developerLockLaunchInstructions({mint:mint.publicKey,creator:payer,
    amount:developerBuy.amountBaseUnits,config:reserveConfig.developerTokenLock,quoteId:launchServiceQuote.id,lockSeconds:input.developerLockSeconds});
  const hostedMetadataUri = devnetLaunchMetadataUri(mint.publicKey.toBase58());
  let symbolReservationExpiresAt = null;
  if (prepareMetadata) {
    onStatus('Storing signed Solana image and metadata before wallet transaction approval…');
    const preparedMetadata = await prepareMetadata({ mint:mint.publicKey.toBase58(), name:launchInput.name, symbol:launchInput.symbol });
    metadataUri = typeof preparedMetadata === 'string' ? preparedMetadata : preparedMetadata?.uri;
    symbolReservationExpiresAt = typeof preparedMetadata === 'object' ? Date.parse(preparedMetadata.symbolReservationExpiresAt) : null;
    if (metadataUri !== hostedMetadataUri && !isPinnedMetadataUri(metadataUri)) throw new Error('Metadata service returned an unexpected URL. Launch was not submitted.');
  }
  const launchMetadataUri = onchainMetadataUri(metadataUri || hostedMetadataUri);
  assertWalletCurrent();
  onStatus('Preparing Pump Solana bonding-curve launch…');
  const burnPlan = launchBurn?.amountTokens > 0
    ? await prepareFundedLaunchBurn({ connection, payer, fundedMint: launchBurn.fundedMint, amountTokens: launchBurn.amountTokens })
    : null;
  const beforeBroadcast = () => {
    // Leave enough lease time for this recent-blockhash transaction to expire
    // before another creator may acquire the same ticker.
    if (symbolReservationExpiresAt !== null && (!Number.isFinite(symbolReservationExpiresAt)
      || Date.now() + 5 * 60_000 >= symbolReservationExpiresAt))
      throw new Error('Ticker reservation expired. Check saved receipts before starting another launch review.');
  };
  const launchBurnReceipt = burnPlan ? await confirmPromotionBurn({connection,provider,payer,mint,burnPlan,quoteId:launchBurn.quoteId,
    onJournal,onStatus,assertWalletCurrent,beforeBroadcast:()=>{
      beforeBroadcast();
      if(!Number.isFinite(Date.parse(launchBurn.quoteExpiresAt)) || Date.parse(launchBurn.quoteExpiresAt)<=Date.now()+30_000)
        throw Error('Promotion quote expired before burning. Refresh the launch review.');
      if(!Number.isFinite(Date.parse(launchServiceQuote.expiresAt)) || Date.parse(launchServiceQuote.expiresAt)<=Date.now()+60_000)
        throw Error('Launch fee quote is too close to expiry. Refresh before burning.');
    }}) : null;
  onStatus(burnPlan ? 'Promotion burn verified. Preparing the Pump coin creation transaction…' : 'Preparing the Pump coin creation transaction…');
  const launchInstructions = paired
    ? await PUMP_SDK.createV2AndBuyV2Instructions({
      global: initialBuy.global,
      mint: mint.publicKey,
      name: launchInput.name,
      symbol: launchInput.symbol,
      uri: launchMetadataUri,
      creator: feeRouter,
      user: payer,
      amount: new BN(initialBuy.amountBaseUnits.toString()),
      quoteAmount: new BN(initialBuy.maxSolAmountLamports.toString()),
      mayhemMode: false,
      quoteMint,
      quoteTokenProgram,
      holderReward: false,
    })
    : initialBuy.amountBaseUnits > 0n
    ? await PUMP_SDK.createV2AndBuyInstructions({
      global: initialBuy.global,
      mint: mint.publicKey,
      name: launchInput.name,
      symbol: launchInput.symbol,
      uri: launchMetadataUri,
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
      uri: launchMetadataUri,
      creator: feeRouter,
      user: payer,
      mayhemMode: false,
      holderReward: false,
    })];
  const latest = await connection.getLatestBlockhash('confirmed');
  const plan = buildPumpLaunchPlan({ payer, mint, blockhash: latest.blockhash, launchInstructions,
    mintRouterInstruction: mintRouter?.instruction,
    reserveInstructions:[...reserve.instructions,...developerLockInstructions,...serviceInstructions], lookupTable });
  plan.steps.find(step => step.kind === 'launch').transaction.fundedLaunchSummary = {
    kind:'launch', mint:mint.publicKey.toBase58(), tokenName:launchInput.name, tokenSymbol:launchInput.symbol,
    ...(developerBuy.amountBaseUnits>0n?{developerLockSeconds:normalizeDeveloperLockSeconds(input.developerLockSeconds)}:{}),
    reserveTokens:String(input.reserveTokens), vault:reserve.vault.toBase58(),
    expectedSol:(Number(initialBuy.solAmountLamports) / 1_000_000_000).toFixed(9),
    maximumSol:(Number(initialBuy.maxSolAmountLamports) / 1_000_000_000).toFixed(9),
  };
  assertWalletCurrent();
  onStatus(plan.mintRouterSeparate ? 'Approve mint router initialization, then approve the Pump launch…'
    : 'Approve the Pump launch with richpad.fun set as creator-fee owner…');
  const {signature,mintRouterSignature}=await executeLaunchPlan({connection,provider,payer,mint,plan,assertWalletCurrent,onEvent:onJournal,beforeBroadcast});
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
  onStatus('Verifying Pump recorded richpad.fun—not the user—as creator-fee owner…');
  const [router, policy] = await Promise.all([
    verifyMintRouterV3Account({ connection, programId:v3FeeRouter.programId,
      mint:mint.publicKey, initialAuthority:v3FeeRouter.initialAuthority }),
    verifyMintPolicyV3Account({ connection, programId:v3FeeRouter.programId,
      mint:mint.publicKey, creator:payer, initialAuthority:v3FeeRouter.initialAuthority,
      split:v3FeeRouter.split }),
  ]);
  if (!router.verified || !policy.verified || !policy.protectedPolicy
    || policy.directedUnits.some((value, index) => value !== directedGrossUnits(input.feeShares)[index])
    || v3FeeRouter.agency&&(!policy.agencyPolicy||String(policy.configRevision)!==String(v3FeeRouter.agency.configRevision)
      ||policy.selectedMask!==agencySelectionMask(v3FeeRouter.agency.selectedAgents))) {
    throw new Error(`Coin was created, but its V3 fee router or policy is not verified. Mint: ${mint.publicKey.toBase58()}`);
  }
  const bondingCurve = await new OnlinePumpSdk(connection).fetchBondingCurve(mint.publicKey);
  if (!bondingCurve) throw new Error(`Coin was created, but its Pump bonding curve could not be verified. Mint: ${mint.publicKey.toBase58()}`);
  const feeRoute = verifyPermanentPumpCreatorRoute({ bondingCurve, feeRouter, payer });
  if (!feeRoute.verified) throw new Error(`Coin was created, but richpad.fun is not its Pump creator-fee owner. Mint: ${mint.publicKey.toBase58()}`);
  return { ...launchInput, mint, signature, mintRouterSignature, mintRouterSeparate: plan.mintRouterSeparate,
    mintRouterScope:mintRouter.scope, pump: true, feeRouter, feeRoute, launchBurnReceipt, initialBuy,
    reserveReceipt:{ signature, vault:reserve.vault.toBase58(), tokenAccount:reserve.destination.toBase58(), fundedTokens:input.reserveTokens, atomic:true },
    metadataUri: launchMetadataUri };
}
