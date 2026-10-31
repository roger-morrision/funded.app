export function archiveDevnetLaunches(state,mints,at=new Date().toISOString()) {
  if(!Array.isArray(mints)||new Set(mints).size!==mints.length)throw Error('Exact unique Devnet mint inventory is required.');
  for(const mint of mints)if(state.launches?.[mint]?.cluster!=='devnet')throw Error('Archive inventory contains a missing or non-Devnet launch.');
  for(const mint of mints)Object.assign(state.launches[mint],{archivedAt:at,archivedReason:'replaced-by-automated-devnet-release'});
  state.adminAudit||={};state.adminAudit[`devnet-archive:${at}`]={action:'archive-devnet-launches',mints,at,receiptsPreserved:true};
  return {archived:mints.length,mints,at,receiptsPreserved:true};
}
