const programs=new Set(['TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA','TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb']);
const integer=value=>typeof value==='string'&&/^(0|[1-9]\d*)$/.test(value)&&BigInt(value)<=18446744073709551615n;
const unavailable=reason=>({status:'unavailable',reason});

export function formatBurnTokens(raw,decimals){
  const scale=10n**BigInt(decimals),amount=BigInt(raw);
  const whole=(amount/scale).toString().replace(/\B(?=(\d{3})+(?!\d))/g,',');
  const fraction=(amount%scale).toString().padStart(decimals,'0').replace(/0+$/,'');
  return whole+(fraction?`.${fraction}`:'');
}

// Pump's per-mint supply baseline and an immutable mint let us count all supply
// reductions, including burns outside the app. Never infer burns from transfers.
export function tokenBurnSummary({mint,parsedMint,curve,tokenProgram}={}){
  if(!programs.has(tokenProgram)||parsedMint?.isInitialized!==true||!integer(parsedMint.supply))return unavailable('Current token supply could not be verified.');
  if(parsedMint.mintAuthority!==null)return unavailable('Full burn totals require a token with minting permanently disabled.');
  if(parsedMint.decimals!==6||!mint||curve?.mint!==mint||!integer(curve.tokenTotalSupplyBaseUnits)||BigInt(curve.tokenTotalSupplyBaseUnits)===0n)return unavailable('Original supply unavailable for this token.');
  const initial=BigInt(curve.tokenTotalSupplyBaseUnits),current=BigInt(parsedMint.supply);
  if(current>initial)return unavailable('Current and original supply do not reconcile. Burn totals are unavailable.');
  const burned=initial-current,scaled=burned*100000000n/initial;
  const percent=burned>0n&&scaled===0n?'<0.000001%':`${scaled/1000000n}${scaled%1000000n?'.'+(scaled%1000000n).toString().padStart(6,'0').replace(/0+$/,''):''}%`;
  return {status:'ready',burnedBaseUnits:burned.toString(),initialBaseUnits:initial.toString(),currentBaseUnits:current.toString(),
    burnedTokens:formatBurnTokens(burned,6),initialTokens:formatBurnTokens(initial,6),currentTokens:formatBurnTokens(current,6),burnedPercent:percent};
}
