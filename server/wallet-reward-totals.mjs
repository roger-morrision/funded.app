const integer=value=>/^-?(?:0|[1-9]\d*)$/.test(String(value));
const address=value=>/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(String(value));
export function walletRewardTotals({wallet,cluster,history,ledger,launches={},now=Date.now()}){
  requireSolanaCluster(cluster);
  const result={wallet,cluster,bonusLamports:null,rewardsLamports:null,airdrops:null};
  if(!address(wallet))throw new Error('A valid wallet is required.');
  if(history?.cluster===cluster&&history.status==='onchain-indexed'&&history.commitment==='finalized'
    &&(!history.payoutCoverage||history.payoutCoverage.status==='verified')&&Array.isArray(history.verifiedPayouts)){
    const seen=new Map();let bonus=0n,rewards=0n,valid=true;
    for(const row of history.verifiedPayouts){
      if(row.to!==wallet)continue;
      const key=`${row.signature}:${row.to}`;
      if(!integer(row.actualReceivedLamports)||!row.signature){valid=false;break;}
      const fingerprint=`${row.source}:${row.actualReceivedLamports}`;
      if(seen.has(key)){if(seen.get(key)!==fingerprint)valid=false;continue;}seen.set(key,fingerprint);
      if(row.source==='daily-bonus')bonus+=BigInt(row.actualReceivedLamports);
      if(['automatic-holder','automatic-creator','v3-creator-wallet'].includes(row.source))rewards+=BigInt(row.actualReceivedLamports);
    }
    if(valid){result.bonusLamports=String(bonus);result.rewardsLamports=String(rewards);}
  }
  const index=ledger?.communityClaimIndex;
  if(index?.cluster!==cluster||index.status!=='verified'||index.commitment!=='finalized'
    ||!Array.isArray(index.payments)||!Number.isFinite(Date.parse(index.indexedAt))
    ||Math.abs(now-Date.parse(index.indexedAt))>600000)return result;
  const tokens=new Map(),seen=new Set();
  for(const payment of index.payments){
    if(payment.recipient!==wallet)continue;
    const drop=ledger.communityDrops?.[payment.mint],leaf=drop?.manifest?.leaves?.find(row=>row.recipient===wallet);
    if(!financialRecordNetwork(drop,cluster,{legacyDevnet:true})||!drop?.openingSignature||drop.programId!==index.programId||!address(payment.payment)
      ||leaf?.amount!==payment.amountBaseUnits||!/^[1-9]\d*$/.test(String(payment.amountBaseUnits)))return result;
    const key=`${payment.mint}:${payment.payment}`;if(seen.has(key))continue;seen.add(key);
    if(!integer(drop.reservedBaseUnits)||!integer(drop.reservedTokens))return result;
    const reserve=BigInt(drop.reservedBaseUnits),whole=BigInt(drop.reservedTokens);if(whole<=0n||reserve<=0n||reserve%whole!==0n)return result;
    let scale=reserve/whole,decimals=0;while(scale>1n&&scale%10n===0n){scale/=10n;decimals++;}
    if(scale!==1n||decimals>9)return result;
    const prior=tokens.get(payment.mint);
    tokens.set(payment.mint,{mint:payment.mint,symbol:String(launches[payment.mint]?.symbol||'tokens').slice(0,16),decimals,
      amountBaseUnits:String(BigInt(prior?.amountBaseUnits||'0')+BigInt(payment.amountBaseUnits))});
  }
  result.airdrops=[...tokens.values()];return result;
}
import {requireSolanaCluster} from '../solana-network.js';
import {financialRecordNetwork} from './financial-network.mjs';
