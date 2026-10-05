import { APP_CLUSTER, APP_MAINNET_READ_ONLY } from './app-config.js';
import { readLaunchJournal } from './launch-journal.js';
import { creatorPilotProgress } from './creator-pilot-model.js';
import './creator-pilot.css';

const main=document.querySelector('#main-content');
if(main && !document.querySelector('#creator-pilot')) {
  const page=document.createElement('section');
  page.id='creator-pilot';page.dataset.workspaceRoute='pilot';page.hidden=true;
  page.setAttribute('aria-labelledby','creator-pilot-title');
  page.innerHTML=`<header class="creator-pilot-header"><p class="eyebrow">Creator communities · Solana Devnet pilot</p><h1 id="creator-pilot-title" tabindex="-1">Inspect collected fees and receipts</h1><p>Test a token launch, review how collected creator fees are allocated, and bring the receipts back to your community.</p><p class="creator-pilot-disclosure">Devnet uses test funds with no monetary value. This is a product test, not an investment or a promise of earnings. You can explore the launch form and optionally set up local pilot recording without connecting a wallet.</p><div class="creator-pilot-actions"><a href="#launch" class="primary-button" data-pilot-primary>Prepare your token</a><a href="#explore" class="secondary-button">Explore verified launches</a><button type="button" class="text-button" data-pilot-enroll>Optional local pilot setup</button></div></header>
    <aside class="creator-pilot-recovery" role="status" hidden>There is an unfinished launch on this device. Check its recorded signature in <a href="#my-launches">Portfolio</a> before starting another transaction.</aside>
    <section class="creator-pilot-path" aria-labelledby="creator-pilot-path-title"><h2 id="creator-pilot-path-title">Your test, from launch to community update</h2><p>These steps describe the work. Local notes below do not prove a launch or payment succeeded.</p><ol>
      <li><div><h3>Prepare</h3><p>Name your token and describe its purpose. Keep the first experiment small.</p><small data-pilot-step="0"></small></div><a href="#launch" data-pilot-prepare>Open launch form</a></li>
      <li><div><h3>Review costs and allocation</h3><p>Review the network fee, optional developer buy, any launch-tier burn, and who receives each share of collected creator fees.</p><small data-pilot-step="1"></small></div><a href="#launch">Review launch setup</a></li>
      <li><div><h3>Test the launch</h3><p>Use a Devnet wallet, inspect the signing request, and wait for verification. A timeout is not proof that a transaction failed.</p><small data-pilot-step="2"></small></div><a href="#my-launches">Open Portfolio</a></li>
      <li><div><h3>Verify the receipts</h3><p>Inspect the token policy and available collection or payment receipts. An allocation is a rule, not money already paid.</p><small data-pilot-step="3"></small></div><a href="#payments">Review receipts</a></li>
      <li><div><h3>Share with your community</h3><p>Share the token page and verified receipts from Portfolio. Explain what was tested, what is still unverified, and what you will try next.</p><small data-pilot-step="4"></small></div><a href="#my-launches">Find your token</a></li>
    </ol></section>
    <section class="creator-pilot-fees" aria-labelledby="creator-pilot-fees-title"><h2 id="creator-pilot-fees-title">Follow collected fees, not promised returns</h2><p>The token policy identifies fee destinations. Collection and payment receipts show what actually happened. No trading activity means no trading fees to allocate; payout availability also depends on verified funding and operating distribution services.</p><a href="#capital-flow">Review fee activity</a><a href="#docs">Read the Devnet guide</a></section>
    <div id="creator-pilot-metrics" aria-label="Optional local pilot recording"></div>
    <footer class="creator-pilot-footer"><p>Invite someone to review the same test path. This copies a link; it does not publish a post or record participation.</p><button type="button" class="secondary-button" data-pilot-copy>Copy pilot invitation</button><p role="status" data-pilot-copy-status></p><a href="#overview">Back to Home</a></footer>`;
  main.append(page);
  let reviewOpened=false;
  const refresh=()=>{
    const state=creatorPilotProgress({journal:readLaunchJournal(),reviewOpened,cluster:APP_CLUSTER});
    state.statuses.forEach((text,index)=>{page.querySelector(`[data-pilot-step="${index}"]`).textContent=text;});
    page.querySelector('.creator-pilot-recovery').hidden=!state.pending;
    const primary=page.querySelector('[data-pilot-primary]');primary.href=state.primary.href;primary.textContent=state.primary.label;
    if(APP_CLUSTER!=='devnet' || APP_MAINNET_READ_ONLY){
      page.querySelector('.creator-pilot-disclosure').textContent='This pilot is designed for Devnet test funds. The current build is not a writable Devnet environment. Explore available records; do not send mainnet funds for this pilot.';
      for(const link of page.querySelectorAll('a[href="#launch"]')){link.href='#docs';link.textContent='Check network availability';}
    }
  };
  const sync=()=>{
    const active=location.hash==='#pilot' || (!location.hash && /^\/pilot\/?$/.test(location.pathname));page.hidden=!active;
    if(!active)return;
    refresh();document.title='Creator community pilot · funded.vip';
    const label=document.querySelector('[data-route-label]');if(label)label.textContent='Creator pilot';
    requestAnimationFrame(()=>{if(!page.hidden)page.querySelector('h1').focus({preventScroll:true});});
  };
  page.querySelector('[data-pilot-enroll]').addEventListener('click',()=>{
    const target=page.querySelector('#creator-pilot-metrics');
    const control=[...target.querySelectorAll('input, select, button')].find(element=>!element.disabled && element.getClientRects().length);
    if(control){control.focus({preventScroll:true});target.scrollIntoView({block:'start',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});}
    else{const status=page.querySelector('[data-pilot-copy-status]');status.textContent='Optional recording is unavailable. You can still follow every test step.';status.tabIndex=-1;status.focus();}
  });
  page.querySelector('[data-pilot-copy]').addEventListener('click',async()=>{
    const url=new URL('/#pilot',location.origin).href;const status=page.querySelector('[data-pilot-copy-status]');
    try{await navigator.clipboard.writeText(`Test a transparent creator-fee allocation with your community on Solana Devnet (test funds). ${url}`);status.textContent='Pilot invitation copied. Review it before sharing with your community.';}
    catch{status.textContent=`Copy is unavailable. Your pilot link: ${url}`;}
  });
  window.addEventListener('funded:journal',refresh);
  window.addEventListener('funded:pilot-event',event=>{if(event.detail?.name==='launch-review-opened'){reviewOpened=true;refresh();}});
  window.addEventListener('storage',event=>{if(!event.key || event.key==='funded.launch.journal.v1')refresh();});
  window.addEventListener('hashchange',sync);window.addEventListener('popstate',sync);
  sync();
}
