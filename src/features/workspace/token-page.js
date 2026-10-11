import { $, node, $$, tabs, disclose } from './dom.js';

export function tokenPage() {
  const root=$('#coin-page');if(!root)return;
  const layout=$('.coin-layout',root);
  const chart=$('.coin-chart-panel',root);const column=chart?.parentElement;
  if(column)column.prepend(chart);
  const hero=$('.coin-hero-card',root);
  const stats=$('.coin-stat-strip',root);
  if(hero&&stats)hero.append(stats);
  if(layout&&hero)hero.after(layout);
  const description=$('#coin-description',root);
  let heroAside;
  if(hero&&description){
    const artwork=node('div','coin-artwork');
    artwork.setAttribute('aria-hidden','true');
    const packageLabel=node('span','coin-artwork-package');packageLabel.id='coin-artwork-package';packageLabel.hidden=true;
    const artworkSymbol=node('span','coin-artwork-symbol','TOKEN');artworkSymbol.id='coin-artwork-symbol';
    artwork.append(packageLabel,artworkSymbol);
    hero.prepend(artwork);
    const symbolLabel=$('#coin-symbol',hero);
    const avatar=$('#coin-avatar',hero);
    const syncArtwork=()=>{
      artworkSymbol.textContent=symbolLabel?.textContent?.trim()||'TOKEN';
      const image=artwork.dataset.bannerUrl ? `url("${artwork.dataset.bannerUrl}")` : avatar?.style.backgroundImage;
      if(image&&image!=='none'){
        artwork.style.backgroundImage=`linear-gradient(0deg, #07130dc9, #07130d66), ${image}`;
        artwork.classList.add('has-image');
      }else{
        artwork.style.backgroundImage='';
        artwork.classList.remove('has-image');
      }
    };
    syncArtwork();
    if(symbolLabel)new MutationObserver(syncArtwork).observe(symbolLabel,{childList:true,characterData:true,subtree:true});
    if(avatar)new MutationObserver(syncArtwork).observe(avatar,{attributes:true,attributeFilter:['style']});
    new MutationObserver(syncArtwork).observe(artwork,{attributes:true,attributeFilter:['data-banner-url']});
    const about=node('div','coin-hero-about');about.id='coin-profile';
    const aboutPanel=node('div','coin-profile-panel');
    const tagline=node('p','coin-profile-tagline');tagline.id='coin-profile-tagline';tagline.hidden=true;
    aboutPanel.append(tagline,description);
    const factRibbon=$('.coin-fact-ribbon',hero);
    if(factRibbon)aboutPanel.append(factRibbon);
    const updatesPanel=node('div','coin-profile-panel coin-profile-updates');
    updatesPanel.append(node('strong','','No updates yet'),node('p','','Updates from this project will appear here.'));
    const roadmapPanel=node('section','coin-profile-roadmap-section');roadmapPanel.id='coin-profile-roadmap-section';
    roadmapPanel.append(node('h3','','Project roadmap'));
    const roadmap=node('p','coin-profile-roadmap','No signed roadmap was provided for this token.');roadmap.id='coin-profile-roadmap';
    roadmapPanel.append(roadmap);
    const linksPanel=node('section','coin-profile-links');linksPanel.id='coin-profile-links';
    linksPanel.append(node('p','coin-profile-links-note','Project links come from signed launch metadata. Check the destination before connecting a wallet.'));
    const linksList=node('ul','coin-profile-links-list');linksList.id='coin-profile-links-list';linksPanel.append(linksList);
    about.append(aboutPanel,updatesPanel,roadmapPanel,linksPanel);
    const selectProfile=tabs(about,[{key:'about',label:'About',panel:aboutPanel},{key:'updates',label:'Updates',panel:updatesPanel},{key:'roadmap',label:'Roadmap',panel:roadmapPanel},{key:'links',label:'Links',panel:linksPanel}],'Token profile');
    window.fundedSetCoinProfileMetadata=details=>{
      const text=typeof details?.roadmap==='string'?details.roadmap.trim():'';
      roadmap.textContent=text;
      selectProfile.setAvailable('roadmap',Boolean(text));
      linksList.replaceChildren();
      for(const [label,href] of [['Website',details?.website],['X',details?.twitter],['Telegram',details?.telegram],['Discord',details?.discord]]){
        if(typeof href!=='string'||!href.startsWith('https://'))continue;
        let host;
        try{host=new URL(href).hostname;}catch{continue;}
        const item=node('li');const link=node('a','',`${label} ↗`);
        link.href=href;link.target='_blank';link.rel='noopener noreferrer';
        item.append(link,node('small','',host));linksList.append(item);
      }
      selectProfile.setAvailable('links',linksList.childElementCount>0);
    };
    window.fundedSetCoinProfileMetadata({});
    heroAside=node('div','coin-hero-aside');
    heroAside.append(about);
    hero.append(heroAside);
    window.fundedRenderCoinPromotionBadge?.();
  }
  const chartPanel=$('.coin-chart-panel',root);
  const chartPath=$('#coin-price-path',chartPanel);
  if(chartPath){
    const toolbar=node('div','coin-chart-toolbar');
    chartPath.before(toolbar);
    const controls=node('div','coin-chart-metric-controls');
    const range=node('div','coin-chart-metric-group coin-chart-period-group');range.setAttribute('role','group');range.setAttribute('aria-label','Observed trade range');
    range.append(node('span','coin-chart-range-label','RANGE'));
    for(const value of ['5m','1h','6h','24h']){const button=node('button','',value);button.type='button';button.dataset.coinChartPeriod=value;button.setAttribute('aria-pressed',String(value==='24h'));range.append(button);}
    controls.append(range);
    for(const [label,attribute,choices,selected] of [
      ['Chart measure','coinChartMetric',[['mcap','Market cap'],['price','Price']],'mcap'],
      ['Chart currency','coinChartUnit',[['usd','USD'],['sol','SOL']],'usd']
    ]){
      const group=node('div','coin-chart-metric-group');group.setAttribute('role','group');group.setAttribute('aria-label',label);
      for(const [value,text] of choices){const button=node('button','',text);button.type='button';button.dataset[attribute]=value;button.setAttribute('aria-pressed',String(value===selected));group.append(button);}
      controls.append(group);
    }
    toolbar.append(controls);
  }
  const metrics=$('#coin-summary-dashboard',root);
  if(layout&&metrics)layout.after(metrics);
  const trade=$('#trade-panel',root);
  const pulse=$('.coin-pulse-panel',root);
  const side=$('.coin-side-column',root);
  const curve=$('.coin-curve-track',root);
  const flow=$('.coin-flow',root);
  flow?.remove();
  if(trade&&curve){
    const market=node('section','panel coin-market-aside');
    market.append(node('h2','coin-market-aside-title','Bonding curve'),curve);
    trade.after(market);
  }
  if(pulse&&trade)trade.after(pulse);
  const policy=$('.coin-policy-card',root);
  const distribution=$('#coin-account-distribution',root);
  if(side&&policy&&distribution){
    const holders=node('section','panel coin-holders-aside');
    holders.setAttribute('aria-labelledby','coin-holders-aside-title');
    const heading=node('div','coin-holders-aside-head');
    const title=node('h2','','Holder distribution');title.id='coin-holders-aside-title';
    const view=node('button','coin-holders-aside-link','View holders →');view.type='button';
    view.addEventListener('click',()=>{
      $('#coin-page [data-coin-tab="holders"]')?.click();
      $('.coin-tabs-panel',root)?.scrollIntoView({behavior:'smooth',block:'start'});
    });
    heading.append(title,view);
    const status=node('p','coin-holders-aside-status','Checking verified holder wallets…');status.id='coin-holder-distribution-status';
    status.hidden=!distribution.hidden;
    holders.append(heading,distribution,status);
    policy.before(holders);
  }
  policy?.remove();
  const slippage=$('#trade-slippage')?.closest('label');disclose(slippage,'Trade settings · slippage');
  const button=node('button','mobile-trade-open','Trade token');button.type='button';
  const tradeHeading = $('#coin-page-title', root);
  const syncTradeAction = () => {
    const unavailable = tradeHeading?.textContent?.trim() === 'Token data unavailable';
    button.classList.toggle('is-unavailable', unavailable);
    button.textContent = unavailable ? 'View trade status' : 'Trade token';
  };
  if (tradeHeading) new MutationObserver(syncTradeAction).observe(tradeHeading, { childList: true, characterData: true, subtree: true });
  syncTradeAction();
  const sheetBackground = new Map();
  const setSheet = open => {
    root.classList.toggle('trade-sheet-open',open);button.setAttribute('aria-expanded',String(open));
    if(open){
      for(let branch=trade;branch?.parentElement;branch=branch.parentElement){for(const sibling of branch.parentElement.children){if(sibling!==branch&&sibling.tagName!=='DIALOG'&&!sheetBackground.has(sibling)){sheetBackground.set(sibling,sibling.inert);sibling.inert=true;}}if(branch.parentElement===document.body)break;}
      trade?.setAttribute('role','dialog');trade?.setAttribute('aria-modal','true');trade?.setAttribute('aria-label','Trade token');trade?.setAttribute('tabindex','-1');trade?.focus();
    }
    else {for(const [element,inert] of sheetBackground)element.inert=inert;sheetBackground.clear();trade?.removeAttribute('role');trade?.removeAttribute('aria-modal');trade?.removeAttribute('aria-label');}
  };
  button.addEventListener('click',()=>setSheet(!root.classList.contains('trade-sheet-open')));
  button.setAttribute('aria-controls','trade-panel');button.setAttribute('aria-expanded','false');
  const tradeActionAnchor=$('.coin-stat-strip',root);
  if(tradeActionAnchor)tradeActionAnchor.after(button);else root.append(button);
  const close=node('button','mobile-trade-close','Close trade');close.type='button';close.addEventListener('click',()=>{setSheet(false);button.focus();});trade?.prepend(close);
  window.addEventListener('hashchange',()=>setSheet(false));
  matchMedia('(max-width:700px)').addEventListener('change',()=>setSheet(false));
  trade?.addEventListener('keydown',event=>{
    if(!root.classList.contains('trade-sheet-open')||!matchMedia('(max-width:700px)').matches)return;
    if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close.click();return;}
    if(event.key==='Tab'){const controls=$$('button,a,input,select,summary',trade).filter(el=>!el.disabled&&el.getClientRects().length);const first=controls[0],last=controls.at(-1);if(event.shiftKey&&(document.activeElement===first||document.activeElement===trade)){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}}
  });
}
