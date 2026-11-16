import {randomUUID} from 'node:crypto';

// Limits on admin treasury withdrawals, enforced on the server before any
// source signature is produced:
// - every withdrawal is capped (FUNDED_ADMIN_WITHDRAW_MAX_LAMPORTS);
// - all withdrawals in a rolling 24 hours are capped (FUNDED_ADMIN_WITHDRAW_DAILY_LAMPORTS);
// - a withdrawal above FUNDED_ADMIN_WITHDRAW_REVIEW_LAMPORTS needs a request
//   that a different admin approved, and it opens only after
//   FUNDED_ADMIN_WITHDRAW_DELAY_SECONDS, so a stolen admin wallet and email
//   cannot empty a treasury at once.
const SOL=1_000_000_000,DAY_MS=24*60*60*1000,REQUEST_LIFETIME_MS=7*DAY_MS;
const error=(status,message)=>Object.assign(Error(message),{status});
const TERMINAL_INTENT=new Set(['finalized','failed-finalized','expired']);

function setting(env,name,fallback){
  const raw=env[name];
  if(raw===undefined||raw==='')return fallback;
  if(!/^\d+$/.test(String(raw))||!Number.isSafeInteger(Number(raw)))throw error(503,`${name} is invalid.`);
  return Number(raw);
}
export function withdrawalLimits(env=process.env){
  return{maxLamports:setting(env,'FUNDED_ADMIN_WITHDRAW_MAX_LAMPORTS',10*SOL),
    dailyLamports:setting(env,'FUNDED_ADMIN_WITHDRAW_DAILY_LAMPORTS',20*SOL),
    reviewLamports:setting(env,'FUNDED_ADMIN_WITHDRAW_REVIEW_LAMPORTS',2*SOL),
    delaySeconds:setting(env,'FUNDED_ADMIN_WITHDRAW_DELAY_SECONDS',24*60*60)};
}

// Finalized receipts in the last 24 hours plus withdrawals still in flight.
export function withdrawnInWindow(state,at){
  let total=0;
  for(const row of Object.values(state.adminAudit||{}))
    if(row?.action==='wallet-withdrawal'&&Date.parse(row.at)>at-DAY_MS)total+=Number(row.amountLamports)||0;
  for(const row of Object.values(state.adminWithdrawalIntents||{}))
    if(row&&!TERMINAL_INTENT.has(row.status)&&row.amountLamports!==undefined&&(row.status!=='preparing'||row.leaseUntil>at))
      total+=Number(row.amountLamports)||0;
  return total;
}

export function createWithdrawalPolicy({store,env=process.env,now=Date.now}){
  const limits=()=>withdrawalLimits(env);
  const view=row=>({...row,usable:row.status==='approved'&&now()>=Date.parse(row.availableAt)&&now()<Date.parse(row.expiresAt)});

  // Checks caps for a new withdrawal; returns true when it needs an approved request.
  function check(state,amount){
    const {maxLamports,dailyLamports,reviewLamports}=limits();
    if(amount>maxLamports)throw error(409,`Amount exceeds the ${maxLamports/SOL} SOL per-withdrawal limit.`);
    const used=withdrawnInWindow(state,now());
    if(used+amount>dailyLamports)throw error(409,`Amount exceeds the 24-hour withdrawal limit (${dailyLamports/SOL} SOL; ${used/SOL} SOL already used).`);
    return amount>reviewLamports;
  }

  // Inside a store update: verifies the approved request and marks it used.
  function claim(state,{requestId,source,amount,admin,intentId}){
    const row=state.adminWithdrawalRequests?.[String(requestId||'')];
    if(!row)throw error(403,'Withdrawals above the review limit need a request approved by a second admin.');
    if(row.source!==source||Number(row.amountLamports)!==amount||row.requestedBy!==admin)
      throw error(409,'The approved request is for a different source, amount or admin.');
    if(row.status!=='approved'||!row.approvedBy||row.approvedBy===admin)throw error(403,'This request has not been approved by a second admin.');
    if(now()<Date.parse(row.availableAt))throw error(409,`This withdrawal opens at ${row.availableAt}.`);
    if(now()>=Date.parse(row.expiresAt))throw error(409,'This approved request has expired. Create a new request.');
    Object.assign(row,{status:'used',usedAt:new Date(now()).toISOString(),intentId});
  }

  async function handle(req,res,path,{admin,input,json,sourceRole}){
    if(req.method==='GET'&&path==='/api/admin/withdrawals/requests'){
      const rows=Object.values((await store.read()).adminWithdrawalRequests||{})
        .filter(row=>Date.parse(row.requestedAt)>now()-30*DAY_MS).sort((a,b)=>b.requestedAt.localeCompare(a.requestedAt)).map(view);
      return json(res,200,{limits:limits(),requests:rows,admin});
    }
    if(req.method!=='POST')return false;
    if(path==='/api/admin/withdrawals/request'){
      const source=String(input.source||''),amount=Number(input.amountLamports);
      sourceRole(source,admin);
      if(!Number.isSafeInteger(amount)||amount<1)throw error(400,'Enter a positive exact SOL amount.');
      const {maxLamports,reviewLamports,delaySeconds}=limits();
      if(amount<=reviewLamports)throw error(400,'This amount is within the review limit and needs no approval.');
      if(amount>maxLamports)throw error(409,`Amount exceeds the ${maxLamports/SOL} SOL per-withdrawal limit.`);
      const at=now(),row={id:randomUUID(),source,amountLamports:String(amount),requestedBy:admin,status:'pending',
        requestedAt:new Date(at).toISOString(),availableAt:new Date(at+delaySeconds*1000).toISOString(),expiresAt:new Date(at+delaySeconds*1000+REQUEST_LIFETIME_MS).toISOString()};
      await store.update(state=>{state.adminWithdrawalRequests||={};
        if(Object.values(state.adminWithdrawalRequests).some(item=>item.source===source&&['pending','approved'].includes(item.status)&&Date.parse(item.expiresAt)>at))
          throw error(409,'This source already has an open withdrawal request. Cancel it first.');
        state.adminWithdrawalRequests[row.id]=row;});
      return json(res,201,view(row));
    }
    if(path==='/api/admin/withdrawals/approve'||path==='/api/admin/withdrawals/cancel'){
      const approve=path.endsWith('/approve');
      const saved=await store.update(state=>{
        const row=state.adminWithdrawalRequests?.[String(input.requestId||'')];
        if(!row)throw error(404,'Withdrawal request not found.');
        const at=new Date(now()).toISOString();
        if(approve){
          if(row.status!=='pending')throw error(409,'Only a pending request can be approved.');
          if(row.requestedBy===admin)throw error(403,'A different admin must approve this request.');
          if(now()>=Date.parse(row.expiresAt))throw error(409,'This request has expired.');
          Object.assign(row,{status:'approved',approvedBy:admin,approvedAt:at});
        }else{
          if(!['pending','approved'].includes(row.status))throw error(409,'This request can no longer be cancelled.');
          Object.assign(row,{status:'cancelled',cancelledBy:admin,cancelledAt:at});
        }
        return row;});
      return json(res,200,view(saved));
    }
    return false;
  }
  return{limits,check,claim,handle};
}
