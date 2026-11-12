import {icon} from '../../../ui-icons.js';
import {activeBoostMultiplier} from '../../../boost-offer.js';
import {featuredBannerMetricsMarkup} from './featured-metrics.js';
import {escapeHtml} from '../shared/display.js';
import {tokenArtworkUrl} from '../shared/token-artwork.js';

function artwork(mint,uri,kind,cluster) {
  const source=tokenArtworkUrl(mint,uri,kind,cluster);
  if (/^\/devnet-(images|banners)\/[1-9A-HJ-NP-Za-km-z]+$/.test(source)) return source;
  try {const url=new URL(source);return url.protocol==='https:'?url.href:'';}catch{return '';}
}

export function featuredCardMarkup(item,cluster,now=Date.now()) {
  const href=`/token/${encodeURIComponent(item.mint)}`;
  // Mainnet tokens without stored artwork use the same-origin logo route.
  const logo=artwork(item.mint,item.imageUri,'image',cluster)||(cluster==='mainnet-beta'&&/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(item.mint)?`/api/tokens/${encodeURIComponent(item.mint)}/logo`:''),banner=artwork(item.mint,item.bannerUri,'banner',cluster);
  const e=escapeHtml,boost=activeBoostMultiplier(item.boost,now);
  return `<article class="home-featured-card" data-featured-mint="${e(item.mint)}">
    <a class="home-featured-token" href="${href}" aria-label="View ${e(item.name)} (${e(item.symbol)})${boost>0?` · ${boost.toLocaleString('en-US')} times active boost`:''}">
      <div class="home-featured-art"><span class="home-featured-monogram" aria-hidden="true">${e(item.symbol.slice(0,5))}</span>${banner?`<img class="home-featured-banner" src="${e(banner)}" alt="" decoding="async" loading="lazy" referrerpolicy="no-referrer">`:''}<span class="home-featured-label">${e(item.label)}</span><dl class="home-featured-banner-metrics" aria-label="Token metrics">${featuredBannerMetricsMarkup()}</dl></div>
      <div class="home-featured-identity"><span class="home-featured-logo" aria-hidden="true">${e(item.symbol.slice(0,2))}${logo?`<img src="${e(logo)}" alt="" decoding="async" loading="lazy" referrerpolicy="no-referrer">`:''}</span><span><strong>${e(item.name)}</strong><small class="home-featured-symbol"><span>$${e(item.symbol)}</span>${boost>0?`<span class="home-featured-boost" aria-label="${boost.toLocaleString('en-US')} times active boost" title="Active paid boost"><span class="boost-leading-icon">${icon('boost')}</span>${boost.toLocaleString('en-US')}×</span>`:''}</small></span><span aria-hidden="true">↗</span></div>
    </a>
  </article>`;
}

// Native horizontal scrolling remains available with motion off. Copies are
// pointer-accessible but excluded from the keyboard and screen-reader sequence.
export function createFeaturedScroller(root) {
  const viewport=root.querySelector('.home-featured-viewport'),track=root.querySelector('.home-featured-track');
  const button=root.querySelector('[data-featured-pause]');
  const reduced=matchMedia('(prefers-reduced-motion: reduce)');
  let paused=reduced.matches,visible=false,frame=0,last=0,holdUntil=0,cycle=0,key='';
  const copies=()=>{
    track.querySelectorAll('[data-featured-copy]').forEach(node=>node.remove());
    const group=track.firstElementChild;if(!group)return;
    cycle=group.getBoundingClientRect().width;
    if (!cycle) return;
    for(let n=0;n<Math.ceil(viewport.clientWidth/cycle)+1;n++){
      const clone=group.cloneNode(true);clone.dataset.featuredCopy='';clone.setAttribute('aria-hidden','true');
      clone.querySelectorAll('a').forEach(a=>{a.tabIndex=-1;});track.append(clone);
    }
    viewport.scrollLeft%=cycle;
  };
  const canRun=()=>visible&&!document.hidden&&!paused&&!reduced.matches;
  const animate=time=>{
    if(!canRun()){frame=0;last=0;return;}
    const elapsed=last?Math.min(time-last,64):0;last=time;
    if(cycle&&time>=holdUntil&&!root.matches(':hover, :focus-within')){
      viewport.scrollLeft+=elapsed*0.03;
      if(viewport.scrollLeft>=cycle)viewport.scrollLeft-=cycle;
    }
    frame=requestAnimationFrame(animate);
  };
  const sync=()=>{
    button.textContent=reduced.matches?'Motion off':paused?'Play':'Pause';button.setAttribute('aria-pressed',String(paused||reduced.matches));
    button.setAttribute('aria-label',paused||reduced.matches?'Start featured token scrolling':'Pause featured token scrolling');
    if(canRun()&&!frame)frame=requestAnimationFrame(animate);
    if(!canRun()&&frame){cancelAnimationFrame(frame);frame=0;last=0;}
  };
  button.addEventListener('click',()=>{paused=!paused;sync();});
  reduced.addEventListener('change',()=>{paused=reduced.matches;sync();});
  // Respect reduced motion even if Play is pressed; manual browsing always works.
  button.disabled=reduced.matches;
  reduced.addEventListener('change',()=>{button.disabled=reduced.matches;});
  for(const event of ['pointerdown','wheel','keydown'])viewport.addEventListener(event,()=>{holdUntil=performance.now()+6000;},{passive:true});
  viewport.addEventListener('keydown',event=>{
    if(event.target!==viewport||!['ArrowRight','ArrowLeft'].includes(event.key))return;
    event.preventDefault();viewport.scrollBy({left:event.key==='ArrowRight'?280:-280,behavior:'instant'});
  });
  root.addEventListener('error',event=>{if(event.target.matches?.('img'))event.target.hidden=true;},true);
  new ResizeObserver(copies).observe(viewport);
  new IntersectionObserver(entries=>{visible=entries[0].isIntersecting;sync();}).observe(root);
  document.addEventListener('visibilitychange',sync);
  sync();
  return {updateMetrics(byMint){
    for(const card of track.querySelectorAll('[data-featured-mint]')){
      const metrics=byMint.get(card.dataset.featuredMint);
      if(!metrics)continue;
      for(const [selector,markup] of [['.home-featured-banner-metrics',featuredBannerMetricsMarkup]]){
        const target=card.querySelector(selector);if(!target)continue;
        const html=markup(metrics);
        if(target.dataset.metricsKey!==html){target.innerHTML=html;target.dataset.metricsKey=html;}
      }
    }
  },render(items,cluster){
    const next=items.map(item=>featuredCardMarkup(item,cluster)).join('');
    if(next===key)return;key=next;track.innerHTML=next?`<div class="home-featured-group">${next}</div>`:'';
    viewport.hidden=!items.length;button.hidden=!items.length;copies();sync();
  }};
}
