import {BOOST_PACKAGES} from './boost-offer.js';
export const DEFAULT_BOOST_PRICES=Object.freeze(Object.fromEntries(BOOST_PACKAGES.map(pack=>[pack.id,Math.round(pack.usd*100)])));
export function validateBoostPrices(prices){
  if(!prices||typeof prices!=='object'||Array.isArray(prices)||Object.keys(prices).length!==BOOST_PACKAGES.length
    ||Object.keys(prices).some(key=>!Object.hasOwn(DEFAULT_BOOST_PRICES,key))
    ||BOOST_PACKAGES.some(pack=>!Number.isSafeInteger(prices[pack.id])||prices[pack.id]<1||prices[pack.id]>10000000))
    throw Error('Enter a price from $0.01 to $100,000.00 for each boost package, in whole cents.');
  return Object.freeze(Object.fromEntries(BOOST_PACKAGES.map(pack=>[pack.id,prices[pack.id]])));
}
export function pricedBoostPackages(prices=DEFAULT_BOOST_PRICES){
  const validated=validateBoostPrices(prices);return BOOST_PACKAGES.map(pack=>({...pack,usd:validated[pack.id]/100}));
}
export function boostUsdCents(value){
  const match=/^(0|[1-9]\d{0,5})(?:\.(\d{1,2}))?$/.exec(String(value));
  if(!match)throw Error('Use dollars and at most two decimal places.');
  return Number(match[1])*100+Number((match[2]||'').padEnd(2,'0'));
}
