import { deriveTokenLedgerV3, deriveTokenConversionV3, decodeTokenLedgerV3 } from '../mint-router-v3-token.js';
import { isDeepStrictEqual } from 'node:util';
import { allocatePairedBonusSol, pairedBonusConversionId,
  loadFinalizedPairedBonusConversion } from './daily-bonus-paired-conversion.mjs';
import { convertTokenBudgetToSol } from './v3-token-keeper.mjs';

const integer = value => /^(0|[1-9]\d*)$/.test(String(value)) ? BigInt(value) : null;

// Convert only a complete, finalized category-5 claim prefix. The durable
// intent survives a crash after transaction submission: replay first searches
// the deterministic receipt PDA and only then attempts an unconsumed ID.
export async function processPairedBonusConversion({ connection, store, programId, keeper,
  mint, quoteMint, cluster='devnet', lookupTable=null, minQuoteRaw=1n,
  convert=convertTokenBudgetToSol, loadConversion=loadFinalizedPairedBonusConversion }) {
  if (cluster!=='devnet') throw new Error('Paired Daily bonus conversion is Devnet-only until reviewed.');
  const state=await store.read();
  const scan=state.v3TokenBonusScans?.[`${cluster}:${mint}:${quoteMint}`];
  if (scan?.backfillComplete!==true) return {status:'indexing'};
  const ledgerAddress=deriveTokenLedgerV3(programId,mint,quoteMint);
  const ledgerAccount=await connection.getAccountInfo(ledgerAddress,'finalized');
  if (!ledgerAccount) throw new Error('Paired Daily bonus token ledger is unavailable.');
  const ledger=decodeTokenLedgerV3(ledgerAccount.data);
  if (ledger.mint!==mint || ledger.quoteMint!==quoteMint)
    throw new Error('Paired Daily bonus token ledger identity changed.');
  const budget=ledger.paid[5]-ledger.withdrawn[5];
  if (budget<0n) throw new Error('Paired Daily bonus token ledger is overdrawn.');
  const sources=Object.values(state.v3TokenBonusSources||{}).filter(row=>row.cluster===cluster
    && row.programId===programId && row.mint===mint && row.quoteMint===quoteMint)
    .sort((a,b)=>a.slot-b.slot||a.signature.localeCompare(b.signature));
  const conversions=Object.values(state.v3TokenBonusConversions||{}).filter(row=>row.cluster===cluster
    && row.programId===programId && row.mint===mint && row.quoteMint===quoteMint);
  const consumed=new Map();
  for (const conversion of conversions.filter(row=>row.status==='finalized'))
    for (const item of conversion.allocations||[]) consumed.set(item.settlementSignature,
      (consumed.get(item.settlementSignature)||0n)+BigInt(item.spentQuoteRaw));
  const claims=sources.map(row=>{
    const available=BigInt(row.bonusQuoteRaw)-(consumed.get(row.signature)||0n);
    if (available<0n) throw new Error('Paired bonus source was consumed twice.');
    return {mint,quoteMint,settlementSignature:row.signature,settlementSlot:row.slot,
      claimId:row.claimId,availableQuoteRaw:String(available)};
  }).filter(row=>BigInt(row.availableQuoteRaw)>0n);
  const total=claims.reduce((sum,row)=>sum+BigInt(row.availableQuoteRaw),0n);
  const pending=conversions.filter(row=>row.status==='prepared');
  if (pending.length>1 || !pending.length && total!==budget)
    throw new Error('Paired bonus claims do not reconcile with the on-chain category-5 budget.');
  if (!pending.length && budget<BigInt(minQuoteRaw)) return {status:'carrying-forward',quoteRaw:String(budget)};
  let intent=pending[0];
  if (!intent) {
    const id=pairedBonusConversionId({mint,quoteMint,claims}).toString('hex');
    intent={conversionId:id,cluster,programId,mint,quoteMint,status:'prepared',
      amountQuoteRaw:String(budget),claims,createdAt:new Date().toISOString()};
    await store.update(current=>{
      current.v3TokenBonusConversions ||= {};
      if (current.v3TokenBonusConversions[id]) throw new Error('Paired bonus conversion identity was already used.');
      current.v3TokenBonusConversions[id]=intent;
    });
  }
  const id=Buffer.from(intent.conversionId,'hex');
  let proof;
  try { proof=await loadConversion({connection,programId,mint,quoteMint,conversionId:id,
    maxSpentQuoteRaw:intent.amountQuoteRaw,cluster}); }
  catch(error) {
    if (!String(error.message).includes('account is unavailable')) throw error;
    try{await convert({connection,programId,keeper,mint,quoteMint,category:5,
      amount:BigInt(intent.amountQuoteRaw),cluster,lookupTable,conversionId:id});}
    catch(sendError){
      if(!String(sendError.message).includes('too small to quote a SOL output'))throw sendError;
      if(await connection.getAccountInfo(deriveTokenConversionV3(programId,mint,id),'finalized'))throw sendError;
      await store.update(current=>{
        if(current.v3TokenBonusConversions?.[intent.conversionId]?.status==='prepared')
          delete current.v3TokenBonusConversions[intent.conversionId];
      });
      return {status:'carrying-forward',quoteRaw:intent.amountQuoteRaw};
    }
    proof=await loadConversion({connection,programId,mint,quoteMint,conversionId:id,
      maxSpentQuoteRaw:intent.amountQuoteRaw,cluster});
  }
  if (proof.balanceDeltaVerified!==true || proof.conversionId!==intent.conversionId
    || proof.mint!==mint || proof.quoteMint!==quoteMint || integer(proof.receivedLamports)===null)
    throw new Error('Paired bonus conversion lacks matching finalized SOL evidence.');
  const allocations=allocatePairedBonusSol({claims:intent.claims,
    spentQuoteRaw:proof.spentQuoteRaw,receivedLamports:proof.receivedLamports});
  await store.update(current=>{
    const row=current.v3TokenBonusConversions?.[intent.conversionId];
    if (!row || row.status!=='prepared' || !isDeepStrictEqual(row,intent))
      throw new Error('Paired bonus conversion intent changed during finalization.');
    current.v3TokenBonusConversions[intent.conversionId]={...row,status:'finalized',...proof,allocations,
      finalizedAt:new Date().toISOString()};
  });
  return {status:'converted',signature:proof.signature,spentQuoteRaw:proof.spentQuoteRaw,
    receivedLamports:proof.receivedLamports,sources:allocations.length};
}
