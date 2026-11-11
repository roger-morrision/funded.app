// Honor board: ranks 1–3 stand on a gold/silver/bronze podium, the rest follow as a ranked list.
const MEDALS = { 1:'Gold', 2:'Silver', 3:'Bronze' };
const SVG_NS = 'http://www.w3.org/2000/svg';
const short = wallet => `${wallet.slice(0, 5)}…${wallet.slice(-5)}`;
// Stable hue per wallet so the same winner keeps the same avatar everywhere.
const hue = wallet => [...wallet].reduce((sum, ch) => (sum * 31 + ch.charCodeAt(0)) % 360, 7);

function icon(document, kind) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('focusable', 'false');
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', kind === 'crown'
    ? 'M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5L3 8z'
    : 'M7 3h10v3a5 5 0 0 1-10 0V3zm-3 1h3v2a3 3 0 0 1-3-2zm13 0h3a3 3 0 0 1-3 2V4zM11 12h2v4h3v3H8v-3h3v-4z');
  svg.append(path); return svg;
}

/**
 * @param {Document} document
 * @param {{key:string,title:string,metric:string,rows:Array<{rank:number,wallet:string,amount:string,note?:string}>|null,emptyText:string}} options
 */
export function renderBonusPodium(document, { key, title, metric, rows, emptyText }) {
  const node = (tag, className, text) => {
    const el = document.createElement(tag); if (className) el.className = className; if (text != null) el.textContent = text; return el;
  };
  const card = node('section', 'bonus-honor'); card.dataset.bonusCategory = key;
  const head = node('header', 'bonus-honor-head'), mark = node('span', 'bonus-honor-icon');
  mark.append(icon(document, 'trophy'));
  const heading = node('div'); heading.append(node('h3', null, title), node('p', null, metric));
  head.append(mark, heading); card.append(head);
  // Missing or empty rankings still show the podium; each open step reads "No candidate".
  if (!Array.isArray(rows)) rows = [];

  const podium = node('ol', 'bonus-podium'); podium.setAttribute('aria-label', `${title} top 3`);
  for (const place of [1, 2, 3]) {
    const row = rows.find(item => item.rank === place);
    const step = node('li', 'bonus-podium-step'); step.dataset.place = String(place);
    const avatar = node('span', 'bonus-podium-avatar');
    if (place === 1) { const crown = node('span', 'bonus-podium-crown'); crown.append(icon(document, 'crown')); step.append(crown); }
    const medal = node('span', 'bonus-podium-medal', String(place)); medal.title = `${MEDALS[place]} medal`;
    if (row) {
      step.dataset.bonusPlace = 'winner';
      avatar.style.setProperty('--avatar-hue', String(hue(row.wallet)));
      avatar.textContent = row.wallet.slice(0, 2);
      const link = node('a', 'bonus-podium-wallet', short(row.wallet));
      link.href = `/wallet/${encodeURIComponent(row.wallet)}`; link.title = row.wallet;
      link.setAttribute('aria-label', `${MEDALS[place]}, rank ${place}: ${row.wallet}`);
      step.append(avatar, medal, link, node('strong', 'bonus-podium-amount', row.amount));
      if (row.note) step.append(node('small', 'bonus-podium-note', row.note));
    } else {
      step.dataset.bonusPlace = 'open'; step.classList.add('is-open');
      avatar.textContent = '?';
      step.append(avatar, medal, node('span', 'bonus-podium-wallet', 'No candidate'), node('strong', 'bonus-podium-amount', '—'));
    }
    step.append(node('span', 'bonus-podium-block', MEDALS[place]));
    podium.append(step);
  }
  card.append(podium);

  const rest = rows.filter(item => item.rank > 3).sort((a, b) => a.rank - b.rank);
  if (rest.length) {
    const list = node('ol', 'bonus-honor-list'); list.setAttribute('aria-label', `${title} ranks 4 and below`);
    for (const row of rest) {
      const item = node('li'); item.dataset.bonusPlace = 'outside';
      const link = node('a', null, short(row.wallet)); link.href = `/wallet/${encodeURIComponent(row.wallet)}`; link.title = row.wallet;
      const who = node('span', 'bonus-honor-who'); who.append(link); if (row.note) who.append(node('small', null, row.note));
      item.append(node('span', 'bonus-honor-rank', `#${row.rank}`), who, node('span', 'bonus-honor-amount', row.amount));
      list.append(item);
    }
    card.append(list);
  }
  return card;
}

// Podium rise plays once per page; the 30-second refresh re-renders without replaying it.
export function settlePodiumGrid(root, view = globalThis) {
  if (root && !root.dataset.podiumSettled) view.setTimeout(() => { root.dataset.podiumSettled = 'true'; }, 1200);
}
