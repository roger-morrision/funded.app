import { $, $$, disclose } from './src/features/workspace/dom.js';
import { navigation } from './src/features/workspace/navigation.js';
import { explore } from './src/features/workspace/explore.js';
import { launch } from './src/features/workspace/launch.js';
import { rewards } from './src/features/workspace/rewards.js';
import { secondaryPages, protocolPage, mergePurposePages } from './src/features/workspace/secondary-pages.js';
import { tokenPage } from './src/features/workspace/token-page.js';

// Workspace composition owns layout and navigation. Financial state remains in its source modules.

function home() {
  disclose($('.hero-stakeholders'), 'How participants benefit');
  disclose($('.home-referral-guide'), 'How referral rewards work');
}

let lastSyncedRoute = null;
let scrollRequest = 0;
// Coin tabs and bookmarks keep the coin name instead of a generic "Token" title.
const coinRoute=()=>/^\/(token|launch\/coin)\//.test(location.pathname)&&!location.hash||location.hash.startsWith('#coin/');
// The server already names verified coins in <title>; keep it while the page loads.
const serverCoinTitle=coinRoute()&&!location.hash&&/ \| (?:richpad\.fun|funded\.vip)$/.test(document.title)&&!document.title.startsWith('Token verification unavailable')
  ?{path:location.pathname,title:document.title}:null;
function coinTitle() {
  const name=coinRoute()?$('#coin-page-title')?.textContent?.trim():'';
  if(name&&!/^(Loading token|Token data unavailable)/.test(name))return `${name} · richpad.fun`;
  return coinRoute()&&!location.hash&&location.pathname===serverCoinTitle?.path?serverCoinTitle.title:'';
}
const routeTitle=()=>coinTitle()||`${$('[data-route-label]')?.textContent||'richpad.fun'} · richpad.fun`;
function syncRoute() {
  const route=location.hash.slice(1)||(/^\/(?:rich|funded)\/?$/.test(location.pathname)?'paid':/^\/list\/?$/.test(location.pathname)?'list':/^\/pilot\/?$/.test(location.pathname)?'launch':/^\/explore\/?$/.test(location.pathname)?'explore':'overview');
  const mergedRoutes={top300:'top100',pilot:'launch',community:'my-launches',buybacks:'paid','referral-faq':'referrals','payments/history':'payments','payments/holders':'payments','payments/activity':'payments','payments/creator':'payments','payments/x':'payments'};
  const pageRoute=mergedRoutes[route]|| (route==='funded-holder-token-rewards'?'payments':route.startsWith('docs/')?'docs':route);
  const tokenOrWallet = /^\/(token|wallet|launch\/coin)\//.test(location.pathname) && !location.hash || route.startsWith('coin/');
  const creatorSupportRoute = route==='creators'||/^creator\/\d{1,24}$/.test(route)
    || (!location.hash&&/^\/creator\/x\/\d{1,24}\/?$/.test(location.pathname));
  $$('[data-workspace-route]').forEach(element => { element.hidden = tokenOrWallet || element.dataset.workspaceRoute !== pageRoute; });
  const mobileRoute = tokenOrWallet
    ? (/^\/wallet\//.test(location.pathname) ? 'my-launches' : /^\/launch\/coin\//.test(location.pathname) ? 'launch' : 'explore')
    : creatorSupportRoute ? 'explore'
    : route==='creator-settings' ? 'my-launches'
    : ({ top100: 'explore', community: 'my-launches', leaderboard: 'explore', 'analytics-detail': 'explore', airdrops: 'payments', referrals: 'payments', bonuses: 'payments', 'capital-flow': 'payments', 'marketing-agency': 'launch', profile: 'my-launches', list: 'launch', paid: 'payments' }[pageRoute] || pageRoute);
  $$('.mobile-workspace-nav a').forEach(link=>{if(link.hash===`#${mobileRoute}`)link.setAttribute('aria-current','page');else link.removeAttribute('aria-current');});
  $$('[data-purpose-route]').forEach(link=>{const active=link.dataset.purposeRoute===route||(!location.hash&&link.dataset.purposeRoute===pageRoute);if(active)link.setAttribute('aria-current','location');else link.removeAttribute('aria-current');});
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
  if(pageRoute==='payments')document.title='Rewards · richpad.fun';
  else if(route==='launch')document.title='Create a coin · richpad.fun';
  else document.title=routeTitle();
  const request = ++scrollRequest;
  const fragment = location.hash;
  if(route==='referral-faq') {
    // Reveal and focus the guide only after both route renderers have settled.
    requestAnimationFrame(()=>requestAnimationFrame(()=>{
      if(request!==scrollRequest || location.hash!=='#referral-faq')return;
      const section=$('#referral-faq');
      const heading=section?.querySelector('h2');
      if(!section?.getClientRects().length || !heading)return;
      section.scrollIntoView({block:'start',behavior:'instant'});
      heading.tabIndex=-1;
      heading.focus({preventScroll:true});
    }));
  } else if(route!==lastSyncedRoute && !route.includes('/') && route!=='funded-holder-token-rewards') {
    // Each workspace route begins with its own header. Native fragment scrolling
    // can otherwise leave the shared header partly offscreen after layout changes.
    requestAnimationFrame(()=>requestAnimationFrame(()=>{
      if(location.hash===fragment)window.scrollTo({top:0,behavior:'instant'});
    }));
  }
  lastSyncedRoute=route;
}

navigation(); home(); explore(); launch(); rewards(); secondaryPages(); protocolPage(); mergePurposePages(); tokenPage();
document.body.classList.add('workspace-ready');
window.addEventListener('funded:route-change',syncRoute);
window.addEventListener('funded:layout-change',syncRoute);
window.addEventListener('hashchange',syncRoute);
document.addEventListener('click',event=>{
  const link=event.target.closest('a[href="#referral-faq"]');
  if(!link || event.defaultPrevented || event.button!==0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)return;
  if(location.hash==='#referral-faq'){
    event.preventDefault();
    syncRoute();
  }
});
matchMedia('(min-width:1180px)').addEventListener('change',syncRoute);
const coinPageTitle=$('#coin-page-title');
if(coinPageTitle)new MutationObserver(()=>{if(coinRoute())document.title=routeTitle();}).observe(coinPageTitle,{childList:true,characterData:true,subtree:true});
syncRoute();
