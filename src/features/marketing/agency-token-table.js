import {agencyTokenLink} from './agency-token-link.js';
import {escapeHtml as esc} from '../shared/display.js';
import {formatTokenBaseUnits} from '../../../funded-burn.js';

const amount=value=>/^(0|[1-9]\d{0,19})$/.test(String(value))?formatTokenBaseUnits(value,9,9):'—';
const marketFor=(data,row)=>data.progress?.find(item=>item.mint===row.mint);
const capFor=market=>market&&Number.isFinite(market.marketCapUsd)&&market.marketCapUsd>0&&Date.now()-Date.parse(market.checkedAt)>=0&&Date.now()-Date.parse(market.checkedAt)<120000?market.marketCapUsd:null;
export function agencyMilestoneProgress(market,index){
  const target=market?.targets?.[index],cap=capFor(market);
  if(!Number.isFinite(target)||target<=0)return 'Saved target unavailable';
  if(market.completedMask&(1<<(index+1)))return 'Completed';
  const label='$'+target.toLocaleString('en-US');
  if(cap===null)return label+' · market cap unavailable';
  const percent=cap/target*100;
  return `${label} · ≈${percent.toFixed(2)}%${percent>=100?' · market-cap target reached':percent>=80?' · near milestone':''}`;
}
export function agencyTokenTable(data) {
  const rows=Array.isArray(data?.launches)?data.launches.filter(row=>/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(row.mint)):[];
  if(!rows.length)return '<p class="reward-empty">No agency token records are available for the current deployment.</p>';
  const proximity=row=>{const market=marketFor(data,row),cap=capFor(market);return cap===null?-1:Math.max(-1,...(market.targets||[]).map((target,index)=>market.completedMask&(1<<(index+1))?-1:cap/target));};
  rows.sort((a,b)=>proximity(b)-proximity(a));
  const names={'x-promotion':'X promotion','buyback-100k':'Buyback 1','buyback-300k':'Buyback 2'};
  return `<p class="reward-source-note">${rows.length} registered tokens · amounts require a fresh verified snapshot. X promotion ${data.agents?.some(agent=>agent.deliveryMode==='admin-email'&&agent.enabled)?'uses admin email drafts':data.publishingPaused?'is paused':'requires verified delivery'}.</p><div class="data-table-scroll" role="region" aria-label="Agency tokens, scroll horizontally for all columns" tabindex="0"><table class="record-table agency-token-table"><caption>Token budgets and execution status</caption><thead><tr>${['Token','Selected agents','Funded (SOL)','Spent (SOL)','Remaining (SOL)','Est. market cap','Buyback 1 milestone','Buyback 2 milestone','Status','Checked (UTC)'].map((label,index)=>`<th scope="col"${index>=2&&index<=4?' class="numeric"':''}>${label}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>{
    const ready=row.status==='worker-verified-snapshot';
    const exact=ready&&/^(0|[1-9]\d{0,19})$/.test(row.paidLamports)&&/^(0|[1-9]\d{0,19})$/.test(row.spentLamports)&&BigInt(row.paidLamports)>=BigInt(row.spentLamports);
    const selected=Array.isArray(row.selectedAgents)&&row.selectedAgents.length?row.selectedAgents.map(id=>names[id]||id).join(', '):Number.isInteger(row.selectedMask)?[row.selectedMask&1?'X promotion':'',row.selectedMask&2?'Buyback 1':'',row.selectedMask&4?'Buyback 2':''].filter(Boolean).join(', '):'Not recorded';
    const time=Date.parse(row.checkedAt),market=marketFor(data,row);
    const status=!ready?'Awaiting fresh snapshot':row.completedMask===row.selectedMask?'Actions completed':exact&&BigInt(row.paidLamports)===0n?'Awaiting funding':'Waiting for execution checks';
    return `<tr><td>${agencyTokenLink(row)}</td><td>${esc(selected)}</td><td class="numeric">${exact?amount(row.paidLamports):'—'}</td><td class="numeric">${exact?amount(row.spentLamports):'—'}</td><td class="numeric">${exact?amount(String(BigInt(row.paidLamports)-BigInt(row.spentLamports))):'—'}</td><td>${capFor(market)===null?'—':'≈$'+capFor(market).toLocaleString('en-US',{maximumFractionDigits:2})}</td>${[0,1].map(index=>`<td>${esc(agencyMilestoneProgress(market||{targets:ready?row.rules?.marketCapUsd:null},index))}</td>`).join('')}<td>${esc(status)}</td><td>${ready&&Number.isFinite(time)?`<time datetime="${new Date(time).toISOString()}">${new Date(time).toISOString().slice(0,16).replace('T',' ')}</time>`:'—'}</td></tr>`;
  }).join('')}</tbody></table></div>`;
}
