import { PublicKey, Transaction } from '@solana/web3.js';
import { buildV3PolicyDisbursement } from './v3-policy-builders.mjs';
import { v3DisbursementId } from './v3-disbursement-id.mjs';
import { loadFinalizedV3RewardFunding } from './v3-reward-funding-proof.mjs';
import { createAutomaticRewardChain } from './automatic-reward-chain.mjs';
import { sendAndConfirmSigned } from './transaction-signing.mjs';
import { deriveMintWithdrawalV3 } from '../mint-router-v3.js';
import { verifyStoredPairedBonusConversion } from './daily-bonus-paired-conversion.mjs';
import { verifyStoredPairedBonusSettlement } from './daily-bonus-paired-settlement.mjs';

// Only fully converted source claims can fund a SOL reward vault. The exact
// category-5 withdrawal PDA recovers a finalized send after an app crash.
export async function fundPairedBonusSources({ connection, store, programId, keeper, launch,
  expectedProgramDataSha256, cluster='devnet', loadFunding=loadFinalizedV3RewardFunding,
  chainFactory=createAutomaticRewardChain, send=sendAndConfirmSigned }) {
  if (cluster!=='devnet' || launch?.pumpFeeRoute?.protocolSplit?.agencyPercent===undefined)
    throw new Error('Paired Daily bonus funding requires a reviewed Devnet agency policy.');
  const mint=launch.mint, state=await store.read();
  const sources=Object.values(state.v3TokenBonusSources||{}).filter(row=>row.mint===mint
    && row.cluster===cluster && row.programId===programId && row.payoutAsset==='SOL');
  if (!sources.length) return {funded:0,pending:0};
  for (const source of sources)
    await verifyStoredPairedBonusSettlement({connection,source,programId,cluster});
  const conversions=Object.values(state.v3TokenBonusConversions||{}).filter(row=>row.mint===mint
    && row.cluster===cluster && row.programId===programId && row.status==='finalized');
  const sourceMap=new Map(sources.map(row=>[row.signature,row]));
  for (const conversion of conversions)
    await verifyStoredPairedBonusConversion({connection,programId,cluster,conversion,sources:sourceMap});
  const chain=chainFactory({connection,programId,authority:keeper,expectedProgramDataSha256,cluster});
  if (!(await chain.readiness()).constrainedPayouts)
    throw new Error('Paired Daily bonus reward program is not verified.');
  let funded=0,pending=0;
  for (const source of sources) {
    const portions=conversions.flatMap(row=>(row.allocations||[]).filter(item=>item.settlementSignature===source.signature));
    const spent=portions.reduce((sum,row)=>sum+BigInt(row.spentQuoteRaw),0n);
    const lamports=portions.reduce((sum,row)=>sum+BigInt(row.receivedLamports),0n);
    if (spent>BigInt(source.bonusQuoteRaw)) throw new Error('Paired Daily bonus source was over-converted.');
    if (spent<BigInt(source.bonusQuoteRaw)) { pending++; continue; }
    if (!lamports) continue;
    const vault=await chain.ensureVault(mint);
    const withdrawalId=v3DisbursementId('community',source.signature);
    const amount=String(lamports),recipient=vault.toBase58();
    const proofOf=signature=>loadFunding({connection,cluster,signature,programId,mint,
      authority:keeper.publicKey,creator:launch.creatorWallet,
      initialAuthority:launch.pumpFeeRoute.initialAuthority,withdrawalId,
      category:5,amount,recipient,split:launch.pumpFeeRoute.protocolSplit,
      protectedPolicy:true,beneficiary:7,holderAmount:0n});
    let proof=null;
    const saved=(await store.read()).v3CommunityFunding?.[source.signature];
    if (saved?.status==='finalized') proof=await proofOf(saved.signature);
    else {
      const receiptAddress=deriveMintWithdrawalV3(programId,mint,withdrawalId);
      if (await connection.getAccountInfo(receiptAddress,'finalized')) {
        const refs=await connection.getSignaturesForAddress(receiptAddress,{limit:20},'finalized');
        for (const ref of refs) if (!ref.err && ref.confirmationStatus==='finalized') {
          proof=await proofOf(ref.signature); if (proof) break;
        }
        if (!proof) throw new Error('Paired Daily bonus funding receipt has no matching finalized transfer.');
      } else {
        const payout=buildV3PolicyDisbursement({programId,mint,authority:keeper.publicKey,
          creator:launch.creatorWallet,withdrawalId,category:5,beneficiary:7,
          amount:lamports,holderAmount:0n,recipient:vault,
          split:launch.pumpFeeRoute.protocolSplit,auto:true});
        const signature=await send(connection,new Transaction().add(payout.instruction),[keeper],{commitment:'finalized'});
        proof=await proofOf(signature);
      }
    }
    if (!proof?.balanceDeltaVerified || proof.amount!==amount || proof.recipient!==recipient
      || proof.category!==5 || proof.mint!==mint)
      throw new Error('Paired Daily bonus source lacks exact finalized SOL funding.');
    await store.update(current=>{
      current.v3CommunityFunding ||= {};
      const existing=current.v3CommunityFunding[source.signature];
      if (existing && (existing.signature!==proof.signature || existing.amount!==amount))
        throw new Error('Paired Daily bonus source funding changed after finalization.');
      current.v3CommunityFunding[source.signature] ||= {...proof,collectionSignature:source.signature,
        pairedSource:true,status:'finalized',finalizedAt:new Date().toISOString()};
    });
    funded++;
  }
  return {funded,pending};
}
