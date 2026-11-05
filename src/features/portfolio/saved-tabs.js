import { updateCompactTokenLink } from '../shared/compact-token.js';

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
  function render() {
    const tracking=panels.get('tracking'),favorites=panels.get('favorites');
    tracking.innerHTML='<h3>Tracking wallets</h3><p>Public wallets you follow on this device. Tracking never authorizes transactions.</p><div class="portfolio-saved-list"></div>';
    favorites.innerHTML='<h3>Favorited coins</h3><p>Your saved coins, with available market data.</p><div class="portfolio-saved-list"></div>';
    const wallets=app.getFollowedWallets(),coins=app.getWatchlist();
    for(const {address} of wallets) {
      const row=document.createElement('article');row.className='portfolio-wallet-card';
      const avatar=document.createElement('span');avatar.className='portfolio-wallet-avatar';avatar.textContent=address.slice(0,2);avatar.setAttribute('aria-hidden','true');
      const identity=document.createElement('div');identity.className='portfolio-wallet-identity';
      const label=document.createElement('small');label.textContent='Following';identity.append(label,link(app.shortAddress(address),`/wallet/${encodeURIComponent(address)}`));
      const full=document.createElement('small');full.textContent=address;identity.append(full);row.append(avatar,identity);
      const actions=document.createElement('div');actions.className='portfolio-wallet-actions';actions.append(link('View wallet →',`/wallet/${encodeURIComponent(address)}`));
      const remove=document.createElement('button');remove.type='button';remove.className='secondary-button';remove.textContent='Unfollow';remove.setAttribute('aria-label',`Unfollow ${address}`);
      remove.addEventListener('click',()=>{if(app.saveFollowedWallet(address,{remove:true}))render();});actions.append(remove);row.append(actions);tracking.lastElementChild.append(row);
    }
    for(const mint of coins) {
      const row=document.createElement('article');row.className='portfolio-tracked-row';
      const coin=document.createElement('a');updateCompactTokenLink(coin,{mint,launch:app.verifiedLaunchPolicyForMint(mint)},document);row.append(coin);favorites.lastElementChild.append(row);
    }
    if(!wallets.length)tracking.lastElementChild.textContent='No tracked wallets yet. Open a wallet profile and choose Follow wallet.';
    if(!coins.length)favorites.lastElementChild.textContent=app.watchlistUnavailable?'Favorites are unavailable. Check browser storage and try again.':'No favorites yet. Use the star on a coin to save it here.';
    tracking.append(link('Find wallets →','#leaderboard'));favorites.append(link('Explore coins →','#explore'));
    for(const key of ['rewards','referral']) {
      const panel=panels.get(key);panel.replaceChildren();
      const heading=document.createElement('h3');heading.textContent=key==='rewards'?'Check my rewards':'My referral';
      const identity=document.createElement('p');identity.textContent=app.connectedWalletAddress?`Connected wallet · ${app.shortAddress(app.connectedWalletAddress)}`:'Connect your wallet to check your personal results.';panel.append(heading,identity);
      const cards=document.createElement('div');cards.className='portfolio-action-cards';
      const items=key==='rewards'?[
        ['Daily bonus','Check your ranking, completed reward periods, and payments.','#bonuses','Check my bonus →'],
        ['$FUNDED Holder airdrops','Check eligible token allocations and claim deadlines.','#airdrops','Check my airdrops →'],
        ['Coin Holder & creator rewards','Review confirmed SOL payouts and available claims.','#payments','Check my rewards →'],
      ]:[
        ['Invite creators','Get your wallet-linked invite link and track your network.','#referrals','Open my referral dashboard →'],
        ['Referral payments','Review qualifying activity and verified payment receipts.','#referrals','Check my referral rewards →'],
      ];
      for(const [title,description,href,action] of items){const card=link('',href);card.className='portfolio-action-card';const strong=document.createElement('strong'),note=document.createElement('span'),cta=document.createElement('b');strong.textContent=title;note.textContent=description;cta.textContent=action;card.append(strong,note,cta);cards.append(card);}panel.append(cards);
      if(!app.connectedWalletAddress){const connect=document.createElement('button');connect.type='button';connect.className='primary-button';connect.textContent='Connect wallet';connect.addEventListener('click',()=>document.querySelector('#connect-button')?.click());panel.append(connect);}
    }
  }
  tabs.addEventListener('click',render);tabs.addEventListener('keydown',event=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(event.key))render();});
  for(const event of ['funded:following-changed','funded:watchlist-changed','funded:route-change','funded:reward-identity-change'])document.defaultView.addEventListener(event,render);
  document.addEventListener('funded:verified-search-index',render);render();
}
