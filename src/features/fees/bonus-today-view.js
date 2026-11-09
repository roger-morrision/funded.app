import {bonusCountdown,nextUtcCutoff,bonusSol} from './bonus-dashboard-view.js';
const groups={creators:'Creators',referrals:'Referrers',traders:'Traders'};
export const BONUS_TODAY_MARKUP='<section class="bonus-today" aria-labelledby="bonus-today-title"><h2 id="bonus-today-title">Today’s top 5</h2><div class="bonus-clock"><span data-today-cutoff>Snapshot · 00:00 UTC</span><strong data-today-countdown aria-label="Time until daily bonus snapshot">—:—:—</strong></div><ul class="guidance-outline"><li>Top 3 in each category win.</li><li>Rankings can change until the cutoff.</li><li>Winners are paid automatically after checks.</li></ul><div class="bonus-leaders-grid" data-bonus-today></div><p class="field-help" data-bonus-today-status>Checking today’s rankings…</p></section>';
export function renderTodayBonuses(page,data,document=globalThis.document){
  const root=page.querySelector('[data-bonus-today]');if(!root)return;
  root.replaceChildren();
  const make=(tag,text)=>{const n=document.createElement(tag);n.textContent=text;return n;};
  for(const[key,title]of Object.entries(groups)){
    const section=make('section','');section.append(make('h3',title));const list=make('ol','');list.className='bonus-wallet-list';
    const rows=data?.today?.[key];
    if(!Array.isArray(rows))section.append(make('p','Rankings unavailable'));
    else if(!rows.length)section.append(make('p','No eligible activity yet'));
    else for(const row of rows.slice(0,5)){
      const li=make('li',''),identity=make('div',`${row.rank}. `),link=make('a',`${row.wallet.slice(0,5)}…${row.wallet.slice(-5)}`);
      link.href=`/wallet/${encodeURIComponent(row.wallet)}`;link.title=row.wallet;identity.append(link);
      identity.append(make('small',row.rank<=3?'Provisional bonus place':'Outside top 3'));
      li.dataset.bonusPlace=row.rank<=3?'winner':'outside';li.append(identity,make('span',bonusSol(row.scoreLamports)));list.append(li);
    }
    section.append(list);root.append(section);
  }
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
