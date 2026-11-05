const views=new WeakMap();
const signaturePattern=/^[1-9A-HJ-NP-Za-km-z]{80,90}$/;

export function createHomeTradeTracker(now=Date.now) {
  const started=Math.floor(now()/1000),seen=new Map(),activity=new Map();
  return records=>{
    const fresh=new Map();
    for(const item of records){
      const trades=(item.recentTrades||[]).filter(t=>signaturePattern.test(String(t.signature||''))&&['buy','sell'].includes(t.side)&&Number.isFinite(t.blockTime)&&t.blockTime>0);
      trades.sort((a,b)=>b.blockTime-a.blockTime);
      const trade=trades[0];if(!trade)continue;
      const previous=seen.get(item.address),known=previous?.signatures||new Set();
      const unseen=!known.has(trade.signature);
      for(const row of trades)known.add(row.signature);
      while(known.size>256)known.delete(known.values().next().value);
      if(!previous||trade.blockTime>=previous.time){
        seen.set(item.address,{signatures:known,time:trade.blockTime});
        if(unseen&&trade.blockTime>=started&&trade.blockTime<=now()/1000+5){
          activity.set(item.address,{time:trade.blockTime,signature:trade.signature});fresh.set(item.address,trade.signature);
        }
      }
    }
    const present=new Set(records.map(item=>item.address));for(const key of seen.keys())if(!present.has(key)){seen.delete(key);activity.delete(key);}
    const sorted=[...records].sort((a,b)=>(activity.get(b.address)?.time||0)-(activity.get(a.address)?.time||0)||Number(b.createdTimestamp||0)-Number(a.createdTimestamp||0));
    return {records:sorted.slice(0,6),fresh};
  };
}

export function homeLiveCards(grid,records,{markup,decorate,loadLogos,now=Date.now,preserveOrder=false}) {
  let view=views.get(grid);
  if(!view){
    view={track:createHomeTradeTracker(now),pending:null,pulses:new Map()};views.set(grid,view);
    const resume=()=>queueMicrotask(()=>{if(!grid.matches(':hover')&&!grid.contains(grid.ownerDocument.activeElement)){const pending=view.pending;view.pending=null;pending?.();}});
    grid.addEventListener('pointerleave',resume);grid.addEventListener('focusout',resume);
  }
  const result=view.track(records);for(const [mint,signature] of result.fresh)view.pulses.set(mint,signature);
  if(preserveOrder)result.records=records.slice(0,6);
  const render=()=>{
    const existing=new Map([...grid.querySelectorAll('.home-new-token-card')].map(card=>[card.dataset.mint,card]));
    const keep=new Set();
    for(const item of result.records){
      const html=markup(item);let card=existing.get(item.address);
      if(!card){const template=grid.ownerDocument.createElement('template');template.innerHTML=html;card=template.content.firstElementChild;}
      else if(card.dataset.renderedMarkup!==html){const template=grid.ownerDocument.createElement('template');template.innerHTML=html;card.replaceChildren(...template.content.firstElementChild.childNodes);}
      card.dataset.renderedMarkup=html;keep.add(card);grid.append(card);decorate(card,item.address);
      const signature=view.pulses.get(item.address);
      if(signature&&signature!==card.dataset.tradeSignature){
        card.dataset.tradeSignature=signature;card.classList.remove('has-new-trade');void card.offsetWidth;card.classList.add('has-new-trade');
        const badge=grid.ownerDocument.createElement('span');badge.className='home-trade-pulse-label';badge.textContent='New trade';card.querySelector('.home-new-token-art').append(badge);
        card.addEventListener('animationend',()=>{card.classList.remove('has-new-trade');badge.remove();},{once:true});
        setTimeout(()=>{card.classList.remove('has-new-trade');badge.remove();},2500);
      }
    }
    for(const child of [...grid.children])if(!keep.has(child))child.remove();
    view.pulses.clear();
    loadLogos(grid);
  };
  if(grid.children.length&&(grid.matches(':hover')||grid.contains(grid.ownerDocument.activeElement)))view.pending=render;
  else {view.pending=null;render();}
  return result.records;
}
