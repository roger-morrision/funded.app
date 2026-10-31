export const address = value => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(String(value || ''));
export const signature = value => /^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(String(value || ''));
export const array = value => Array.isArray(value) ? value : [];
export function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text != null) node.textContent = text;
  if (className) node.className = className;
  return node;
}
export function link(text, href, external = false) {
  const node = el('a', text); node.href = href;
  if (external) { node.target = '_blank'; node.rel = 'noopener noreferrer'; }
  return node;
}
export function button(text, action) {
  const node = el('button', text); node.type = 'button'; node.addEventListener('click', action); return node;
}
export function reportContextLink(text='Report this context') {
  const node=link(text,'#profile');node.dataset.reportContext=location.href;return node;
}
export function utc(time) {
  if (time == null || time === '') return 'Time unavailable';
  const date = new Date(typeof time === 'number' && time < 1e12 ? time * 1000 : time);
  return Number.isFinite(date.getTime()) ? date.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC') : 'Time unavailable';
}
export function panel(id, title, text) {
  const root = el('section', null, 'flow-panel'); root.id = id;
  const heading = el('h2', title); heading.id = `${id}-title`; root.setAttribute('aria-labelledby', heading.id);
  root.append(heading); if (text) root.append(el('p', text)); return root;
}
export function portfolioTools(parent) {
  let tools=parent.querySelector(':scope > .portfolio-tools');
  if(!tools){tools=el('div',null,'portfolio-tools');tools.setAttribute('role','group');tools.setAttribute('aria-label','Saved drafts and transaction recovery');parent.append(tools);}
  return tools;
}
