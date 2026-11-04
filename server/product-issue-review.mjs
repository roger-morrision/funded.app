export const issueStates=['received','investigating','fixed','needs-information'];

// Both operator routes use the version the reviewer actually saw. The check
// and write must share the store's transaction to prevent lost updates.
export async function reviewProductIssue({store,id,input}){
  if(!input||!issueStates.includes(input.status)||typeof input.note!=='string'||input.note.length>500)
    return {status:400,data:{error:'Choose a valid status and a note up to 500 characters.'}};
  if(typeof input.expectedUpdatedAt!=='string'||!Number.isFinite(Date.parse(input.expectedUpdatedAt)))
    return {status:400,data:{error:'Reload reported issues to review the current report version.'}};
  return store.update(state=>{
    const row=state.productIssues?.[id];
    if(!row)return {status:404,data:{error:'Report not found.'}};
    if(row.updatedAt!==input.expectedUpdatedAt)
      return {status:409,data:{error:'This report changed. Reload reported issues and review it again.'}};
    row.status=input.status;row.note=input.note;
    row.updatedAt=new Date(Math.max(Date.now(),Date.parse(row.updatedAt)+1)).toISOString();
    return {status:200,data:{id,status:row.status,note:row.note,updatedAt:row.updatedAt}};
  });
}
