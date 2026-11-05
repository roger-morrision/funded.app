const KEY='funded.community-pilot.v1';
const mintPattern=/^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
export function pilotSchedule({mint,start},origin) {
  if(!mintPattern.test(mint||'') || !Number.isFinite(Date.parse(start)))return null;
  const at=Date.parse(start), url=new URL(`/token/${mint}`,origin).href;
  return {mint,url,events:[
    {at:new Date(at).toISOString(),title:'Launch discussion',task:'Share the coin page and fee policy. Invite questions in its Chat tab.'},
    {at:new Date(at+86400000).toISOString(),title:'Day 1 creator update',task:'Publish what changed, answer questions, and link only confirmed receipts.'},
    {at:new Date(at+7*86400000).toISOString(),title:'Day 7 community recap',task:'Check returning participants, confirmed activity, and feedback. Separate test trades from organic activity.'},
  ]};
}
export function mountCommunityPilot(page,{cluster='devnet',readOnly=false}={}) {
  if(!page || page.querySelector('#community-pilot-plan'))return;
  const root=document.createElement('section');root.id='community-pilot-plan';root.className='flow-panel';
  root.innerHTML='<h2>Plan one community pilot</h2><p>Choose one coin and a discussion time. This local plan does not schedule posts, send invitations, verify a coin, or promise trading activity.</p><form><label>Coin mint<input name="mint" required pattern="[1-9A-HJ-NP-Za-km-z]{32,44}" autocomplete="off"></label><label>Discussion time · your local time<input name="start" type="datetime-local" required></label><button type="submit">Save local plan</button></form><p role="status" data-plan-status></p><ol data-plan-events></ol><nav data-plan-links hidden><a data-plan-token>Open coin &amp; chat</a><a href="#my-launches">Write a creator update</a><a href="#payments/history">Review payment receipts</a><button type="button" data-plan-copy>Copy invitation</button></nav><p class="discovery-note">Pilot scorecard: invited visitors → token visits → usable quotes → confirmed trades → returning participants after 7 days. Use consented analytics; this plan does not collect these counts. Never count Devnet test SOL as real revenue.</p>';
  const anchor=page.querySelector('.creator-pilot-path');if(anchor)anchor.before(root);else page.append(root);
  const form=root.querySelector('form'),status=root.querySelector('[data-plan-status]');let plan=null;
  const render=()=>{
    const list=root.querySelector('[data-plan-events]');list.replaceChildren();
    root.querySelector('[data-plan-links]').hidden=!plan;
    if(!plan)return;
    for(const event of plan.events){const li=document.createElement('li'),title=document.createElement('strong'),p=document.createElement('p');title.textContent=`${new Date(event.at).toLocaleString()} · ${event.title}`;p.textContent=event.task;li.append(title,p);list.append(li);}
    root.querySelector('[data-plan-token]').href=plan.url;
  };
  const enabled=cluster==='devnet'&&!readOnly;
  if(!enabled){form.hidden=true;status.textContent='The creator pilot is available in writable Devnet only.';return;}
  try {const saved=JSON.parse(localStorage.getItem(KEY)||'null');plan=pilotSchedule(saved||{},location.origin);if(plan){form.elements.mint.value=plan.mint;const d=new Date(plan.events[0].at);form.elements.start.value=new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16);status.textContent='Local plan restored. Times are targets, not scheduled actions.';}}catch{status.textContent='Local storage unavailable. You can prepare a plan for this session.';}
  const linked=new URL(location.href).searchParams.get('pilotMint');if(mintPattern.test(linked||'')){form.elements.mint.value=linked;if(plan?.mint!==linked)plan=null;}
  render();
  form.addEventListener('submit',event=>{event.preventDefault();if(!form.reportValidity())return;
    plan=pilotSchedule({mint:form.elements.mint.value.trim(),start:form.elements.start.value},location.origin);if(!plan){status.textContent='Enter a valid mint and discussion time.';return;}
    try{localStorage.setItem(KEY,JSON.stringify({mint:plan.mint,start:plan.events[0].at}));status.textContent='Plan saved on this device. Nothing has been published or scheduled.';}catch{status.textContent='Plan prepared for this session; local storage could not save it.';}render();
  });
  root.querySelector('[data-plan-copy]').addEventListener('click',async()=>{if(!plan)return;
    const text=`Join our Solana Devnet community test on ${new Date(plan.events[0].at).toLocaleString()}. Explore the coin and its fee policy, then join its Chat tab. Test funds have no monetary value. ${plan.url}`;
    try{await navigator.clipboard.writeText(text);status.textContent='Invitation copied. Review it before sharing.';}catch{status.textContent=text;}
  });
}

export function mountCommunityPilotPage(options) {
  const main=document.querySelector('#main-content');if(!main||document.querySelector('#community-pilot-page'))return;
  const page=document.createElement('section');page.id='community-pilot-page';page.dataset.workspaceRoute='community-pilot';page.hidden=true;
  page.innerHTML='<header><p class="eyebrow">Devnet community experiment</p><h1>Plan your community pilot</h1><p>Prepare a discussion, a creator update, and a recap around one coin.</p></header>';
  main.append(page);mountCommunityPilot(page,options);
}
