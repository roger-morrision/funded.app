// Top 100 had 15 columns and scrolled sideways even at 1440px. Show the essential
// columns by default and let people add the rest from a "Columns" menu. Hiding is
// done with one generated stylesheet keyed by header position, so table rendering
// code is untouched. The choice is remembered per browser.
const ESSENTIAL = ['Rank', 'Token', 'Current MC', '24h change', '24h volume', 'Holders Δ · 24h', 'Stage', 'Action'];
const STORAGE_KEY = 'richpad.top100.columns';

const readSaved = view => { try { return JSON.parse(view.localStorage.getItem(STORAGE_KEY) || 'null'); } catch { return null; } };
const save = (view, labels) => { try { view.localStorage.setItem(STORAGE_KEY, JSON.stringify(labels)); } catch { /* storage unavailable */ } };

export function mountTop100Columns(document = globalThis.document) {
  const table = document.querySelector('#top100 table.top100-table');
  const headers = table ? [...table.querySelectorAll('thead th')] : [];
  if (!headers.length || document.getElementById('top100-columns')) return Boolean(headers.length);
  const view = document.defaultView;
  const labels = headers.map(th => th.textContent.trim());
  let visible = new Set(readSaved(view) || labels.filter(label => ESSENTIAL.includes(label)));
  // Rank, Token and Action always stay.
  for (const label of ['Rank', 'Token', 'Action']) visible.add(label);

  const style = document.createElement('style');
  style.id = 'top100-columns-style';
  document.head.append(style);
  const apply = () => {
    style.textContent = labels.map((label, index) => visible.has(label) ? ''
      : `#top100 table.top100-table :is(th, td):nth-child(${index + 1}) { display: none; }`).join('\n');
  };

  const menu = document.createElement('details');
  menu.id = 'top100-columns';
  menu.className = 'top100-columns';
  const summary = document.createElement('summary');
  summary.textContent = 'Columns';
  const list = document.createElement('div');
  list.className = 'top100-columns-list';
  for (const label of labels) {
    if (['Rank', 'Token', 'Action'].includes(label)) continue;
    const option = document.createElement('label');
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = visible.has(label);
    box.addEventListener('change', () => {
      if (box.checked) visible.add(label); else visible.delete(label);
      save(view, [...visible]);
      apply();
    });
    option.append(box, document.createTextNode(` ${label}`));
    list.append(option);
  }
  const reset = document.createElement('button');
  reset.type = 'button';
  reset.textContent = 'Reset to default';
  reset.addEventListener('click', () => {
    visible = new Set(labels.filter(label => ESSENTIAL.includes(label)));
    list.querySelectorAll('input').forEach((box, index) => { box.checked = visible.has(box.parentElement.textContent.trim()); });
    save(view, [...visible]);
    apply();
  });
  list.append(reset);
  menu.append(summary, list);
  const scroll = table.closest('.top100-table-scroll') || table;
  scroll.before(menu);
  apply();
  return true;
}

export function mountTop100ColumnsWhenReady(document = globalThis.document) {
  if (mountTop100Columns(document)) return;
  const observer = new MutationObserver(() => { if (mountTop100Columns(document)) observer.disconnect(); });
  observer.observe(document.body, { childList: true, subtree: true });
}
