import { $$, $, node } from './dom.js';
import { icon } from '../../../ui-icons.js';
import { isDevnetImageUri } from '../../../devnet-metadata.js';
import { loadTokenArtwork } from '../shared/token-artwork.js';
import { productHelpTopics } from '../help/product-guidance.js';
import { helpTopicForLocation } from '../help/page-guidance.js';
import { candidateHref,creatorSearchCandidates } from '../experience/search-model.js';
import { apiRequest } from '../../../client.js';
import { commandSearchCandidates, commandHref } from '../growth/command-actions.js';

export function navigation() {
  $$('[data-icon]').forEach(item => item.innerHTML = icon(item.dataset.icon));
  $('#notifications-button').innerHTML = icon('notifications');
  $('#open-menu').innerHTML = icon('menu');
  $('#close-menu').innerHTML = icon('close');
  $('.search-box > span').innerHTML = icon('explore');
  $('#desktop-sidebar-toggle span').innerHTML = icon('chevronLeft');
  $('#home-ticker-back').innerHTML = icon('chevronLeft');
  $('#home-ticker-forward').innerHTML = icon('chevronRight');
  $('#home-feed-pause').innerHTML = icon('pause');
  $('.home-feed-settings summary').innerHTML = icon('filter');
  $('#coin-copy-address').innerHTML = icon('copy');
  $('[data-home-view="grid"]').innerHTML = `${icon('grid')} Grid`;
  $('[data-home-view="table"]').innerHTML = `${icon('table')} Table`;
  Object.entries({
    'home-kpi-launches-card':'launch', 'home-kpi-fees-card':'coin',
    'home-kpi-app-revenue-card':'analytics', 'home-kpi-holders-card':'users',
    'home-kpi-x-card':'socialX', 'home-kpi-buyback-card':'refresh',
    'home-kpi-burn-card':'burn', 'home-kpi-burn-value-card':'coin',
    'home-kpi-community-card':'users', 'home-kpi-airdrop-card':'rewards',
    'home-kpi-referrals-card':'send', 'home-kpi-volume-card':'analytics',
  }).forEach(([id, name]) => {
    const mark = $(`#${id} .home-kpi-icon`);
    if (mark) mark.innerHTML = icon(name);
  });
  const feedSettings = $('.home-feed-settings');
  feedSettings?.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    feedSettings.open = false;
    $('summary', feedSettings)?.focus();
  });
  document.addEventListener('pointerdown', event => {
    if (feedSettings?.open && !feedSettings.contains(event.target)) feedSettings.open = false;
  });
  $$('button.dialog-close, #explore-filter-close, #share-close').forEach(button => {
    if (button.textContent.trim() === '×') button.innerHTML = icon('close');
  });
  const searchTrigger = $('#header-search-trigger') || node('button', 'header-search-trigger');
  searchTrigger.innerHTML = icon('explore');
  searchTrigger.type = 'button';
  searchTrigger.id = 'header-search-trigger';
  searchTrigger.setAttribute('aria-label', 'Search launches');
  searchTrigger.setAttribute('aria-haspopup', 'dialog');
  searchTrigger.setAttribute('aria-controls', 'header-search-dialog');
  if (!searchTrigger.isConnected) $('.top-actions')?.before(searchTrigger);
  const searchDialog = node('dialog', 'header-search-dialog');
  searchDialog.id = 'header-search-dialog';
  searchDialog.setAttribute('aria-label', 'Search launches');
  searchDialog.innerHTML = `<form class="header-search-panel"><label for="header-search-input">Search launches</label><div class="header-search-field"><span aria-hidden="true">${icon('explore')}</span><input id="header-search-input" type="search" role="combobox" aria-autocomplete="list" aria-expanded="true" autocomplete="off" placeholder="Search name, ticker, or mint" aria-controls="header-search-results" /><button type="button" class="header-search-close" aria-label="Close search">${icon('close')}</button></div><div class="header-search-results-head"><strong id="header-search-results-title">EXPLORE TOKENS</strong><span>NAME · SYMBOL · ADDRESS</span></div><div id="header-search-results" class="header-search-results" role="listbox" aria-label="Verified launch search results"></div><p id="header-search-help" role="status" aria-live="polite">↑↓ navigate · ↵ open · Esc close</p></form>`;
  document.body.append(searchDialog);
  const modalSearch = $('#header-search-input', searchDialog);
  modalSearch.placeholder='Token, creator wallet, address or transaction';
  $('#header-search-help',searchDialog).textContent='↑↓ navigate · ↵ open · Esc close. Creator identities and wallet ownership are different facts.';
  const globalSearch = $('#global-search');
  const searchResults = $('#header-search-results', searchDialog);
  const searchHelp = $('#header-search-help', searchDialog);
  searchResults.setAttribute('aria-label', 'Pages, actions and launch search results');
  modalSearch.setAttribute('aria-describedby', 'header-search-help');
  modalSearch.placeholder = 'Token, page, creator, address or transaction';
  const defaultSearchHelp = searchHelp.textContent;
  let candidates = [];
  let creatorCandidates=[],creatorQuery='',creatorTimer=null,creatorVersion=0;
  // A pasted address that is a token mint (any launchpad or DEX) opens its token page, ahead of the wallet profile.
  let tokenCandidates=[],tokenQuery='',tokenVersion=0;
  let activeCandidate = -1;
  let selectionMoved = false;
  let searchNavigationPending = false;
  const destination = candidate => commandHref(candidate) || candidateHref(candidate);
  const renderSearchResults = ({ preserveSelection = false } = {}) => {
    const selectedMint = preserveSelection && activeCandidate >= 0 ? candidates[activeCandidate]?.mint : null;
    candidates = window.fundedVerifiedSearchCandidates?.(modalSearch.value) || [];
    if(modalSearch.value.trim()===tokenQuery&&tokenCandidates.length)candidates=[...tokenCandidates,...candidates.filter(row=>!tokenCandidates.some(token=>token.mint===row.mint))];
    if(modalSearch.value.trim()===creatorQuery)candidates=[...candidates,...creatorCandidates];
    candidates = [...commandSearchCandidates(modalSearch.value), ...candidates];
    if (preserveSelection) activeCandidate = selectedMint ? candidates.findIndex(candidate => candidate.mint === selectedMint) : -1;
    else activeCandidate = candidates.length ? 0 : -1;
    if (selectedMint && activeCandidate < 0) {
      searchHelp.textContent = 'Your selected result is no longer in the current list. Choose another result or press Enter to search Explore.';
    } else if (!preserveSelection) searchHelp.textContent = defaultSearchHelp;
    $('#header-search-results-title', searchDialog).textContent = modalSearch.value.trim() ? 'PAGES, ACTIONS & TOKENS' : 'EXPLORE TOKENS';
    searchResults.replaceChildren();
    if (!candidates.length) {
      const empty = node('p', 'header-search-empty', modalSearch.value.trim() ? 'No matching results. Press Enter to search Explore.' : 'No tokens available right now.');
      searchResults.append(empty);
    }
    candidates.forEach((candidate, index) => {
      const link = node('a', 'header-search-result');
      link.id = `header-search-result-${index}`;
      link.href = destination(candidate);
      link.setAttribute('role', 'option');
      link.setAttribute('aria-selected', String(index === activeCandidate));
      link.tabIndex = -1; // The combobox owns keyboard focus; arrows select options.
      const token = node('span', 'header-search-token');
      const avatar = node('span', 'header-search-avatar', String(candidate.symbol || 'T').slice(0, 1).toUpperCase());
      avatar.setAttribute('aria-hidden', 'true');
      const identity = node('span', 'header-search-identity');
      identity.append(node('strong', '', candidate.name), node('small', '', candidate.type ? `${candidate.symbol} · ${candidate.subtitle}` : `$${candidate.symbol} · ${candidate.mint.slice(0, 5)}…${candidate.mint.slice(-4)}`));
      const market = node('span', 'header-search-market');
      market.append(node('strong', '', candidate.marketCap), node('small', '', candidate.stage));
      if (candidate.freshness) { const age=node('small', 'market-freshness', candidate.freshness); age.dataset.inlineStatus=''; market.append(age); }
      token.append(avatar, identity);
      link.append(token, market);
      link.addEventListener('click', () => { searchNavigationPending = true; searchDialog.close(); });
      searchResults.append(link);
      if (candidate.logoUri && /^https:\/\//.test(candidate.logoUri)) {
        const image = document.createElement('img'); image.alt = ''; image.referrerPolicy = 'no-referrer'; image.src = candidate.logoUri;
        image.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:inherit';
        image.addEventListener('error', () => avatar.replaceChildren(String(candidate.symbol || 'T').slice(0, 1).toUpperCase()), { once: true });
        avatar.replaceChildren(image);
      } else if (candidate.verifiedLaunch && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(candidate.mint)) {
        const local = `/devnet-images/${encodeURIComponent(candidate.mint)}`;
        loadTokenArtwork(avatar, candidate.mint, isDevnetImageUri(candidate.imageUri,candidate.mint) ? candidate.imageUri : local);
      }
    });
    if (activeCandidate >= 0) {
      modalSearch.setAttribute('aria-activedescendant', `header-search-result-${activeCandidate}`);
      if (preserveSelection) searchResults.querySelector(`#header-search-result-${activeCandidate}`)?.scrollIntoView({ block: 'nearest' });
    } else modalSearch.removeAttribute('aria-activedescendant');
  };
  const selectCandidate = index => {
    activeCandidate = index;
    for (const [position, link] of [...searchResults.querySelectorAll('[role="option"]')].entries()) link.setAttribute('aria-selected', String(position === index));
    if (index >= 0) modalSearch.setAttribute('aria-activedescendant', `header-search-result-${index}`);
    else modalSearch.removeAttribute('aria-activedescendant');
    searchHelp.textContent = defaultSearchHelp;
    searchResults.querySelector(`#header-search-result-${index}`)?.scrollIntoView({ block: 'nearest' });
  };
  function lookupCreators(){
      clearTimeout(creatorTimer);const version=++creatorVersion,query=modalSearch.value.trim();creatorQuery=query;creatorCandidates=[];
      if(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(query)&&tokenQuery!==query){
        tokenQuery=query;tokenCandidates=[];
        const requestVersion=++tokenVersion;
        apiRequest(`/api/tokens/market?mints=${encodeURIComponent(query)}`,{signal:AbortSignal.timeout(8000)}).then(result=>{
          const row=(result?.data?.items||result?.items||[]).find(item=>item.mint===query);
          if(!row?.symbol||requestVersion!==tokenVersion||tokenQuery!==query||!searchDialog.open||modalSearch.value.trim()!==query)return;
          const price=Number(row.priceUsd);
          tokenCandidates=[{mint:query,name:String(row.name||row.symbol).slice(0,80),symbol:String(row.symbol).slice(0,20),logoUri:row.logoUri||null,
            marketCap:Number.isFinite(price)&&price>0?`$${price<0.01?price.toPrecision(3):price.toLocaleString('en-US',{maximumFractionDigits:4})}`:'Token',stage:'Open token page'}];
          // A delayed lookup must not replace an explicit keyboard selection.
          renderSearchResults({ preserveSelection: selectionMoved });
        }).catch(()=>{});
      }
      if(query.length<2||query.length>80||/^[1-9A-HJ-NP-Za-km-z]{32,88}$/.test(query))return;
      creatorTimer=setTimeout(async()=>{
        let result;try{result=await apiRequest(`/api/creators?${new URLSearchParams({q:query})}`,{signal:AbortSignal.timeout(8000)});}catch{}
        if(version!==creatorVersion||!searchDialog.open||modalSearch.value.trim()!==query)return;
        const next=result?.available?creatorSearchCandidates(result.data):[];
        if(JSON.stringify(next)!==JSON.stringify(creatorCandidates)){creatorCandidates=next;renderSearchResults({preserveSelection:selectionMoved});}
        if(!searchHelp.textContent.startsWith('Your selected result is no longer'))searchHelp.textContent=defaultSearchHelp+(result?.available?' · Creator directory checked.':' · Creator directory unavailable; loaded tokens and wallets remain searchable.');
      },300);
    }
  searchTrigger.addEventListener('click', () => {
    modalSearch.value = globalSearch?.value || '';
    selectionMoved = false;
    searchNavigationPending = false;
    tokenQuery = ''; tokenCandidates = []; tokenVersion++;
    renderSearchResults();
    searchDialog.showModal();
    lookupCreators();
    modalSearch.focus();
    modalSearch.select();
  });
  modalSearch.addEventListener('input',()=>{selectionMoved=false;lookupCreators();renderSearchResults();});
  document.addEventListener('funded:verified-search-index', () => { if (searchDialog.open) renderSearchResults({ preserveSelection: selectionMoved }); });
  modalSearch.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      event.preventDefault();
      searchDialog.close();
      return;
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    selectionMoved = true;
    if (candidates.length) {
      const next = activeCandidate < 0 ? event.key === 'ArrowDown' ? 0 : candidates.length - 1
        : (activeCandidate + (event.key === 'ArrowDown' ? 1 : candidates.length - 1)) % candidates.length;
      selectCandidate(next);
    }
  });
  $('.header-search-close', searchDialog).addEventListener('click', () => searchDialog.close());
  $('form', searchDialog).addEventListener('submit', event => {
    event.preventDefault();
    if (activeCandidate >= 0) { searchResults.querySelector(`#header-search-result-${activeCandidate}`)?.click(); return; }
    const query = modalSearch.value.trim();
    searchDialog.close();
    const applyQuery = () => {
      if (!globalSearch) return;
      globalSearch.value = query;
      globalSearch.dispatchEvent(new Event('input', { bubbles: true }));
    };
    if (location.hash !== '#explore') {
      window.addEventListener('hashchange', () => requestAnimationFrame(applyQuery), { once: true });
      location.hash = '#explore';
    } else applyQuery();
  });
  searchDialog.addEventListener('click', event => { if (event.target === searchDialog) searchDialog.close(); });
  searchDialog.addEventListener('close', () => { if (!searchNavigationPending && searchTrigger.getClientRects().length) searchTrigger.focus(); });
  const helpTrigger = node('button', 'help-topics-trigger', 'Help');
  helpTrigger.id = 'help-topics-trigger';
  helpTrigger.type = 'button';
  helpTrigger.setAttribute('aria-label', 'Open help topics');
  helpTrigger.setAttribute('aria-controls', 'help-topics-panel');
  helpTrigger.setAttribute('aria-expanded', 'false');
  const helpPanel = node('dialog', 'help-topics-panel');
  helpPanel.id = 'help-topics-panel';
  helpPanel.hidden = true;
  helpPanel.setAttribute('role', 'dialog');
  helpPanel.setAttribute('aria-modal', 'true');
  helpPanel.setAttribute('aria-label', 'richpad.fun help topics');
  helpPanel.innerHTML = `<header><div><strong>richpad.fun</strong><small>Solana help topics</small></div><button type="button" aria-label="Close help topics">${icon('close')}</button></header><p class="help-topics-intro">Guides and answers. Live chat is unavailable.</p><div class="help-topics-choices">${Object.entries(productHelpTopics()).map(([id,topic])=>`<button type="button" data-help-topic="${id}" aria-pressed="false">${topic.title}</button>`).join('')}</div><div class="help-topics-answer" role="status" aria-live="polite"><strong>How can we help?</strong><p>Choose a topic to see guidance.</p><a href="#docs">Open the help guide →</a></div>`;
  let helpReturnTo = null;
  const setHelpOpen = open => {
    if (open) {
      if (!helpPanel.open) helpReturnTo = document.activeElement;
      helpPanel.hidden = false;
      if (!helpPanel.open) helpPanel.showModal();
      helpTrigger.setAttribute('aria-expanded', 'true');
      $('#help-menu-trigger')?.setAttribute('aria-expanded', 'true');
      helpPanel.querySelector(`[data-help-topic="${helpTopicForLocation(location)}"]`)?.click();
      helpPanel.scrollTop = 0;
      helpPanel.querySelector('header button').focus();
    }
    else helpPanel.close();
  };
  helpPanel.addEventListener('close', () => {
      helpPanel.hidden = true;
      helpTrigger.setAttribute('aria-expanded', 'false');
      $('#help-menu-trigger')?.setAttribute('aria-expanded', 'false');
      const menu = $('#help-menu-trigger');
      (helpReturnTo?.isConnected && helpReturnTo.getClientRects().length && !helpReturnTo.closest('[inert]') ? helpReturnTo
        : helpTrigger.getClientRects().length ? helpTrigger
        : menu?.getClientRects().length && !menu.closest('[inert]') ? menu : $('#open-menu'))?.focus();
      helpReturnTo = null;
  });
  helpTrigger.addEventListener('click', () => setHelpOpen(helpPanel.hidden));
  helpPanel.querySelector('.help-topics-intro').textContent = 'Find your way to participate and earn. Understand rewards, eligibility, claims, and token protections. Issue reports are available in Profile.';
  helpPanel.querySelector('.help-topics-choices').before(helpPanel.querySelector('.help-topics-answer'));
  const menuHelp = node('button', 'nav-item help-menu-trigger', 'Help for this page');
  menuHelp.id = 'help-menu-trigger';
  menuHelp.type = 'button';
  menuHelp.setAttribute('aria-controls', 'help-topics-panel');
  menuHelp.setAttribute('aria-haspopup', 'dialog');
  menuHelp.setAttribute('aria-expanded', 'false');
  menuHelp.addEventListener('click', () => {
    if (document.body.classList.contains('menu-open')) $('#close-menu')?.click();
    setHelpOpen(true);
  });
  $('#sidebar a[href="#docs"]')?.after(menuHelp);
  helpPanel.querySelector('header button').addEventListener('click', () => setHelpOpen(false));
  helpPanel.addEventListener('click', event => {
    if (event.target === helpPanel) {
      const bounds = helpPanel.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) setHelpOpen(false);
    }
    const choice = event.target.closest('[data-help-topic]');
    if (choice) {
      const topic = productHelpTopics()[choice.dataset.helpTopic];
      for (const button of helpPanel.querySelectorAll('[data-help-topic]')) button.setAttribute('aria-pressed', String(button === choice));
      const answer = helpPanel.querySelector('.help-topics-answer');
      answer.querySelector('strong').textContent = topic.title;
      let points=answer.querySelector('ul');
      if(!points){points=document.createElement('ul');points.className='guidance-outline';answer.querySelector('p').replaceWith(points);}
      points.replaceChildren(...(topic.points||[topic.answer]).map(text=>{const item=document.createElement('li');item.textContent=text;return item;}));
      const link = answer.querySelector('a');
      link.href = topic.href;
      link.textContent = topic.link;
    }
    if (event.target.closest('.help-topics-answer a')) setHelpOpen(false);
  });
  window.addEventListener('hashchange', () => { if (!helpPanel.hidden) setHelpOpen(false); });
  document.body.append(helpTrigger, helpPanel);
  const mobile = node('nav', 'mobile-workspace-nav'); mobile.setAttribute('aria-label', 'Mobile navigation');
  const tradeActions = node('div', 'mobile-trade-actions');
  tradeActions.setAttribute('role', 'group'); tradeActions.setAttribute('aria-label', 'Token trade actions');
  const mobileLinks = node('div', 'mobile-navigation-links');
  for (const [href, label, glyph] of [['overview','Home','home'],['explore','Explore','explore'],['launch','Create','launch'],['portfolio','Portfolio','portfolio'],['rewards','Rewards','rewards']]) {
    const link = node('a', '', ''); link.href = `#${href}`;
    link.innerHTML = icon(glyph); link.append(node('span', '', label)); mobileLinks.append(link);
  }
  mobile.append(tradeActions, mobileLinks);
  document.body.append(mobile);
  const preference = node('label', 'workspace-preference', 'Start page');
  const select = node('select'); select.setAttribute('aria-label', 'Preferred start page');
  select.innerHTML = '<option value="overview">Home</option><option value="explore">Explore</option>';
  try { select.value = localStorage.getItem('funded.start-page') || 'overview'; } catch {}
  select.addEventListener('change', () => { try { localStorage.setItem('funded.start-page', select.value); } catch {} });
  preference.append(select); $('#profile')?.append(preference);
  if (!location.hash && location.pathname === '/' && select.value === 'explore') location.hash = '#explore';
}
