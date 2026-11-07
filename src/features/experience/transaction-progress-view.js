// Presentation follows recorded evidence, never a timer or a successful HTTP response.
export function transactionProgress(kind, row) {
  if(kind==='claim') {
    if(row.receiptVerified===true)return{stage:'Verified',detail:'Payment receipt verified. Inspect the destination and amount.'};
    if(['paid','executing','verification-pending'].includes(row.status))return{stage:'Verifying',detail:'Payment outcome is being checked. Check the existing claim before retrying.'};
    return row.canPrepare?{stage:'Approval',detail:'Select this reward, connect the recipient wallet and review the claim.'}
      :{stage:'Waiting',detail:'Funding or eligibility checks remain. Refresh the claim status.'};
  }
  if(kind==='trade')return row.progress==='indexing'?{stage:'Indexing',detail:'Balance change verified; history is still updating.'}
    :{stage:'Verifying',detail:'Check finalization and balance changes for the saved transaction.'};
  return ['confirmed','verification-pending','registration-pending'].includes(row.state)
    ?{stage:'Verifying',detail:'Check the mint and complete registration for this launch.'}
    :{stage:row.signature?'Verifying':'Review',detail:'Review saved progress before starting another launch.'};
}
export function progressView(document,kind,row) {
  const state=transactionProgress(kind,row),view=document.createElement('div');view.className='transaction-progress';
  const label=document.createElement('strong');label.textContent=state.stage;
  const detail=document.createElement('span');detail.textContent=state.detail;
  view.append(label,detail);return view;
}
