import { TOKEN_PROGRAM_ID, unpackMint } from '@solana/spl-token';
import { executeLaunchPlan } from './launch-executor.js';
import { promotionBurnStep, verifyPromotionBurnBinding } from './launch-promotion-receipt.js';

export async function confirmPromotionBurn({connection,provider,payer,mint,burnPlan,quoteId,onJournal,onStatus,assertWalletCurrent,beforeBroadcast}) {
  onStatus(`First approve burning ${burnPlan.amountTokens.toLocaleString()} $FUNDED. Coin creation follows after confirmation.`);
  const latest=await connection.getLatestBlockhash('finalized');
  const step=promotionBurnStep({payer,mint,burnInstruction:burnPlan.instruction,quoteId,blockhash:latest.blockhash});
  const {signature}=await executeLaunchPlan({connection,provider,payer,mint,plan:{steps:[step]},onEvent:onJournal,assertWalletCurrent,beforeBroadcast});
  const transaction=await connection.getTransaction(signature,{commitment:'finalized',maxSupportedTransactionVersion:0});
  verifyPromotionBurnBinding({transaction,payer:payer.toBase58(),mint:mint.publicKey.toBase58(),quoteId});
  const pre=transaction.meta.preTokenBalances?.find(row=>row.mint===burnPlan.mint.toBase58()&&row.owner===payer.toBase58());
  const post=transaction.meta.postTokenBalances?.find(row=>row.accountIndex===pre?.accountIndex);
  if(!pre||!post||BigInt(pre.uiTokenAmount.amount)-BigInt(post.uiTokenAmount.amount)!==burnPlan.amount)
    throw Error(`Promotion burn ${signature} finalized, but its exact token reduction could not be verified. Do not burn again.`);
  const view=await connection.getAccountInfoAndContext(burnPlan.mint,{commitment:'finalized',minContextSlot:transaction.slot});
  const mintAfter=unpackMint(burnPlan.mint,view.value,TOKEN_PROGRAM_ID);
  if(view.context.slot<transaction.slot||mintAfter.supply>burnPlan.supplyBefore-burnPlan.amount)
    throw Error(`Promotion burn ${signature} finalized, but supply verification is pending. Do not burn again.`);
  assertWalletCurrent();
  return {signature,slot:transaction.slot,blockTime:transaction.blockTime,instruction:'BurnChecked',mint:burnPlan.mint.toBase58(),
    tokenAccount:burnPlan.tokenAccount.toBase58(),amountTokens:burnPlan.amountTokens,amountBaseUnits:burnPlan.amount.toString(),
    decimals:burnPlan.decimals,supplyBefore:burnPlan.supplyBefore.toString(),supplyAfter:mintAfter.supply.toString(),
    atomicWithPumpLaunch:false,confirmedBeforeLaunch:true,verified:true};
}
