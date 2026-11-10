// "Your rank today": where the connected wallet stands in each Daily bonus category
// and how far it is from a prize place. Uses the public dashboard's top-5 standings.
// Wallets in the top 3 can download a podium image and post it on X.
import { el, sol, lamports, shortWallet, getJSON, nextUtcMidnight, countdown } from './format.js';

const CATEGORIES = { creators: ['Creators', 'settled creator fees'], referrals: ['Referrers', 'referred settled fees'], traders: ['Traders', 'trading volume'] };
const MEDALS = { 1: ['Gold', '#f6c445'], 2: ['Silver', '#d5dde8'], 3: ['Bronze', '#e0955a'] };

export function standing(rows, wallet) {
  if (!Array.isArray(rows)) return { state: 'unavailable' };
  const sorted = [...rows].sort((a, b) => a.rank - b.rank);
  const mine = sorted.find(row => row.wallet === wallet);
  const third = sorted.find(row => row.rank === 3);
  if (mine && mine.rank <= 3) return { state: 'winning', rank: mine.rank, score: lamports(mine.scoreLamports) };
  if (!third) return { state: 'open', rank: mine?.rank ?? null };
  const target = lamports(third.scoreLamports), own = lamports(mine?.scoreLamports) ?? 0n;
  if (target == null) return { state: 'unavailable' };
  return { state: 'chasing', rank: mine?.rank ?? null, gap: target - own + 1n };
}

export function podiumImage(document, { rank, category, wallet, amount }) {
  const canvas = document.createElement('canvas'); canvas.width = 1200; canvas.height = 630;
  const c = canvas.getContext('2d'); if (!c) return null;
  const [medal, color] = MEDALS[rank];
  const bg = c.createLinearGradient(0, 0, 1200, 630); bg.addColorStop(0, '#0b0d1a'); bg.addColorStop(1, '#1a1530');
  c.fillStyle = bg; c.fillRect(0, 0, 1200, 630);
  const glow = c.createRadialGradient(900, 120, 10, 900, 120, 520); glow.addColorStop(0, `${color}55`); glow.addColorStop(1, 'transparent');
  c.fillStyle = glow; c.fillRect(0, 0, 1200, 630);
  c.fillStyle = color; c.font = '700 30px system-ui, sans-serif'; c.fillText('RICHPAD.FUN · DAILY BONUS', 80, 110);
  c.fillStyle = '#f3f6fa'; c.font = '800 76px system-ui, sans-serif'; c.fillText(`${medal} · #${rank} ${category}`, 80, 230);
  c.fillStyle = '#a8b2bc'; c.font = '500 34px system-ui, sans-serif'; c.fillText(`Wallet ${shortWallet(wallet)}`, 80, 300);
  if (amount) { c.fillStyle = color; c.font = '700 44px ui-monospace, monospace'; c.fillText(amount, 80, 370); }
  // Podium blocks (2 · 1 · 3), the current place highlighted.
  const blocks = [[2, 760, 140], [1, 900, 220], [3, 1040, 100]];
  for (const [place, x, h] of blocks) {
    c.fillStyle = place === rank ? MEDALS[place][1] : '#2a3142';
    c.fillRect(x - 60, 560 - h, 120, h);
    c.fillStyle = place === rank ? '#1b1300' : '#a8b2bc'; c.font = '800 44px system-ui, sans-serif';
    c.fillText(String(place), x - 13, 560 - h + 56);
  }
  c.fillStyle = '#77869b'; c.font = '500 24px system-ui, sans-serif'; c.fillText('Provisional until the 00:00 UTC snapshot is verified.', 80, 590);
  return canvas;
}

function shareRow(document, details) {
  const row = el(document, 'div', 'bonus-share-row');
  const download = el(document, 'button', 'secondary-button', 'Download image'); download.type = 'button';
  download.addEventListener('click', () => {
    const canvas = podiumImage(document, details); if (!canvas) return;
    const link = document.createElement('a');
    link.download = `richpad-daily-bonus-${details.category.toLowerCase()}-${details.rank}.png`;
    link.href = canvas.toDataURL('image/png'); link.click();
  });
  const post = el(document, 'a', 'secondary-button', 'Post on X');
  const text = `I'm #${details.rank} in today's ${details.category} Daily bonus on richpad.fun 🏆`;
  post.href = `https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent('https://richpad.fun/#bonuses')}`;
  post.target = '_blank'; post.rel = 'noopener noreferrer';
  row.append(download, post);
  return row;
}

export function mountBonusRankCards(app, document = globalThis.document) {
  const hosts = [
    ['#bonuses .bonus-today', 'beforebegin'],
    ['#main-content > .home-launch-board', 'beforebegin'],
  ];
  const cards = [];
  for (const [selector, position] of hosts) {
    const host = document.querySelector(selector);
    if (!host || host.previousElementSibling?.classList.contains('bonus-rank-card')) continue;
    const card = el(document, 'section', 'bonus-rank-card');
    card.setAttribute('aria-label', 'Your Daily bonus rank today');
    card.hidden = true;
    host.insertAdjacentElement(position, card);
    cards.push(card);
  }
  if (!cards.length) return false;
  let data = null, fetchedAt = 0;

  function render() {
    const wallet = app.connectedWalletAddress || '';
    for (const card of cards) {
      card.hidden = !wallet || !data?.today;
      if (card.hidden) continue;
      const head = el(document, 'header');
      head.append(el(document, 'p', 'eyebrow', 'Your rank today'), el(document, 'span', 'bonus-rank-clock', `Snapshot in ${countdown(nextUtcMidnight())}`));
      const list = el(document, 'ul', 'bonus-rank-list');
      for (const [key, [title, metric]] of Object.entries(CATEGORIES)) {
        const s = standing(data.today[key], wallet);
        const item = el(document, 'li'); item.dataset.state = s.state;
        let line;
        if (s.state === 'winning') line = `You're #${s.rank} — in a prize place.`;
        else if (s.state === 'chasing') line = `${s.rank ? `You're #${s.rank}. ` : ''}${sol(s.gap)} more ${metric} reaches #3.`;
        else if (s.state === 'open') line = 'Top 3 has open places — any eligible activity can place you.';
        else line = 'Rankings unavailable right now.';
        item.append(el(document, 'strong', null, title), el(document, 'span', null, line));
        if (s.state === 'winning') {
          item.append(shareRow(document, { rank: s.rank, category: title, wallet, amount: s.score != null ? sol(s.score) : '' }));
          if (card === cards[0]) globalThis.dispatchEvent?.(new CustomEvent('richpad:bonus-prize', { detail: { category: title, rank: s.rank } }));
        }
        list.append(item);
      }
      card.replaceChildren(head, list);
    }
  }

  async function refresh(force = false) {
    if (!app.connectedWalletAddress) { render(); return; }
    if (!force && Date.now() - fetchedAt < 60_000) { render(); return; }
    fetchedAt = Date.now();
    data = await getJSON('/api/daily-bonus/dashboard?category=all&page=1');
    render();
  }
  void refresh(true);
  globalThis.addEventListener?.('funded:reward-identity-change', () => void refresh(true));
  globalThis.addEventListener?.('hashchange', () => void refresh());
  globalThis.setInterval?.(() => { if (!document.hidden) void refresh(); }, 60_000);
  return true;
}
