import {PublicKey} from '@solana/web3.js';

// Watches app treasuries, signer wallets and program vaults for SOL leaving
// them, and the fee router's authority and upgrade authority for changes.
// Each check compares finalized balances with the last saved snapshot
// (store bucket outflowWatch) and emails the admin when:
// - one check drops more than FUNDED_OUTFLOW_ALERT_LAMPORTS (default 1 SOL);
// - the last 24 hours drop more than FUNDED_OUTFLOW_DAILY_ALERT_LAMPORTS (default 5 SOL);
// - the router authority or program upgrade authority changes.
// Balances are net: an inflow in the same interval hides part of an outflow.
const SOL=1_000_000_000,DAY_MS=24*60*60*1000;
const ROUTER_SEED=Buffer.from('funded-fee-router-v1'),MINT_VAULT_SEED=Buffer.from('mint-fee-vault-v3'),REWARD_VAULT_SEED=Buffer.from('reward-vault-v1');
const LOADER=new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111');
const sol=lamports=>(lamports/SOL).toFixed(4).replace(/\.?0+$/,'');
const short=value=>`${value.slice(0,4)}…${value.slice(-4)}`;
const key=value=>{try{return new PublicKey(value).toBase58();}catch{return null;}};

function setting(env,name,fallback){
  const raw=env[name];if(raw===undefined||raw==='')return fallback;
  return /^\d+$/.test(String(raw))&&Number.isSafeInteger(Number(raw))?Number(raw):fallback;
}
export function outflowLimits(env=process.env){
  return{checkLamports:setting(env,'FUNDED_OUTFLOW_ALERT_LAMPORTS',SOL),dailyLamports:setting(env,'FUNDED_OUTFLOW_DAILY_ALERT_LAMPORTS',5*SOL),
    intervalSeconds:Math.max(60,setting(env,'FUNDED_OUTFLOW_CHECK_SECONDS',300))};
}

// Wallets named in the treasury inventory plus FUNDED_OUTFLOW_WATCH_ADDRESSES ("Role=address,...").
export function watchedWallets({env=process.env,roles=()=>[]}){
  const rows=new Map();
  const add=(address,role)=>{const value=key(address);if(!value)return;rows.set(value,rows.has(value)?{...rows.get(value),role:rows.get(value).role+' / '+role}:{address:value,role,group:value});};
  try{for(const row of roles())add(row.address,row.role);}catch{}
  for(const part of String(env.FUNDED_OUTFLOW_WATCH_ADDRESSES||'').split(',')){
    const [role,address]=part.includes('=')?part.split('='):['Watched wallet',part];if(address?.trim())add(address.trim(),role.trim()||'Watched wallet');
  }
  return[...rows.values()];
}

// Devnet program vaults: the eight category vaults of each V3 launch (one group
// per mint) and its reward vault.
export function programVaults({programId,authority,mints}){
  const program=key(programId)&&new PublicKey(programId),rows=[];
  if(!program)return rows;
  for(const mint of mints){
    const mintKey=key(mint)&&new PublicKey(mint);if(!mintKey)continue;
    for(let category=0;category<8;category++)rows.push({address:PublicKey.findProgramAddressSync([MINT_VAULT_SEED,mintKey.toBuffer(),Buffer.from([category])],program)[0].toBase58(),
      role:`Mint vaults ${short(mint)}`,group:`vaults:${mint}`});
    if(authority)rows.push({address:PublicKey.findProgramAddressSync([REWARD_VAULT_SEED,new PublicKey(authority).toBuffer(),mintKey.toBuffer()],program)[0].toBase58(),
      role:`Reward vault ${short(mint)}`,group:`reward:${mint}`});
  }
  return rows;
}

