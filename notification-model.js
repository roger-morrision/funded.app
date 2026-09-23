const recoveryStates=new Set(['broadcasting','submitted','unknown','confirmed','verification-pending','registration-pending']);
export function notificationItems(journal=[],creators=[]) {
  const items=[];
  for(const row of journal)if(recoveryStates.has(row.state))items.push({id:`launch:${row.id}:${row.state}:${row.signature||''}`,kind:'Local recovery reminder',
    title:`${String(row.name||'Launch').slice(0,80)} needs review`,text:'Check the saved receipt before retrying. Local history is not proof of mint verification or payment.',href:'#my-launches',at:row.updatedAt||''});
  for(const creator of creators)if(creator?.identityVerified===true&&/^\d{1,24}$/.test(creator.id))for(const update of (Array.isArray(creator.updates)?creator.updates:[]).slice(0,2)){
    if(!/^[a-f0-9]{24}$/.test(update.id)||typeof update.text!=='string')continue;
    items.push({id:`update:${creator.id}:${update.id}`,kind:'Followed creator update',title:String(creator.handle||'Creator').slice(0,16),text:update.text.slice(0,280),href:`/creator/x/${creator.id}`,at:update.createdAt||''});
  }
  return [...new Map(items.map(item=>[item.id,item])).values()].sort((a,b)=>String(b.at).localeCompare(String(a.at))).slice(0,50);
}
