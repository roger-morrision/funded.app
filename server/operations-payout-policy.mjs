import {randomUUID} from 'node:crypto';

// Category-1 (operations) protocol-vault payouts bypass the creator-signature
// requirement via an immutable automation record (see contracts
// instructions/automation_v3.rs). On Mainnet this is gated here instead: the
// automated worker (server/v3-paired-token-worker.mjs) may only submit a
// category-1 disbursement once a *different* admin has approved the exact
// (mint, category, recipient, amount) tuple through the email-OTP-confirmed
// /api/admin/operations-payouts/* routes. Categories 2-4 already require the
// creator's own signature on Mainnet and are out of scope here.
const SOL=1_000_000_000,REQUEST_LIFETIME_MS=7*24*60*60*1000;
const error=(status,message)=>Object.assign(Error(message),{status});
const OPEN_STATUSES=['pending','approved'];

function setting(env,name,fallback){
  const raw=env[name];
  if(raw===undefined||raw==='')return fallback;
  if(!/^\d+$/.test(String(raw))||!Number.isSafeInteger(Number(raw)))throw error(503,`${name} is invalid.`);
  return Number(raw);
}
export function operationsPayoutLimits(env=process.env){
  return{maxLamports:setting(env,'FUNDED_OPERATIONS_PAYOUT_MAX_LAMPORTS',5*SOL)};
}
function sameRequest(row,{mint,quoteMint,category,recipient,amountLamports}){
  return row.mint===mint&&(row.quoteMint||null)===(quoteMint||null)&&row.category===category
    &&row.recipient===recipient&&row.amountLamports===amountLamports;
}

export function createOperationsPayoutPolicy({store,env=process.env,now=Date.now}){
  const view=row=>({...row,expired:row.status==='pending'&&now()>=Date.parse(row.expiresAt)});

  async function list(){
    const state=await store.read();
    return Object.values(state.operationsPayoutRequests||{})
      .sort((a,b)=>b.requestedAt.localeCompare(a.requestedAt)).map(view);
  }

  async function request({admin,mint,quoteMint,category,recipient,amount}){
    if(category!==1)throw error(400,'Only the category-1 operations budget uses this approval flow.');
    if(typeof mint!=='string'||!mint)throw error(400,'A mint is required.');
    if(typeof recipient!=='string'||!recipient)throw error(400,'A recipient is required.');
    if(!Number.isSafeInteger(amount)||amount<1)throw error(400,'Enter a positive exact lamport amount.');
    const {maxLamports}=operationsPayoutLimits(env);
    if(amount>maxLamports)throw error(409,`Amount exceeds the ${maxLamports/SOL} SOL per-request limit.`);
    const at=now(),row={id:randomUUID(),mint,quoteMint:quoteMint||null,category,recipient,amountLamports:String(amount),
      requestedBy:admin,status:'pending',requestedAt:new Date(at).toISOString(),expiresAt:new Date(at+REQUEST_LIFETIME_MS).toISOString()};
    await store.update(state=>{
      state.operationsPayoutRequests||={};
      const duplicate=Object.values(state.operationsPayoutRequests).some(item=>item.mint===mint&&item.category===category
        &&OPEN_STATUSES.includes(item.status)&&Date.parse(item.expiresAt)>at);
      if(duplicate)throw error(409,'This mint already has an open operations-payout request. Cancel it first.');
      state.operationsPayoutRequests[row.id]=row;
    });
    return view(row);
  }

  async function approve({admin,requestId}){
    const saved=await store.update(state=>{
      const row=state.operationsPayoutRequests?.[String(requestId||'')];
      if(!row)throw error(404,'Operations-payout request not found.');
      if(row.status!=='pending')throw error(409,'Only a pending request can be approved.');
      if(row.requestedBy===admin)throw error(403,'A different admin must approve this request.');
      if(now()>=Date.parse(row.expiresAt))throw error(409,'This request has expired.');
      Object.assign(row,{status:'approved',approvedBy:admin,approvedAt:new Date(now()).toISOString()});
      return row;
    });
    return view(saved);
  }

  async function cancel({admin,requestId}){
    const saved=await store.update(state=>{
      const row=state.operationsPayoutRequests?.[String(requestId||'')];
      if(!row)throw error(404,'Operations-payout request not found.');
      if(!OPEN_STATUSES.includes(row.status))throw error(409,'This request can no longer be cancelled.');
      Object.assign(row,{status:'cancelled',cancelledBy:admin,cancelledAt:new Date(now()).toISOString()});
      return row;
    });
    return view(saved);
  }

  // Called by the automated worker only. Atomically consumes one matching
  // approved, unexpired request; never creates or infers one.
  async function claim({mint,quoteMint,category,recipient,amount}){
    const amountLamports=String(amount);
    let claimed=null;
    await store.update(state=>{
      const rows=Object.values(state.operationsPayoutRequests||{});
      const row=rows.find(item=>item.status==='approved'&&Date.parse(item.expiresAt)>now()
        &&sameRequest(item,{mint,quoteMint,category,recipient,amountLamports}));
      if(!row)return;
      row.status='consumed';row.consumedAt=new Date(now()).toISOString();
      claimed=row;
    });
    return claimed?view(claimed):null;
  }

  return{list,request,approve,cancel,claim,limits:()=>operationsPayoutLimits(env)};
}