export function createOutflowWatcher({store,connection,accounts,programId=null,expectedAuthority=null,sendAlert,env=process.env,now=Date.now,logger=console}){
  async function balances(rows){
    const out=new Map();
    for(let index=0;index<rows.length;index+=100){
      const chunk=rows.slice(index,index+100),infos=await connection().getMultipleAccountsInfo(chunk.map(row=>new PublicKey(row.address)),'finalized');
      chunk.forEach((row,offset)=>out.set(row.address,infos[offset]?.lamports||0));
    }
    return out;
  }
  async function authorities(){
    if(!key(programId))return null;
    const program=new PublicKey(programId),router=PublicKey.findProgramAddressSync([ROUTER_SEED],program)[0];
    const [programInfo,routerInfo]=await connection().getMultipleAccountsInfo([program,router],'finalized');
    const result={router:routerInfo?.data?.length>=73?new PublicKey(routerInfo.data.subarray(41,73)).toBase58():null,upgrade:null};
    if(programInfo?.owner?.equals?.(LOADER)&&programInfo.data?.length>=36){
      const data=(await connection().getAccountInfo(new PublicKey(programInfo.data.subarray(4,36)),{commitment:'finalized',dataSlice:{offset:0,length:45}}))?.data;
      result.upgrade=data?.length>=45?(data[12]===1?new PublicKey(data.subarray(13,45)).toBase58():'immutable'):null;
    }
    return result;
  }

  async function check(){
    const limits=outflowLimits(env),at=now(),rows=await accounts();
    const groups=new Map();
    const current=await balances(rows);
    for(const row of rows){const group=groups.get(row.group)||{role:row.role,addresses:[],lamports:0};
      group.addresses.push(row.address);group.lamports+=current.get(row.address)||0;groups.set(row.group,group);}
    const authority=await authorities().catch(()=>null);
    const alerts=[];let started=false;
    await store.update(state=>{
      const watch=state.outflowWatch||={};
      started=!Object.keys(watch).length;
      for(const [id,group] of groups){
        const prior=watch[id],history=(prior?.history||[]).filter(item=>item.at>at-DAY_MS);
        const out=prior?Math.max(0,prior.lamports-group.lamports):0;
        if(out>0)history.push({at,out});
        const daily=history.reduce((sum,item)=>sum+item.out,0);
        const entry={role:group.role,addresses:group.addresses.slice(0,8),lamports:group.lamports,at,history,dailyAlertAt:prior?.dailyAlertAt||0};
        if(out>limits.checkLamports)alerts.push(`${group.role} (${short(group.addresses[0])}): ${sol(out)} SOL left since the last check; balance now ${sol(group.lamports)} SOL.`);
        if(daily>limits.dailyLamports&&at-entry.dailyAlertAt>DAY_MS){entry.dailyAlertAt=at;
          alerts.push(`${group.role} (${short(group.addresses[0])}): ${sol(daily)} SOL left in the last 24 hours.`);}
        watch[id]=entry;
      }
      if(authority){
        const prior=watch['program-authorities'];
        for(const [name,label] of [['router','Fee router authority'],['upgrade','Program upgrade authority']]){
          if(authority[name]&&prior?.[name]&&prior[name]!==authority[name])alerts.push(`${label} changed from ${prior[name]} to ${authority[name]}.`);
        }
        if(expectedAuthority&&authority.router&&authority.router!==expectedAuthority&&prior?.router===expectedAuthority)
          alerts.push(`Fee router authority is no longer this server's configured authority (${short(expectedAuthority)}).`);
        watch['program-authorities']={router:authority.router||prior?.router||null,upgrade:authority.upgrade||prior?.upgrade||null,at};
      }
      if(alerts.length){state.outflowAlerts||={};state.outflowAlerts[`${at}`]={at:new Date(at).toISOString(),alerts};
        for(const id of Object.keys(state.outflowAlerts))if(Number(id)<at-30*DAY_MS)delete state.outflowAlerts[id];}
    });
    if(alerts.length){
      logger.warn?.(JSON.stringify({event:'outflow_alert',count:alerts.length}));
      try{await sendAlert({subject:`Outflow alert: ${alerts.length} item${alerts.length===1?'':'s'}`,lines:alerts});}
      catch{logger.error?.(JSON.stringify({event:'outflow_alert_email_failed'}));}
    }else if(started){
      // One notice when monitoring first starts, so email delivery is proven.
      try{await sendAlert({subject:'Outflow monitoring started',lines:[`Watching ${groups.size} wallet and vault groups every ${limits.intervalSeconds/60} minutes.`,
        `Alerts: more than ${sol(limits.checkLamports)} SOL out in one check, more than ${sol(limits.dailyLamports)} SOL out in 24 hours, or any change of program authority.`]});}
      catch{logger.error?.(JSON.stringify({event:'outflow_alert_email_failed'}));}
    }
    return{alerts,watched:groups.size};
  }
  return{check};
}

export function startOutflowAlerts({watcher,env=process.env,scheduleTimeout=setTimeout,scheduleInterval=setInterval,logger=console}){
  if(String(env.FUNDED_OUTFLOW_ALERTS_ENABLED||'true')==='false')return false;
  let running=false;
  const tick=async()=>{if(running)return;running=true;
    try{await watcher.check();}catch{logger.error?.(JSON.stringify({event:'outflow_check_failed'}));}finally{running=false;}};
  scheduleTimeout(()=>{void tick();},30_000).unref?.();
  scheduleInterval(()=>{void tick();},outflowLimits(env).intervalSeconds*1000).unref?.();
  return true;
}
