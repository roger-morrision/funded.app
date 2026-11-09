import { linkWalletText } from '../shared/wallet-links.js';
import { updateCompactTokenLink } from '../shared/compact-token.js';
import {formatTokenBaseAmount} from '../../../trade-panel-balance.js';

export function mountSavedPortfolioTabs(app, document = globalThis.document) {
  const tabs=document.querySelector('.portfolio-view-tabs');if(!tabs)return;
  const panels=new Map();
  for(const [key,label] of [['tracking','Tracking wallets'],['favorites','Favorited coins'],['rewards','My rewards'],['referral','My referral']]) {
    const button=document.createElement('button');button.type='button';button.id=`portfolio-${key}-tab`;button.dataset.portfolioTab=key;
    button.setAttribute('role','tab');button.setAttribute('aria-selected','false');button.tabIndex=-1;button.setAttribute('aria-controls',`portfolio-${key}-panel`);button.textContent=label;
    const panel=document.createElement('section');panel.id=`portfolio-${key}-panel`;panel.className='portfolio-tab-panel portfolio-saved-panel';panel.hidden=true;panel.tabIndex=0;
    panel.setAttribute('role','tabpanel');panel.setAttribute('aria-labelledby',button.id);
    tabs.append(button);tabs.parentElement.append(panel);panels.set(key,panel);
  }
  const link=(label,href)=>Object.assign(document.createElement('a'),{textContent:label,href});
  let totals=null,totalWallet=null,lastRead=0,loadId=0,loading=false;
  const sol=value=>/^-?(0|[1-9]\d*)$/.test(String(value))?`${BigInt(value)<0n?'-':''}${formatTokenBaseAmount(String(BigInt(value)<0n?-BigInt(value):BigInt(value)),9,9)} SOL`:'-';
  async function loadTotals(){
    const wallet=app.connectedWalletAddress;if(!wallet||loading||Date.now()-lastRead<30000)return;
    loading=true;lastRead=Date.now();const id=++loadId;
    try{const result=await app.apiRequest(`/api/rewards/totals?wallet=${encodeURIComponent(wallet)}`,{signal:AbortSignal.timeout(20000)});
      if(id===loadId&&wallet===app.connectedWalletAddress)totals=result.available&&result.data?.wallet===wallet?result.data:null;
    }catch{if(id===loadId)totals=null;}finally{if(id===loadId){loading=false;render();}}
  }
  function render() {
    if(totalWallet!==app.connectedWalletAddress){totalWallet=app.connectedWalletAddress;totals=null;lastRead=0;loading=false;loadId++;}
    const tracking=panels.get('tracking'),favorites=panels.get('favorites');
    tracking.innerHTML='<h3>Tracking wallets</h3><div class="portfolio-saved-list"></div>';
    favorites.innerHTML='<h3>Favorited coins</h3><p>Your saved coins, with available market data.</p><div class="portfolio-saved-list"></div>';
    const wallets=app.getFollowedWallets(),coins=app.getWatchlist();
    for(const {address} of wallets) {
      const row=document.createElement('article');row.className='portfolio-wallet-card';
      const avatar=document.createElement('span');avatar.className='portfolio-wallet-avatar';avatar.textContent=address.slice(0,2);avatar.setAttribute('aria-hidden','true');
      const identity=document.createElement('div');identity.className='portfolio-wallet-identity';
      const label=document.createElement('small');label.textContent='Following';identity.append(label,link(app.shortAddress(address),`/wallet/${encodeURIComponent(address)}`));
      const full=document.createElement('small');full.textContent=address;linkWalletText(full,address);identity.append(full);row.append(avatar,identity);
      const actions=document.createElement('div');actions.className='portfolio-wallet-actions';actions.append(link('View wallet →',`/wallet/${encodeURIComponent(address)}`));
      const remove=document.createElement('button');remove.type='button';remove.className='secondary-button';remove.textContent='Unfollow';remove.setAttribute('aria-label',`Unfollow ${address}`);
      remove.addEventListener('click',async()=>{if(await app.saveFollowedWallet(address,{remove:true}))render();});actions.append(remove);row.append(actions);tracking.lastElementChild.append(row);
    }
    for(const mint of coins) {
      const row=document.createElement('article');row.className='portfolio-tracked-row';
      const coin=document.createElement('a');updateCompactTokenLink(coin,{mint,launch:app.verifiedLaunchPolicyForMint(mint)},document);row.append(coin);favorites.lastElementChild.append(row);
    }
    if(!wallets.length)tracking.lastElementChild.textContent='No tracked wallets yet. Open a wallet profile and choose Follow wallet.';
    if(!coins.length)favorites.lastElementChild.textContent=app.watchlistUnavailable?'-':'No favorites yet. Use the star on a coin to save it here.';
    tracking.append(link('Find wallets →','#leaderboard'));favorites.append(link('Explore coins →','#explore'));
    for(const key of ['rewards','referral']) {
      const panel=panels.get(key);panel.replaceChildren();
      const heading=document.createElement('h3');heading.textContent=key==='rewards'?'Total rewards received':'My referral';
      const identity=document.createElement('p');identity.textContent=app.connectedWalletAddress?`Connected wallet · ${app.shortAddress(app.connectedWalletAddress)}`:'Connect your wallet to check your personal results.';linkWalletText(identity,app.connectedWalletAddress);panel.append(heading,identity);
      const cards=document.createElement('div');cards.className='portfolio-action-cards';
      const items=[
        ['Invite creators','Get your wallet-linked invite link and track your network.','#referrals','Open my referral dashboard →'],
        ['Referral payments','Review qualifying activity and verified payment receipts.','#referrals','Check my referral rewards →'],
      ];
      if(key==='rewards'){
        const wrap=document.createElement('div');wrap.className='records-table-wrap';wrap.tabIndex=0;wrap.setAttribute('role','region');wrap.setAttribute('aria-label','Rewards received');
        const table=document.createElement('table');table.className='records-table';
        const head=document.createElement('thead'),tr=document.createElement('tr'),body=document.createElement('tbody');
        for(const label of ['Reward','Asset','Received','History']){const th=document.createElement('th');th.scope='col';th.textContent=label;tr.append(th);}head.append(tr);table.append(head,body);wrap.append(table);
        const rewardRows=[['Daily bonus','SOL',sol(totals?.bonusLamports),'#bonuses'],['Coin holder & creator rewards','SOL',sol(totals?.rewardsLamports),'#payments']];
        if(Array.isArray(totals?.airdrops)&&totals.airdrops.length){
          for(const row of totals.airdrops)rewardRows.push(['$RICH holder airdrop',row.symbol||'Token',formatTokenBaseAmount(row.amountBaseUnits,row.decimals,row.decimals),'#airdrops']);
        }else rewardRows.push(['$RICH holder airdrops','Tokens',Array.isArray(totals?.airdrops)?'0':'—','#airdrops']);
        for(const [category,asset,received,href] of rewardRows){
          const row=document.createElement('tr');for(const value of [category,asset,received]){const td=document.createElement('td');td.textContent=value;row.append(td);}
          row.children[2].className='numeric';const action=document.createElement('td');action.append(link('View history →',href));row.append(action);body.append(row);
        }
        panel.append(wrap);
      }else{
        for(const [title,description,href,action] of items){const card=link('',href);card.className='portfolio-action-card';const strong=document.createElement('strong'),note=document.createElement('span'),cta=document.createElement('b');strong.textContent=title;note.textContent=description;cta.textContent=action;card.append(strong,note,cta);cards.append(card);}panel.append(cards);
      }
      if(!app.connectedWalletAddress){const connect=document.createElement('button');connect.type='button';connect.className='primary-button';connect.textContent='Connect wallet';connect.addEventListener('click',()=>document.querySelector('#connect-button')?.click());panel.append(connect);}
    }
    void loadTotals();
  }
  tabs.addEventListener('click',render);tabs.addEventListener('keydown',event=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(event.key))render();});
  for(const event of ['funded:following-changed','funded:watchlist-changed','funded:route-change','funded:reward-identity-change'])document.defaultView.addEventListener(event,render);
  document.addEventListener('funded:verified-search-index',render);render();
}
