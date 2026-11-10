// Profile as a standard settings page: a section list on the left and grouped panels
// on the right. Existing nodes are moved (ids, listeners and state are kept); pieces
// that other modules append later are routed into their section when they appear.
const SECTIONS = [
  { id: 'wallet', title: 'Wallet', pieces: ['.profile-grid', ':scope > .flow-note', ':scope > .source-note'] },
  { id: 'preferences', title: 'Preferences', pieces: ['.workspace-preference', '#trade-preferences-details', '#notification-preferences-details'], open: true },
  { id: 'accounts', title: 'Linked accounts & activity', pieces: ['.workspace-shortcuts', ':scope > button'] },
  { id: 'support', title: 'Help & support', pieces: ['#issue-reports-details', '.page-cleanup-guide[data-guide="profile"]', ':scope > .flow-panel'] },
];

export function layoutProfile(document = globalThis.document) {
  const page = document.getElementById('profile');
  if (!page) return;
  let shell = page.querySelector(':scope > .settings-shell');
  if (!shell) {
    shell = document.createElement('div');
    shell.className = 'settings-shell';
    const nav = document.createElement('nav');
    nav.className = 'settings-nav';
    nav.setAttribute('aria-label', 'Profile sections');
    const body = document.createElement('div');
    body.className = 'settings-body';
    for (const section of SECTIONS) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = section.title;
      button.dataset.settingsTarget = section.id;
      // Buttons, not hash links: a hash would change the app route.
      button.addEventListener('click', () => {
        document.getElementById(`settings-${section.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        nav.querySelectorAll('button').forEach(item => item.setAttribute('aria-current', String(item === button)));
      });
      nav.append(button);
      const panel = document.createElement('section');
      panel.id = `settings-${section.id}`;
      panel.className = 'settings-panel';
      panel.setAttribute('aria-labelledby', `settings-${section.id}-title`);
      const heading = document.createElement('h2');
      heading.id = `settings-${section.id}-title`;
      heading.textContent = section.title;
      panel.append(heading);
      body.append(panel);
    }
    nav.querySelector('button')?.setAttribute('aria-current', 'true');
    shell.append(nav, body);
    const heading = page.querySelector(':scope > .section-heading');
    if (heading) heading.after(shell); else page.prepend(shell);
  }
  for (const section of SECTIONS) {
    const panel = shell.querySelector(`#settings-${section.id}`);
    for (const selector of section.pieces) {
      for (const node of page.querySelectorAll(selector.startsWith(':scope') ? selector : `:scope > ${selector}`)) {
        if (node === shell) continue;
        panel.append(node);
        if (section.open && node.tagName === 'DETAILS') node.open = true;
      }
    }
  }
}

export function mountProfileLayout(document = globalThis.document) {
  const start = () => {
    const page = document.getElementById('profile');
    if (!page) return false;
    layoutProfile(document);
    new MutationObserver(() => layoutProfile(document)).observe(page, { childList: true });
    return true;
  };
  if (start()) return;
  const observer = new MutationObserver(() => { if (start()) observer.disconnect(); });
  observer.observe(document.body, { childList: true, subtree: true });
}
