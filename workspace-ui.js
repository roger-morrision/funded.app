import { $, $$, disclose } from './src/features/workspace/dom.js';
import { navigation } from './src/features/workspace/navigation.js';
import { explore } from './src/features/workspace/explore.js';
import { launch } from './src/features/workspace/launch.js';
import { rewards } from './src/features/workspace/rewards.js';
import { secondaryPages, protocolPage, mergePurposePages } from './src/features/workspace/secondary-pages.js';
import { tokenPage } from './src/features/workspace/token-page.js';

// Workspace composition owns layout and navigation. Financial state remains in its source modules.

import './workspace-ui.css';
import './home-reference.css';
import './ansem-pages.css';
import './payments-redesign.css';

function home() {
  const hero = $('.hero-section');
  const board = $('.home-launch-board');
  if (hero && board) hero.after(board);
  disclose($('.hero-stakeholders'), 'How participants benefit');
  disclose($('.home-referral-guide'), 'How referral rewards work');
}

let lastSyncedRoute = null;
function syncRoute() {
  const route=location.hash.slice(1)||(/^\/funded\/?$/.test(location.pathname)?'paid':/^\/list\/?$/.test(location.pathname)?'list':/^\/pilot\/?$/.test(location.pathname)?'launch':/^\/explore\/?$/.test(location.pathname)?'explore':'overview');
  const mergedRoutes={pilot:'launch',community:'my-launches','capital-flow':'analytics-detail',buybacks:'paid'};
  const pageRoute=mergedRoutes[route]|| (route==='funded-holder-token-rewards'?'payments':route.startsWith('docs/')?'docs':route);
  const tokenOrWallet = /^\/(token|wallet|launch\/coin)\//.test(location.pathname) && !location.hash || route.startsWith('coin/');
  $$('[data-workspace-route]').forEach(element => { element.hidden = tokenOrWallet || element.dataset.workspaceRoute !== pageRoute; });
  const mobileRoute = tokenOrWallet
    ? (/^\/wallet\//.test(location.pathname) ? 'my-launches' : /^\/launch\/coin\//.test(location.pathname) ? 'launch' : 'explore')
    : ({ community: 'my-launches', leaderboard: 'explore', airdrops: 'payments', referrals: 'payments', profile: 'my-launches', list: 'launch', paid: 'payments' }[pageRoute] || pageRoute);
  $$('.mobile-workspace-nav a').forEach(link=>{if(link.hash===`#${mobileRoute}`)link.setAttribute('aria-current','page');else link.removeAttribute('aria-current');});
  $$('[data-purpose-route]').forEach(link=>{const active=link.dataset.purposeRoute===route||(!location.hash&&link.dataset.purposeRoute===pageRoute);if(active)link.setAttribute('aria-current','location');else link.removeAttribute('aria-current');});
  const more=$('.nav-more');if(more)more.open=!matchMedia('(min-width:1180px)').matches && Boolean($('a[aria-current="page"]',more));
  const target=$('#route-guide');if(target&&['payments','my-launches','community','profile'].includes(route))target.hidden=true;
  if(route==='funded-holder-token-rewards'){
    $('#rewards-funded-tab')?.click();
    requestAnimationFrame(()=>{
      const target=$('#funded-holder-token-rewards');
      if(!target?.getClientRects().length)return;
      target.tabIndex=-1;
      target.scrollIntoView({block:'start',behavior:'auto'});
      target.focus({preventScroll:true});
    });
  }
  if(pageRoute==='payments')document.title='Rewards · funded.vip';
  else if(route==='launch')document.title='Create a coin · funded.vip';
  else document.title=`${$('[data-route-label]')?.textContent||'funded.vip'} · funded.vip`;
  if(route!==lastSyncedRoute && !route.includes('/') && route!=='funded-holder-token-rewards') {
    // Each workspace route begins with its own header. Native fragment scrolling
    // can otherwise leave the shared header partly offscreen after layout changes.
    requestAnimationFrame(()=>requestAnimationFrame(()=>window.scrollTo({top:0,behavior:'instant'})));
  }
  lastSyncedRoute=route;
}

navigation(); home(); explore(); launch(); rewards(); secondaryPages(); protocolPage(); mergePurposePages(); tokenPage();
document.body.classList.add('workspace-ready');
window.addEventListener('funded:route-change',syncRoute);
window.addEventListener('funded:layout-change',syncRoute);
window.addEventListener('hashchange',syncRoute);
matchMedia('(min-width:1180px)').addEventListener('change',syncRoute);
syncRoute();
