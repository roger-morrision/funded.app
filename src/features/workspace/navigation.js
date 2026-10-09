import { $$, $, node } from './dom.js';
import { icon } from '../../../ui-icons.js';
import { EXPLORE_CLUSTER, APP_MAINNET_READ_ONLY } from '../../../app-config.js';

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
  $('.nav-more summary span').innerHTML = icon('chevronDown');
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
  const searchTrigger = node('button', 'header-search-trigger');
  searchTrigger.innerHTML = icon('explore');
  searchTrigger.type = 'button';
  searchTrigger.id = 'header-search-trigger';
  searchTrigger.setAttribute('aria-label', 'Search launches');
  searchTrigger.setAttribute('aria-haspopup', 'dialog');
  searchTrigger.setAttribute('aria-controls', 'header-search-dialog');
  $('.top-actions')?.before(searchTrigger);
  const searchDialog = node('dialog', 'header-search-dialog');
  searchDialog.id = 'header-search-dialog';
  searchDialog.setAttribute('aria-label', 'Search launches');
  searchDialog.innerHTML = `<form class="header-search-panel"><label for="header-search-input">Search launches</label><div class="header-search-field"><span aria-hidden="true">${icon('explore')}</span><input id="header-search-input" type="search" role="combobox" aria-autocomplete="list" aria-expanded="true" autocomplete="off" placeholder="Search name, ticker, or mint" aria-controls="header-search-results" /><button type="button" class="header-search-close" aria-label="Close search">${icon('close')}</button></div><div class="header-search-results-head"><strong id="header-search-results-title">EXPLORE TOKENS</strong><span>NAME · SYMBOL · ADDRESS</span></div><div id="header-search-results" class="header-search-results" role="listbox" aria-label="Verified launch search results"></div><p id="header-search-help">↑↓ navigate · ↵ open · Esc close</p></form>`;
  document.body.append(searchDialog);
  const modalSearch = $('#header-search-input', searchDialog);
  const globalSearch = $('#global-search');
  const searchResults = $('#header-search-results', searchDialog);
  let candidates = [];
  let activeCandidate = -1;
  const renderSearchResults = () => {
    candidates = window.fundedVerifiedSearchCandidates?.(modalSearch.value) || [];
    activeCandidate = candidates.length ? 0 : -1;
    $('#header-search-results-title', searchDialog).textContent = modalSearch.value.trim() ? 'SEARCH RESULTS' : 'EXPLORE TOKENS';
    searchResults.replaceChildren();
    if (!candidates.length) {
      const empty = node('p', 'header-search-empty', modalSearch.value.trim() ? 'No matching tokens. Press Enter to search Explore.' : 'No tokens available right now.');
      searchResults.append(empty);
    }
    candidates.forEach((candidate, index) => {
      const link = node('a', 'header-search-result');
      link.id = `header-search-result-${index}`;
      link.href = `/token/${encodeURIComponent(candidate.mint)}`;
      link.setAttribute('role', 'option');
      link.setAttribute('aria-selected', String(index === activeCandidate));
      const token = node('span', 'header-search-token');
      const avatar = node('span', 'header-search-avatar', String(candidate.symbol || 'T').slice(0, 1).toUpperCase());
      avatar.setAttribute('aria-hidden', 'true');
      const identity = node('span', 'header-search-identity');
      identity.append(node('strong', '', candidate.name), node('small', '', `$${candidate.symbol} · ${candidate.mint.slice(0, 5)}…${candidate.mint.slice(-4)}`));
      const market = node('span', 'header-search-market');
      market.append(node('strong', '', candidate.marketCap), node('small', '', candidate.stage));
      token.append(avatar, identity);
      link.append(token, market);
      link.addEventListener('click', () => searchDialog.close());
      searchResults.append(link);
      if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(candidate.mint)) {
        const image = new Image();
        image.alt = '';
        image.decoding = 'async';
        image.onload = () => { if (avatar.isConnected) avatar.replaceChildren(image); };
        image.src = `/devnet-images/${encodeURIComponent(candidate.mint)}`;
      }
    });
    modalSearch.setAttribute('aria-activedescendant', activeCandidate >= 0 ? `header-search-result-${activeCandidate}` : '');
  };
  const selectCandidate = index => {
    activeCandidate = index;
    for (const [position, link] of [...searchResults.querySelectorAll('[role="option"]')].entries()) link.setAttribute('aria-selected', String(position === index));
    modalSearch.setAttribute('aria-activedescendant', index >= 0 ? `header-search-result-${index}` : '');
    searchResults.querySelector(`#header-search-result-${index}`)?.scrollIntoView({ block: 'nearest' });
  };
  searchTrigger.addEventListener('click', () => {
    modalSearch.value = globalSearch?.value || '';
    renderSearchResults();
    searchDialog.showModal();
    modalSearch.focus();
    modalSearch.select();
  });
  modalSearch.addEventListener('input', renderSearchResults);
  document.addEventListener('funded:verified-search-index', () => { if (searchDialog.open) renderSearchResults(); });
  modalSearch.addEventListener('keydown', event => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    if (candidates.length) selectCandidate((activeCandidate + (event.key === 'ArrowDown' ? 1 : candidates.length - 1)) % candidates.length);
  });
  $('.header-search-close', searchDialog).addEventListener('click', () => searchDialog.close());
  $('form', searchDialog).addEventListener('submit', event => {
    event.preventDefault();
    if (activeCandidate >= 0) { location.assign(`/token/${encodeURIComponent(candidates[activeCandidate].mint)}`); return; }
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
  searchDialog.addEventListener('close', () => { if (searchTrigger.getClientRects().length) searchTrigger.focus(); });
  const helpTrigger = node('button', 'help-topics-trigger', 'Help');
  helpTrigger.id = 'help-topics-trigger';
  helpTrigger.type = 'button';
  helpTrigger.setAttribute('aria-label', 'Open help topics');
  helpTrigger.setAttribute('aria-controls', 'help-topics-panel');
  helpTrigger.setAttribute('aria-expanded', 'false');
  const helpPanel = node('aside', 'help-topics-panel');
  helpPanel.id = 'help-topics-panel';
  helpPanel.hidden = true;
  helpPanel.setAttribute('role', 'dialog');
  helpPanel.setAttribute('aria-label', 'funded.vip help topics');
  helpPanel.innerHTML = `<header><div><strong>funded.vip</strong><small>Solana help topics</small></div><button type="button" aria-label="Close help topics">${icon('close')}</button></header><p class="help-topics-intro">Find the record or guide you need. Live messaging is unavailable in this preview.</p><div class="help-topics-choices"><button type="button" data-help-topic="coin">Coin details</button><button type="button" data-help-topic="trade">Trading issues</button><button type="button" data-help-topic="airdrop">Airdrop status</button><button type="button" data-help-topic="launch">Launch receipts</button></div><div class="help-topics-answer" role="status" aria-live="polite"><strong>How can we help?</strong><p>Choose a topic to see where to check its verified Solana record.</p><a href="#docs">Open the help guide →</a></div>`;
  const helpTopics = {
    coin: { title: 'Coin details', answer: 'Open a token page to compare its mint, creator, market snapshot, and launch policy. Missing indexed fields are marked unavailable.', href: '#docs/coin-pages', link: 'Read about coin pages →' },
    trade: { title: 'Trading issues', answer: 'If your wallet shows a submitted trade, open its transaction link and check the result before trying again. If you cancelled in your wallet, refresh the quote when you are ready.', href: '#docs/trading', link: 'Read trading guidance →' },
    airdrop: { title: 'Airdrop status', answer: 'Check vault funding, the migration snapshot, claim proof, and any confirmed receipt before treating an allocation as claimable.', href: '#airdrops', link: 'Check airdrop evidence →' },
    launch: { title: 'Launch receipts', answer: 'Compare the mint, fee owner, tier burn, and finalized transaction from the token record. A selected tier is not a verified badge until its burn receipt is confirmed.', href: '#docs/launch', link: 'Read launch guidance →' },
  };
  const setHelpOpen = open => {
    helpPanel.hidden = !open;
    helpTrigger.setAttribute('aria-expanded', String(open));
    if (open) helpPanel.querySelector('header button').focus();
    else helpTrigger.focus();
  };
  helpTrigger.addEventListener('click', () => setHelpOpen(helpPanel.hidden));
  helpPanel.querySelector('header button').addEventListener('click', () => setHelpOpen(false));
  helpPanel.addEventListener('click', event => {
    const choice = event.target.closest('[data-help-topic]');
    if (choice) {
      const topic = helpTopics[choice.dataset.helpTopic];
      for (const button of helpPanel.querySelectorAll('[data-help-topic]')) button.setAttribute('aria-pressed', String(button === choice));
      const answer = helpPanel.querySelector('.help-topics-answer');
      answer.querySelector('strong').textContent = topic.title;
      answer.querySelector('p').textContent = topic.answer;
      const link = answer.querySelector('a');
      link.href = topic.href;
      link.textContent = topic.link;
    }
    if (event.target.closest('.help-topics-answer a')) setHelpOpen(false);
  });
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && !helpPanel.hidden) setHelpOpen(false); });
  window.addEventListener('hashchange', () => { if (!helpPanel.hidden) setHelpOpen(false); });
  document.body.append(helpTrigger, helpPanel);
  const mobile = node('nav', 'mobile-workspace-nav'); mobile.setAttribute('aria-label', 'Mobile workspace');
  for (const [href, label, glyph] of [['overview','Home','home'],['explore','Explore','explore'],['launch','Launch','launch'],['my-launches','Portfolio','portfolio'],['payments','Rewards','rewards']]) {
    const link = node('a', '', ''); link.href = `#${href}`;
    link.innerHTML = icon(glyph); link.append(node('span', '', label)); mobile.append(link);
  }
  document.body.append(mobile);
  const network = node('span', 'workspace-network', EXPLORE_CLUSTER === 'mainnet-beta' ? (APP_MAINNET_READ_ONLY ? 'Mainnet · read only' : 'Mainnet') : 'Devnet · test SOL');
  network.title = EXPLORE_CLUSTER === 'devnet' ? 'Solana Devnet uses test SOL with no monetary value.' : APP_MAINNET_READ_ONLY ? 'Solana Mainnet preview: transactions are disabled.' : 'Solana Mainnet: transactions use real SOL.'; network.setAttribute('aria-label', network.title); $('.top-actions')?.prepend(network);
  const sidebar = $('#sidebar');
  sidebar?.addEventListener('click', event => {
    if (event.target.closest('a')) $('#close-menu')?.click();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') { const more = $('.nav-more'); if (more?.open) { more.open = false; $('summary', more).focus(); } }
  });
  const preference = node('label', 'workspace-preference', 'Start page');
  const select = node('select'); select.setAttribute('aria-label', 'Preferred start page');
  select.innerHTML = '<option value="overview">Home</option><option value="explore">Explore</option>';
  try { select.value = localStorage.getItem('funded.start-page') || 'overview'; } catch {}
  select.addEventListener('change', () => { try { localStorage.setItem('funded.start-page', select.value); } catch {} });
  preference.append(select); $('#profile')?.append(preference);
  if (!location.hash && location.pathname === '/' && select.value === 'explore') location.hash = '#explore';
}
