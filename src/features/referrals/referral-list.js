import {tabs} from '../workspace/dom.js';
import {paginateHistory} from '../../../history-pagination.js';
import {apiRequest} from '../../../client.js';

// "My referral list": one row per wallet in the three-level network with when it
// joined, coins it created, its 24h trade volume, the creator fees its coins
// collected, and the referral bonus this wallet was paid or can still claim.
let latest=null,emptyState='signed-out';
const volumes=new Map();
const MINT=/^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const EMPTY={'signed-out':'Sign in with your wallet to see your referral list. Connecting shows your address; signing proves the wallet is yours.',
  unavailable:'Your referral list could not load right now. Try again shortly.'};

export function updateReferralList(data,state='signed-out'){latest=data;emptyState=state;render();}

const lamports=value=>{try{return BigInt(String(value??'0'));}catch{return 0n;}};
const sol=value=>{const n=Number(lamports(value))/1e9;return n?`${n<0.0001?n.toExponential(1):n.toLocaleString('en-US',{maximumFractionDigits:4})} SOL`:'0 SOL';};
const sourceLabel=value=>{const text=String(value||'').trim();if(!text)return 'Direct link';return text.toLowerCase()==='x'?'X':text.charAt(0).toUpperCase()+text.slice(1);};
const short=wallet=>`${wallet.slice(0,4)}…${wallet.slice(-4)}`;
function joined(iso){
  const at=Date.parse(iso||'');if(!Number.isFinite(at))return {text:'—',title:''};
  const days=Math.floor((Date.now()-at)/86_400_000);
  const ago=days<1?'today':days===1?'1 day ago':days<30?`${days} days ago`:new Date(at).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});
  return {text:ago,title:new Date(at).toLocaleString()};
}
const cell=(tag,className,text,title)=>{const node=document.createElement(tag);if(className)node.className=className;node.textContent=text;if(title)node.title=title;return node;};

function summary(rows){
  const sum=key=>rows.reduce((total,row)=>total+lamports(row[key]),0n);
  const box=document.createElement('div');box.className='referral-list-summary';
  for(const [label,value,role] of [['Referrals',String(rows.length),'holders'],['Coins created',String(rows.reduce((n,row)=>n+(row.coinsCreated||0),0)),'trades'],
    ['Fees collected',sol(sum('feesCollectedLamports')),'cap'],['Bonus earned',sol(sum('bonusPaidLamports')),'success'],['To claim',sol(sum('bonusClaimableLamports')),'volume']]){
    const item=document.createElement('div');item.dataset.role=role;
    item.append(cell('span','',label),cell('strong','',value));box.append(item);
  }
  return box;
}

function claimState(row){
  const claimable=lamports(row.bonusClaimableLamports),paid=lamports(row.bonusPaidLamports);
  if(claimable>0n)return ['Unclaimed','is-unclaimed'];
  if(paid>0n)return ['Claimed','is-claimed'];
  return ['Nothing yet','is-none'];
}

