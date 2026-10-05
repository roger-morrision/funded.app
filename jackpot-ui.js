import { apiRequest } from './client.js';
import './jackpot-ui.css';

const host = document.querySelector('#payments');
if (host) {
  const homeHero = document.querySelector('.hero-section');
  const home = document.createElement('section');
  home.className = 'home-jackpot-spotlight';
  home.setAttribute('aria-labelledby', 'home-jackpot-heading');
  home.innerHTML = `<div class="home-jackpot-heading"><div><p class="eyebrow">Solana Devnet · prize preview</p><h2 id="home-jackpot-heading">Creator and trader jackpots</h2><p data-home-jackpot-status>Checking verified funding. Draws and payouts are currently inactive.</p></div><a href="#payments">View jackpots in Rewards →</a></div><div class="home-jackpot-grid"><article><span>Creator jackpot</span><strong data-home-jackpot-amount="creator">—</strong><small>1% of funded.vip’s collected creator-fee share</small></article><article><span>Trader jackpot</span><strong data-home-jackpot-amount="trader">—</strong><small>5% of funded.vip’s collected trading fees</small></article></div><p class="home-jackpot-disclosure" data-home-jackpot-note>Only verified funded amounts appear here. The preview countdown in Rewards is an accounting window, not a scheduled draw.</p>`;
  homeHero?.after(home);
  const homeAmounts = Object.fromEntries(['creator', 'trader'].map(kind => [kind,
    { element:home.querySelector(`[data-home-jackpot-amount="${kind}"]`),
      currentLamports:0n, targetLamports:0n, animation:null }]));
  const rewardsSummary = document.createElement('section');
  rewardsSummary.className = 'jackpot-overview-spotlight';
  rewardsSummary.setAttribute('aria-label', 'Jackpot funding preview');
  rewardsSummary.innerHTML = `<div><strong>Jackpot preview · Devnet</strong><p data-jackpot-overview-status>Checking verified funding.</p></div><div class="jackpot-overview-values"><span>Creator <b data-jackpot-overview-amount="creator">—</b></span><span>Trader <b data-jackpot-overview-amount="trader">—</b></span></div><button type="button">Rules and receipts →</button>`;
  document.querySelector('#rewards-overview > .workspace-page-header')?.after(rewardsSummary);
  const disclosure = document.createElement('details');
  disclosure.className = 'jackpot-disclosure';
  disclosure.open = true;
  const disclosureSummary = document.createElement('summary');
  disclosureSummary.textContent = 'Experimental jackpots · inactive';
  const section = document.createElement('section');
  section.className = 'jackpot-preview';
  section.setAttribute('aria-labelledby', 'jackpot-preview-heading');
  section.innerHTML = `<div class="jackpot-preview-head"><div><p class="eyebrow">Devnet prototype</p><h3 id="jackpot-preview-heading">24-hour jackpots</h3><p>Draws and automatic SOL payouts are inactive until fee funding, verified entries, and eligibility are approved.</p></div><span class="jackpot-preview-badge">Payouts inactive</span></div><div class="jackpot-preview-grid"></div><p class="jackpot-preview-note">The countdown marks the UTC accounting window, not a scheduled draw. No jackpot has been funded or paid.</p><details class="jackpot-proof"><summary>Rules, funding, and draw proof</summary><div class="jackpot-proof-body"><p><strong>Planned creator pool:</strong> 1% of funded.vip’s share of collected Pump creator fees in each UTC day. A unique finalized launch would count once.</p><p><strong>Planned trader pool:</strong> 5% of funded.vip’s collected app trading fees in each UTC day. A unique finalized fee-paying trade would count once.</p><p data-jackpot-rules-state>These are design formulas, not an active entry offer. No odds, eligibility rules, or payout date are published. Verified funding and entries, independent winner selection, and a finalized wallet payout are required before a round can be shown as paid.</p><ul data-jackpot-blockers></ul><p class="jackpot-proof-status" data-jackpot-proof-status>Checking round evidence…</p></div></details><div class="jackpot-alerts" hidden><label><input type="checkbox" data-jackpot-alert-toggle> Show new finalized draw results on this device</label><p data-jackpot-alert-status>Alerts are off.</p><ul data-jackpot-alert-list></ul><small>In-app notices appear while this page is open. No wallet connection or background notification is required.</small></div>`;
  disclosure.append(disclosureSummary, section);
  host.prepend(disclosure);
  rewardsSummary.querySelector('button')?.addEventListener('click', () => {
    disclosure.open = true;
    disclosure.scrollIntoView({ behavior:'smooth', block:'start' });
    disclosureSummary.focus();
  });
  const contextLinks = [];
  for (const [kind, anchor, label] of [
    ['creator', document.querySelector('#launch-form'), 'Review verified creator jackpot rules'],
    ['trader', document.querySelector('#trade-panel .panel-heading'), 'Review verified trader jackpot rules'],
  ]) {
    if (!anchor) continue;
    const note = document.createElement('p');
    note.className = 'jackpot-context-link';
    note.hidden = true;
    const link = document.createElement('a');
    link.href = '#payments';
    link.textContent = `${label} →`;
    link.addEventListener('click', () => document.querySelector('#rewards-overview-tab')?.click());
    note.append(link);
    if (kind === 'creator') anchor.prepend(note);
    else anchor.after(note);
    contextLinks.push({ kind, note });
  }
  home.querySelector('a')?.addEventListener('click', () => {
    document.querySelector('#rewards-overview-tab')?.click();
  });

  const grid = section.querySelector('.jackpot-preview-grid');
  const cards = new Map();
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const addressPattern = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
  const signaturePattern = /^[1-9A-HJ-NP-Za-km-z]{64,88}$/;
  const alertKey = 'funded.vip.jackpot-alerts.v1';
  const alerts = section.querySelector('.jackpot-alerts');
  const alertToggle = section.querySelector('[data-jackpot-alert-toggle]');
  const alertStatus = section.querySelector('[data-jackpot-alert-status]');
  const alertList = section.querySelector('[data-jackpot-alert-list]');
  const readAlerts = () => {
    try {
      const stored = JSON.parse(localStorage.getItem(alertKey) || '{}');
      return { enabled:stored.enabled === true,
        seen:Array.isArray(stored.seen) ? stored.seen.filter(value =>
          signaturePattern.test(String(value))).slice(-100) : [] };
    } catch { return { enabled:false, seen:[] }; }
  };
  let alertPrefs = readAlerts();
  let latestReceipts = [];
  alertToggle.checked = alertPrefs.enabled;
  if (alertPrefs.enabled) alertStatus.textContent = 'On · new finalized results will appear here while the page is open.';
  alertToggle.addEventListener('change', () => {
    alertPrefs.enabled = alertToggle.checked;
    if (alertPrefs.enabled) alertPrefs.seen = latestReceipts.map(row => row.signature).slice(-100);
    try { localStorage.setItem(alertKey, JSON.stringify(alertPrefs)); }
    catch {
      alertPrefs.enabled = false;
      alertToggle.checked = false;
      alertStatus.textContent = 'Device storage is unavailable; alerts could not be enabled.';
      return;
    }
    alertStatus.textContent = alertPrefs.enabled
      ? 'On · new finalized results will appear here while the page is open.'
      : 'Alerts are off.';
    if (!alertPrefs.enabled) alertList.replaceChildren();
  });
  let clockOffsetMs = 0;
  let loading = false;
  let loaded = false;
  let statusNote;

  const validLamports = value => /^(?:0|[1-9]\d*)$/.test(String(value));
  const activeRound = round => round?.payoutEnabled === true
    && round?.fundingVerified === true
    && round?.rulesPublished === true
    && round?.eligibilityApproved === true
    && validLamports(round?.fundedLamports)
    && BigInt(round.fundedLamports) > 0n
    && Number.isSafeInteger(round?.entries)
    && round.entries > 0;
  const solAmount = value => {
    if (!validLamports(value)) return 'unavailable';
    const lamports = BigInt(value);
    return `${lamports / 1_000_000_000n}.${String(lamports % 1_000_000_000n).padStart(9, '0').replace(/0+$/, '') || '0'} SOL`;
  };

  function updateHomeAmount(kind, round) {
    const state = homeAmounts[kind];
    if (!state?.element) return;
    if (state.animation != null) cancelAnimationFrame(state.animation);
    state.animation = null;
    if (!validLamports(round.fundedLamports)
      || BigInt(round.fundedLamports) > 0n && round.fundingVerified !== true) {
      state.element.textContent = 'Funding proof unavailable';
      state.currentLamports = 0n;
      state.targetLamports = 0n;
      return;
    }
    const target = BigInt(round.fundedLamports);
    const start = state.currentLamports;
    state.targetLamports = target;
    if (target <= start || reducedMotion.matches || document.visibilityState !== 'visible'
      || !document.body.classList.contains('page-route-overview')) {
      state.currentLamports = target;
      state.element.textContent = solAmount(target);
      return;
    }
    const startedAt = performance.now();
    const frame = now => {
      const progress = Math.min(1, (now - startedAt) / 1200);
      const step = BigInt(Math.floor((1 - (1 - progress) ** 3) * 1000));
      state.currentLamports = progress >= 1 ? target : start + (target - start) * step / 1000n;
      state.element.textContent = solAmount(state.currentLamports);
      state.animation = progress < 1 ? requestAnimationFrame(frame) : null;
    };
    state.animation = requestAnimationFrame(frame);
  }

  function updateProof(data) {
    const blockers = section.querySelector('[data-jackpot-blockers]');
    blockers.replaceChildren();
    for (const reason of Array.isArray(data.blockers) ? data.blockers : []) {
      if (typeof reason !== 'string' || !reason.trim()) continue;
      const item = document.createElement('li');
      item.textContent = reason;
      blockers.append(item);
    }
    section.querySelector('[data-jackpot-proof-status]').textContent =
      `Creator: ${data.creator.fundingVerified ? 'funding verified' : 'funding unverified'}, `
      + `${Number.isSafeInteger(data.creator.entries) ? data.creator.entries : 'no indexed'} entries. `
      + `Trader: ${data.trader.fundingVerified ? 'funding verified' : 'funding unverified'}, `
      + `${Number.isSafeInteger(data.trader.entries) ? data.trader.entries : 'no indexed'} entries. `
      + 'Only finalized payout receipts appear in winner history.';
  }

  function updateAlerts(data, enabled) {
    latestReceipts = ['creator', 'trader'].flatMap(kind =>
      (Array.isArray(data[kind].history) ? data[kind].history : [])
        .filter(row => row?.status === 'paid' && row?.cluster === 'devnet'
          && signaturePattern.test(String(row.signature || ''))
          && addressPattern.test(String(row.winner || ''))
          && validLamports(row.amountLamports) && BigInt(row.amountLamports) > 0n)
        .map(row => ({ ...row, kind })));
    alerts.hidden = !enabled && latestReceipts.length === 0;
    if (!alertPrefs.enabled) return;
    if (!loaded && alertPrefs.seen.length === 0) {
      alertPrefs.seen = latestReceipts.map(row => row.signature).slice(-100);
      try { localStorage.setItem(alertKey, JSON.stringify(alertPrefs)); } catch {}
      return;
    }
    const seen = new Set(alertPrefs.seen);
    const fresh = latestReceipts.filter(row => !seen.has(row.signature));
    for (const row of fresh) {
      const item = document.createElement('li');
      item.textContent = `${row.kind === 'creator' ? 'Creator' : 'Trader'} result · ${row.winner.slice(0, 4)}…${row.winner.slice(-4)} · ${solAmount(row.amountLamports)} · `;
      const receipt = document.createElement('a');
      receipt.href = `https://explorer.solana.com/tx/${encodeURIComponent(row.signature)}?cluster=devnet`;
      receipt.target = '_blank';
      receipt.rel = 'noopener noreferrer';
      receipt.textContent = 'Receipt';
      item.append(receipt);
      alertList.prepend(item);
    }
    if (fresh.length) {
      alertStatus.textContent = `${fresh.length} new finalized result${fresh.length === 1 ? '' : 's'}.`;
      alertPrefs.seen = [...new Set([...alertPrefs.seen, ...fresh.map(row => row.signature)])].slice(-100);
      try { localStorage.setItem(alertKey, JSON.stringify(alertPrefs)); }
      catch { alertStatus.textContent = 'Result shown, but this device could not save alert history.'; }
    }
  }

  function makeCard(kind, title, rate, rule) {
    const card = document.createElement('article');
    card.className = 'jackpot-preview-card';
    const heading = document.createElement('h4');
    heading.textContent = title;
    const terms = document.createElement('p');
    terms.textContent = `${rate}. ${rule}.`;
    const amountLabel = document.createElement('p');
    amountLabel.className = 'jackpot-amount-label';
    amountLabel.textContent = 'Verified funded prize';
    const amount = document.createElement('strong');
    amount.className = 'jackpot-amount';
    amount.textContent = '—';
    const entries = document.createElement('p');
    const countdown = document.createElement('strong');
    countdown.className = 'jackpot-preview-countdown';
    countdown.textContent = 'UTC window timing unavailable';
    const drawNote = document.createElement('p');
    drawNote.className = 'jackpot-draw-note';
    drawNote.textContent = 'No draw scheduled';
    const history = document.createElement('p');
    const historyList = document.createElement('ul');
    historyList.className = 'jackpot-history';
    historyList.hidden = true;
    const reveal = document.createElement('div');
    reveal.className = 'jackpot-reveal';
    reveal.hidden = true;
    reveal.innerHTML = `<div class="jackpot-reveal-stage" aria-hidden="true"><span class="jackpot-reveal-wheel"></span><span class="jackpot-confetti"></span><span class="jackpot-confetti"></span><span class="jackpot-confetti"></span><span class="jackpot-confetti"></span><span class="jackpot-confetti"></span><span class="jackpot-confetti"></span></div><div class="jackpot-reveal-copy"><p class="jackpot-reveal-kicker">Finalized Devnet result replay</p><strong class="jackpot-reveal-title" aria-live="polite"></strong><p class="jackpot-reveal-wallet"></p><a class="jackpot-reveal-receipt" target="_blank" rel="noopener noreferrer">View payout receipt</a><button class="jackpot-replay" type="button">Replay reveal</button></div>`;
    card.append(heading, terms, amountLabel, amount, entries, countdown, drawNote, reveal, history, historyList);
    grid.append(card);
    cards.set(kind, { card, amount, entries, countdown, drawNote, history,
      historyList, reveal, roundId:null, currentLamports:0n, windowEnd:null,
      payoutEnabled:false, animation:null, inView:false, pendingLamports:null,
      targetLamports:0n, receipt:null, revealTimer:null,
      revealPending:false });
    reveal.querySelector('.jackpot-replay').addEventListener('click', () => {
      const state = cards.get(kind);
      if (state.receipt) startReveal(state);
    });
  }

  makeCard('creator', 'Creator jackpot', '1% of funded.vip’s share of collected creator fees',
    'One entry per verified launched coin');
  makeCard('trader', 'Trader jackpot', '5% of funded.vip trading fees',
    'One entry per verified fee-paying trade');
  const amountObserver = 'IntersectionObserver' in window
    ? new IntersectionObserver(entries => {
      for (const entry of entries) {
        const state = [...cards.values()].find(item => item.card === entry.target);
        if (!state) continue;
        state.inView = entry.isIntersecting;
        if (!state.inView && state.animation != null) {
          cancelAnimationFrame(state.animation);
          state.animation = null;
          state.pendingLamports = state.targetLamports;
        }
        if (state.inView && state.pendingLamports != null) {
          const target = state.pendingLamports;
          state.pendingLamports = null;
          animateTo(state, target, state.currentLamports);
        }
        if (state.inView && state.revealPending) startReveal(state);
      }
    }, { threshold:0.05 }) : null;
  for (const state of cards.values()) {
    if (amountObserver) amountObserver.observe(state.card);
    else state.inView = true;
  }

  function showAmount(state, value) {
    state.currentLamports = value;
    state.amount.textContent = solAmount(value);
  }

  function animateTo(state, target, start) {
    if (reducedMotion.matches || target <= start) {
      showAmount(state, target);
      return;
    }
    state.amount.classList.remove('jackpot-amount-updated');
    void state.amount.offsetWidth;
    state.amount.classList.add('jackpot-amount-updated');
    const startedAt = performance.now();
    const frame = now => {
      const progress = Math.min(1, (now - startedAt) / 1200);
      const step = BigInt(Math.floor((1 - (1 - progress) ** 3) * 1000));
      showAmount(state, progress >= 1 ? target : start + (target - start) * step / 1000n);
      state.animation = progress < 1 ? requestAnimationFrame(frame) : null;
    };
    state.animation = requestAnimationFrame(frame);
  }

  function updateAmount(state, round) {
    if (state.animation != null) cancelAnimationFrame(state.animation);
    state.animation = null;
    if (!validLamports(round.fundedLamports)
      || BigInt(round.fundedLamports) > 0n && round.fundingVerified !== true) {
      state.amount.textContent = 'Funding proof unavailable';
      state.currentLamports = 0n;
      state.pendingLamports = null;
      state.targetLamports = 0n;
      return;
    }
    const target = BigInt(round.fundedLamports);
    state.targetLamports = target;
    const start = state.roundId === round.id ? state.currentLamports : 0n;
    if (target <= start) {
      showAmount(state, target);
      state.pendingLamports = null;
      return;
    }
    if (!state.inView || document.visibilityState !== 'visible') {
      showAmount(state, start);
      state.pendingLamports = target;
      return;
    }
    state.pendingLamports = null;
    animateTo(state, target, start);
  }

  function updateHistory(state, round) {
    const receipts = Array.isArray(round.history) ? round.history.filter(receipt =>
      receipt?.status === 'paid' && receipt?.cluster === 'devnet'
      && signaturePattern.test(String(receipt.signature || ''))
      && addressPattern.test(String(receipt.winner || ''))
      && validLamports(receipt.amountLamports)
      && BigInt(receipt.amountLamports) > 0n) : [];
    state.history.textContent = receipts.length
      ? 'Finalized winners and payout receipts'
      : 'Winner history: none · Payout receipts: none';
    state.historyList.replaceChildren();
    state.historyList.hidden = receipts.length === 0;
    for (const receipt of receipts) {
      const item = document.createElement('li');
      item.textContent = `${receipt.winner} · ${solAmount(receipt.amountLamports)} · `;
      const link = document.createElement('a');
      link.href = `https://explorer.solana.com/tx/${encodeURIComponent(receipt.signature)}?cluster=devnet`;
      link.textContent = 'Finalized receipt';
      link.rel = 'noopener noreferrer';
      link.target = '_blank';
      item.append(link);
      state.historyList.append(item);
    }
    const latest = receipts.reduce((winner, receipt) =>
      !winner || Number(receipt.paidAt || 0) >= Number(winner.paidAt || 0)
        ? receipt : winner, null);
    if (!latest) {
      clearTimeout(state.revealTimer);
      state.reveal.hidden = true;
      state.receipt = null;
      state.revealPending = false;
    } else if (state.receipt?.signature !== latest.signature) {
      clearTimeout(state.revealTimer);
      state.receipt = latest;
      state.revealPending = true;
      state.reveal.hidden = false;
      state.reveal.classList.remove('is-winner', 'is-drawing');
      state.reveal.querySelector('.jackpot-reveal-title').textContent = 'Finalized result ready';
      state.reveal.querySelector('.jackpot-reveal-wallet').textContent = '';
      state.reveal.querySelector('.jackpot-reveal-receipt').hidden = true;
      state.reveal.querySelector('.jackpot-replay').hidden = true;
      if (state.inView && document.visibilityState === 'visible') startReveal(state);
    }
  }

  function startReveal(state) {
    if (!state.receipt || document.visibilityState !== 'visible') return;
    clearTimeout(state.revealTimer);
    state.revealPending = false;
    const title = state.reveal.querySelector('.jackpot-reveal-title');
    const wallet = state.reveal.querySelector('.jackpot-reveal-wallet');
    const link = state.reveal.querySelector('.jackpot-reveal-receipt');
    const replay = state.reveal.querySelector('.jackpot-replay');
    const receipt = state.receipt;
    state.reveal.hidden = false;
    state.reveal.classList.remove('is-winner', 'is-drawing');
    link.href = `https://explorer.solana.com/tx/${encodeURIComponent(receipt.signature)}?cluster=devnet`;
    if (reducedMotion.matches) {
      showWinner(state, receipt);
      return;
    }
    title.textContent = 'Revealing the verified draw…';
    wallet.textContent = '';
    link.hidden = true;
    replay.hidden = true;
    void state.reveal.offsetWidth;
    state.reveal.classList.add('is-drawing');
    state.revealTimer = setTimeout(() => {
      state.revealTimer = null;
      if (state.receipt?.signature === receipt.signature) showWinner(state, receipt);
    }, 1800);
  }

  function showWinner(state, receipt) {
    const shortWallet = `${receipt.winner.slice(0, 4)}…${receipt.winner.slice(-4)}`;
    state.reveal.classList.remove('is-drawing');
    state.reveal.classList.add('is-winner');
    state.reveal.querySelector('.jackpot-reveal-title').textContent = 'Congratulations, winner!';
    const wallet = state.reveal.querySelector('.jackpot-reveal-wallet');
    wallet.textContent = shortWallet;
    wallet.title = receipt.winner;
    state.reveal.querySelector('.jackpot-reveal-receipt').hidden = false;
    state.reveal.querySelector('.jackpot-replay').hidden = false;
  }

  function updateCard(state, round) {
    updateAmount(state, round);
    state.roundId = round.id;
    state.windowEnd = Number.isSafeInteger(round.windowEnd) ? round.windowEnd : null;
    state.payoutEnabled = activeRound(round);
    state.entries.textContent = !state.payoutEnabled
      ? 'Entries not open · preview only'
      : Number.isSafeInteger(round.entries) && round.entries >= 0
        ? `${round.entries} verified entries` : 'Entry index unavailable';
    state.drawNote.textContent = state.payoutEnabled
      ? 'Draw follows verified round closure; payout time is not guaranteed.'
      : 'No draw scheduled · preview window only';
    updateHistory(state, round);
  }

  function renderCountdowns() {
    const now = Math.floor((Date.now() + clockOffsetMs) / 1000);
    for (const state of cards.values()) {
      if (state.windowEnd == null) {
        state.countdown.textContent = 'UTC window timing unavailable';
        continue;
      }
      const left = Math.max(0, state.windowEnd - now);
      const hours = String(Math.floor(left / 3600)).padStart(2, '0');
      const minutes = String(Math.floor(left % 3600 / 60)).padStart(2, '0');
      const seconds = String(left % 60).padStart(2, '0');
      state.countdown.textContent = left === 0
        ? 'UTC window closed · awaiting status update'
        : `${state.payoutEnabled ? 'Jackpot round' : 'UTC preview window'} closes in ${hours}:${minutes}:${seconds}`;
    }
  }

  async function loadStatus() {
    if (loading) return;
    loading = true;
    try {
      const response = await apiRequest('/api/jackpots/status');
      if (!response.available || response.data?.cluster !== 'devnet'
        || !response.data.creator || !response.data.trader)
        throw new Error('Devnet jackpot status unavailable.');
      const data = response.data;
      const serverTime = Date.parse(data.generatedAt);
      if (Number.isFinite(serverTime)) clockOffsetMs = serverTime - Date.now();
      const enabled = activeRound(data.creator) || activeRound(data.trader);
      for (const { kind, note } of contextLinks) note.hidden = !activeRound(data[kind]);
      disclosureSummary.textContent = enabled ? 'Devnet jackpot rounds' : 'Experimental jackpots · inactive';
      section.querySelector('.jackpot-preview-badge').textContent = enabled ? 'Devnet only' : 'Payouts inactive';
      section.querySelector('.jackpot-preview-head p:not(.eyebrow)').textContent = enabled
        ? 'Verified Devnet rounds and finalized payout receipts.'
        : 'Draws and automatic SOL payouts are inactive until fee funding, verified entries, and eligibility are approved.';
      section.querySelector('.jackpot-preview-note').textContent = enabled
        ? 'Only finalized Devnet payout transactions appear in winner history.'
        : 'The countdown marks the UTC accounting window, not a scheduled draw. No jackpot has been funded or paid.';
      updateCard(cards.get('creator'), data.creator);
      updateCard(cards.get('trader'), data.trader);
      updateHomeAmount('creator', data.creator);
      updateHomeAmount('trader', data.trader);
      for (const kind of ['creator', 'trader']) {
        const round = data[kind];
        rewardsSummary.querySelector(`[data-jackpot-overview-amount="${kind}"]`).textContent =
          validLamports(round.fundedLamports)
            && (BigInt(round.fundedLamports) === 0n || round.fundingVerified === true)
            ? solAmount(round.fundedLamports) : 'Proof unavailable';
      }
      rewardsSummary.querySelector('[data-jackpot-overview-status]').textContent = enabled
        ? 'Verified Devnet round status · review rules and receipts.'
        : 'Inactive preview · entries and payouts are not open.';
      home.querySelector('[data-home-jackpot-status]').textContent = enabled
        ? 'Verified Devnet funding and round status. Review rules and payout proof before taking part.'
        : 'Inactive Devnet preview · no entries or automatic draws are open.';
      home.querySelector('[data-home-jackpot-note]').textContent = enabled
        ? 'Only verified funded amounts appear here. Round closure does not guarantee an immediate payout.'
        : 'Only verified funded amounts appear here. The preview countdown in Rewards is an accounting window, not a scheduled draw.';
      section.querySelector('[data-jackpot-rules-state]').textContent = enabled
        ? 'A funded Devnet round still requires published eligibility and odds, independent winner selection, and a finalized payout receipt. Check the evidence below before taking part.'
        : 'These are design formulas, not an active entry offer. No odds, eligibility rules, or payout date are published. Verified funding and entries, independent winner selection, and a finalized wallet payout are required before a round can be shown as paid.';
      updateProof(data);
      updateAlerts(data, enabled);
      renderCountdowns();
      statusNote?.remove();
      statusNote = null;
      loaded = true;
    } catch {
      if (!statusNote) {
        statusNote = document.createElement('p');
        statusNote.className = 'jackpot-status-error';
        grid.after(statusNote);
      }
      statusNote.textContent = loaded
        ? 'Jackpot status is unavailable; displayed amounts may be stale.'
        : 'Jackpot amounts and countdowns are unavailable.';
      home.querySelector('[data-home-jackpot-status]').textContent = loaded
        ? 'Status unavailable · displayed amounts may be stale.'
        : 'Jackpot status and verified funding are unavailable.';
      rewardsSummary.querySelector('[data-jackpot-overview-status]').textContent = loaded
        ? 'Status unavailable · amounts may be stale.'
        : 'Verified jackpot funding is unavailable.';
      if (!loaded) for (const state of Object.values(homeAmounts)) {
        if (state.element) state.element.textContent = 'Unavailable';
      }
      if (!loaded) for (const kind of ['creator', 'trader']) {
        rewardsSummary.querySelector(`[data-jackpot-overview-amount="${kind}"]`).textContent = 'Unavailable';
      }
    } finally {
      loading = false;
    }
  }

  void loadStatus();
  const countdownTimer = setInterval(renderCountdowns, 1000);
  const statusTimer = setInterval(() => {
    if (document.visibilityState === 'visible') void loadStatus();
  }, 30_000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      for (const state of cards.values()) {
        if (state.inView && state.revealPending) startReveal(state);
        if (state.inView && state.pendingLamports != null) {
          const target = state.pendingLamports;
          state.pendingLamports = null;
          animateTo(state, target, state.currentLamports);
        }
      }
      void loadStatus();
    }
  });
  window.addEventListener('pagehide', () => {
    clearInterval(countdownTimer);
    clearInterval(statusTimer);
    amountObserver?.disconnect();
    impressionObserver?.disconnect();
    for (const state of cards.values()) {
      if (state.animation != null) cancelAnimationFrame(state.animation);
      clearTimeout(state.revealTimer);
    }
    for (const state of Object.values(homeAmounts)) {
      if (state.animation != null) cancelAnimationFrame(state.animation);
    }
  }, { once:true });
}
