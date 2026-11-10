import {APP_REFERRAL_LEVELS,FEE_DISTRIBUTION} from '../../../distribution-policy.js';
import {MARKETING_AGENCY_POLICY} from '../../../config/marketing-agency.js';

// Presentation of the approved agency policy must not rewrite a saved mint's
// entitlement or assert that new contract bytes have already been deployed.
export function referralRatePresentation(){
  const published=FEE_DISTRIBUTION.agencyEffectivePercent===2;
  const current=APP_REFERRAL_LEVELS.map(level=>level.effectivePercentOfCreatorFees);
  const rates=published?current:MARKETING_AGENCY_POLICY.referralUnits.map(units=>units/100000);
  const total=Number(rates.reduce((sum,rate)=>sum+rate,0).toFixed(4));
  const levels=rates.map((rate,index)=>({level:index+1,rate}));
  const scope=published?'Published rates for new launches. Existing coins keep their saved rates.'
    :'Awaiting V3 agency activation. Existing coins keep their saved rates.';
  // Mention the live deployment only when it differs; otherwise it repeats the approved rates.
  const sameRates=current.length===rates.length&&current.every((rate,index)=>rate===rates[index]);
  const deployment=published||sameRates?'':`Until activation, the published deployment uses ${current.map((rate,index)=>`L${index+1} ${rate}%`).join(' / ')}. `;
  // One worked number makes the percentages concrete; it reads from the same rate table.
  const direct=Number((10*levels[0].rate/100).toFixed(6));
  const example=`${published?'Example':'Example at the approved rates'}: a creator you invited collects 10 SOL in creator fees. As their direct referrer you receive ${direct} SOL.`;
  return{levels,total,pending:!published,example,
    heading:published?`Referral rates · ${total}% total`:`Approved referral rates · ${total}% total`,
    scope,scopeDetail:`${scope} ${deployment}Each payout follows its coin’s saved on-chain policy.`,
    guide:`${levels.map(({level,rate})=>`Level ${level}: ${rate}% of gross collected creator fees`).join(' · ')}. ${total}% total. ${scope} ${deployment}Each payout follows its coin’s saved on-chain policy.`,
  };
}
