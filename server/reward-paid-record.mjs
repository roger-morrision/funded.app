import assert from 'node:assert/strict';
import {isDeepStrictEqual} from 'node:util';

// First success and saved-attempt recovery publish the same facts. Enrichment
// preserves timestamps/metadata; a matching complete record is never replaced.
export function completedRewardPayment(previous,leaf,result){
  assert(result?.finalized===true&&result.balanceDeltaVerified===true,'Verified payout result required.');
  const facts={status:'paid',bitmap:result.bitmap===true,amount:leaf.amount,amountReceived:result.amountReceived,index:leaf.index,
    signature:result.signature,payment:result.payment,finalized:true,balanceDeltaVerified:true,
    ...(result.payoutTransactionVerified===true?{payoutTransactionVerified:true}:{}),...(result.batch?{batch:result.batch}:{})};
  if(previous?.status==='paid')for(const name of ['bitmap','amount','amountReceived','index','signature','payment']){
    if(previous[name]!==undefined&&previous[name]!==null)assert(String(previous[name])===String(facts[name]),'Existing paid reward conflicts with verified payout.');
  }
  const matching=previous?.status==='paid'&&typeof previous.paidAt==='string'&&previous.paidAt.length>0
    &&Object.entries(facts).every(([name,value])=>isDeepStrictEqual(previous[name],value));
  if(matching)return {record:previous,changed:false};
  return {record:{...previous,...facts,paidAt:previous?.paidAt||new Date().toISOString()},changed:true};
}