function render(){
  const root=document.querySelector('#my-referral-list');if(!root)return;
  root.replaceChildren();
  if(!latest){root.textContent=EMPTY[emptyState]||EMPTY['signed-out'];return;}
  const rows=Array.isArray(latest.referrals)?latest.referrals.filter(row=>MINT.test(row.wallet)&&[1,2,3].includes(row.level)):null;
  if(!rows){root.textContent=EMPTY.unavailable;return;}
  if(!rows.length){root.textContent='No referrals yet. Share your invite link to get started.';return;}
  root.append(summary(rows));
  const wrap=document.createElement('div');wrap.className='referral-list-scroll';
  const table=document.createElement('table');table.className='referral-list-table';
  table.innerHTML='<thead><tr><th scope="col">Wallet</th><th scope="col">Joined</th><th scope="col">Source</th><th scope="col" class="numeric">Coins created</th><th scope="col" class="numeric">24h volume</th><th scope="col" class="numeric">Fees collected</th><th scope="col" class="numeric">Bonus earned</th><th scope="col" class="numeric">To claim</th><th scope="col">Status</th></tr></thead>';
  const body=document.createElement('tbody');
  for(const row of rows){
    const tr=document.createElement('tr');tr.className='referral-list-row';
    const who=document.createElement('td'),link=document.createElement('a');
    link.href=`/wallet/${encodeURIComponent(row.wallet)}`;link.textContent=short(row.wallet);link.title=row.wallet;
    who.append(link,cell('small','referral-level',row.level===1?'Level 1 · Direct':`Level ${row.level}`));
    const date=joined(row.joinedAt);
    const volume=volumes.get(row.wallet);
    const [status,statusClass]=claimState(row);
    const statusCell=document.createElement('td');statusCell.append(cell('span',`referral-claim-chip ${statusClass}`,status));
    tr.append(who,cell('td','',date.text,date.title),cell('td','',sourceLabel(row.source)),
      cell('td','numeric is-trades',String(row.coinsCreated||0)),
      cell('td','numeric is-volume',volume==null?'…':volume==='unavailable'?'—':sol(volume),volume==='unavailable'?'24h trades could not be read':'Last 24 hours, finalized Pump and PumpSwap trades'),
      cell('td','numeric is-cap',sol(row.feesCollectedLamports)),cell('td','numeric is-earned',sol(row.bonusPaidLamports)),
      cell('td','numeric is-claimable',sol(row.bonusClaimableLamports)),statusCell);
    body.append(tr);
  }
  table.append(body);wrap.append(table);root.append(wrap);
  if(rows.some(row=>lamports(row.bonusClaimableLamports)>0n)){
    const note=document.createElement('p');note.className='referral-claim-note';
    note.append('Unclaimed bonuses are claimed on ');
    const open=cell('button','text-button','Rewards & payouts');open.type='button';
    open.addEventListener('click',()=>document.querySelector('#referral-views [role="tab"]')?.click());
    note.append(open,'.');root.append(note);
  }
  paginateHistory(body,{label:'My referral list',selector:'.referral-list-row',key:latest.wallet,anchor:wrap});
  void loadVolumes(rows.slice(0,20));
}

// 24h volume per wallet from the same finalized trade scan as Portfolio; two at a time.
let loading=false;
async function loadVolumes(rows){
  const queue=rows.filter(row=>!volumes.has(row.wallet));
  if(loading||!queue.length)return;
  loading=true;
  try{
    const worker=async()=>{
      for(let row=queue.shift();row;row=queue.shift()){
        try{
          const result=await apiRequest(`/api/wallets/${encodeURIComponent(row.wallet)}/trades`,{signal:AbortSignal.timeout(25_000)});
          const trades=result.available&&result.data?.wallet===row.wallet&&Array.isArray(result.data.trades)?result.data.trades:null;
          volumes.set(row.wallet,trades?String(trades.reduce((sum,trade)=>sum+lamports(trade.solLamports),0n)):'unavailable');
        }catch{volumes.set(row.wallet,'unavailable');}
      }
    };
    await Promise.all([worker(),worker()]);
  }finally{loading=false;}
  render();
}

export function mountReferralList(){
  const root=document.querySelector('#referral-command-center');if(!root||document.querySelector('#my-referral-list'))return;
  const history=root.querySelector('.referral-ledger-panel');if(!history)return;
  const panels=document.createElement('section');panels.id='referral-views';history.before(panels);
  const list=document.createElement('article');list.className='panel';list.id='referral-network-panel';
  list.innerHTML='<h3>My referral list</h3><p>Your direct referrals and two further levels: when they joined, what they created and traded, and the bonus you earned from them.</p><div id="my-referral-list" aria-live="polite"></div>';
  panels.append(history,list);
  tabs(panels,[{key:'payouts',label:'Rewards & payouts',panel:history},{key:'referrals',label:'My referral list',panel:list}],'Referral dashboard');
  window.addEventListener('funded:reward-identity-change',()=>{volumes.clear();updateReferralList(null);});
  render();
}
