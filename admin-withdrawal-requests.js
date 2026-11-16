// Large admin withdrawals: a request that a second admin approves, which opens
// after a delay. The server enforces every rule; this view lists requests and
// creates one when a withdrawal above the review limit has none approved.
const sol=lamports=>{const units=BigInt(lamports);return `${units/1000000000n}.${String(units%1000000000n).padStart(9,'0')}`.replace(/\.?0+$/,'');};
const short=value=>value?`${value.slice(0,4)}…${value.slice(-4)}`:'';
const when=value=>new Date(value).toLocaleString();
const OPEN=new Set(['pending','approved']);

export function createWithdrawalRequests({api,post,report,document=globalThis.document,anchor}){
  const panel=document.createElement('div');panel.className='withdraw-requests';
  const summary=document.createElement('p'),list=document.createElement('ul');
  panel.append(summary);panel.append(list);anchor?.after?.(panel);
  let data={limits:null,requests:[],admin:''};

  function button(label,action,id){
    const node=document.createElement('button');node.type='button';node.textContent=label;
    node.addEventListener('click',()=>{node.disabled=true;
      void post(`/api/admin/withdrawals/${action}`,{requestId:id}).then(()=>{report(action==='approve'?'Withdrawal request approved.':'Withdrawal request cancelled.');return load();})
        .catch(error=>report(error.message,true)).finally(()=>{node.disabled=false;});});
    return node;
  }
  function render(){
    const limits=data.limits;
    summary.textContent=limits?`Limits: ${sol(limits.maxLamports)} SOL per withdrawal, ${sol(limits.dailyLamports)} SOL per 24 hours. Above ${sol(limits.reviewLamports)} SOL a second admin must approve, and the withdrawal opens ${Math.round(limits.delaySeconds/3600)} h after the request.`:'';
    list.replaceChildren?.();
    for(const row of data.requests||[]){
      const item=document.createElement('li');
      const state=row.status==='approved'?(row.usable?'approved, ready':`approved, opens ${when(row.availableAt)}`):row.status;
      const text=document.createElement('span');
      text.textContent=`${sol(row.amountLamports)} SOL from ${short(row.source)} · requested by ${short(row.requestedBy)} · ${state}${row.approvedBy?` · approved by ${short(row.approvedBy)}`:''}`;
      item.append(text);
      if(row.status==='pending'&&row.requestedBy!==data.admin)item.append(button('Approve','approve',row.id));
      if(OPEN.has(row.status))item.append(button('Cancel','cancel',row.id));
      list.append(item);
    }
  }
  async function load(){
    try{const next=await api('/api/admin/withdrawals/requests');if(next?.limits)data=next;render();}catch{}
    return data;
  }
  // Returns {requestId} to continue, or {stop: message} when the withdrawal must wait.
  async function gate({source,amount}){
    const {limits,requests=[],admin}=await load();
    if(!limits||amount<=limits.reviewLamports)return{};
    const ready=requests.find(row=>row.usable&&row.source===source&&Number(row.amountLamports)===amount&&row.requestedBy===admin);
    if(ready)return{requestId:ready.id};
    const open=requests.find(row=>row.source===source&&OPEN.has(row.status));
    if(open){
      if(Number(open.amountLamports)!==amount)return{stop:`This source has an open request for ${sol(open.amountLamports)} SOL. Use that amount or cancel the request.`};
      return{stop:open.status==='pending'?'This withdrawal is waiting for a second admin to approve it.':`This withdrawal opens at ${when(open.availableAt)}.`};
    }
    const created=await post('/api/admin/withdrawals/request',{source,amountLamports:amount});await load();
    return{stop:`Withdrawals above ${sol(limits.reviewLamports)} SOL need a second admin. Request created; after approval it opens at ${when(created.availableAt)}.`};
  }
  return{load,gate};
}
