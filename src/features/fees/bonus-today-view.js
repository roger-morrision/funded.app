import {bonusCountdown,nextUtcCutoff,bonusSol} from './bonus-dashboard-view.js';
import {renderBonusPodium,settlePodiumGrid} from './bonus-podium.js';
const groups={creators:['Creators','Ranked by settled creator fees'],referrals:['Referrers','Ranked by referred settled fees'],traders:['Traders','Ranked by verified SOL volume']};
export const BONUS_TODAY_MARKUP='<section class="bonus-today" aria-labelledby="bonus-today-title"><div class="bonus-stage-head"><div><p class="eyebrow">Live standings</p><h2 id="bonus-today-title">Today’s top 5</h2><p class="field-help">Provisional standings. Top 3 in each category win. Rankings can change until the cutoff. Winners are paid automatically after checks.</p></div><div class="bonus-clock"><span data-today-cutoff>Snapshot · 00:00 UTC</span><strong data-today-countdown aria-label="Time until daily bonus snapshot">—:—:—</strong></div></div><div class="bonus-leaders-grid bonus-honor-grid" data-bonus-today></div><p class="field-help" data-bonus-today-status>Checking today’s rankings…</p></section>';
export function renderTodayBonuses(page,data,document=globalThis.document){
  const root=page.querySelector('[data-bonus-today]');if(!root)return;
  root.replaceChildren();
  // With no rankings at all, one message replaces three identical "unavailable" cards.
  if(!Object.keys(groups).some(key=>Array.isArray(data?.today?.[key]))){
    const empty=document.createElement('p');empty.className='bonus-honor-empty bonus-honor-empty-all';
    empty.textContent=data?'Today’s rankings are not available yet.':'Rankings are unavailable right now. They appear here once today’s activity is indexed.';
    root.append(empty);
  }
  else for(const[key,[title,metric]]of Object.entries(groups)){
    const rows=data?.today?.[key];
    root.append(renderBonusPodium(document,{key,title,metric,emptyText:'No eligible activity yet',
      rows:Array.isArray(rows)?rows.slice(0,5).map(row=>({rank:row.rank,wallet:row.wallet,amount:bonusSol(row.scoreLamports),note:row.rank>3?'Outside bonus places':undefined})):null}));
  }
  if(data)settlePodiumGrid(root,document.defaultView??globalThis);
  const today=data?.today;
  page.querySelector('[data-bonus-today-status]').textContent=today?.checkedAt?`Updated ${new Date(today.checkedAt).toLocaleTimeString()}`:'';
  page.querySelector('[data-today-cutoff]').textContent=data?.schedule?.mode==='devnet-qa-5m'?'Devnet QA snapshot · every 5 minutes':'Snapshot · 00:00 UTC';
}
export function tickTodayBonus(page,data,clockBase,performanceNow){
  const node=page.querySelector('[data-today-countdown]');if(!node)return;
  const now=Date.now();
  node.textContent=clockBase&&performanceNow-clockBase.started>120_000?'-':clockBase?bonusCountdown(clockBase.cutoff,clockBase.at,performanceNow-clockBase.started)
    :!data || data?.schedule?.mode==='devnet-qa-5m'?'—:—:—':bonusCountdown(nextUtcCutoff(now),now,0);
}
