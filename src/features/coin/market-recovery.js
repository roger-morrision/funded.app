// Each fetch is deadline-bounded by the caller. Never use a catalog price as
// transaction reserves. A missing curve must not prevent canonical pool checks.
export async function recoverMarketSnapshots({curveResult,fetchCurve,fetchPool,isCurrent=()=>true}) {
  let curve=curveResult.status==='fulfilled'?curveResult.value:null,pool=null;
  if(!isCurrent())return {curve:null,pool:null};
  if(curveResult.status==='rejected')try{curve=await fetchCurve();}catch{}
  if(!isCurrent())return {curve:null,pool:null};
  if(!curve||curve.complete)try{pool=await fetchPool();}catch{}
  return isCurrent()?{curve,pool}:{curve:null,pool:null};
}
