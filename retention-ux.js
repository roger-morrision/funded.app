import { APP_CLUSTER, APP_MAINNET_READ_ONLY } from './app-config.js';
import { readLaunchDraft } from './launch-draft.js';
import { readLaunchJournal } from './launch-journal.js';
import { workspaceResumeItems } from './workspace-resume.js';
import './retention-ux.css';

// Keep the public discovery path and the first launch step usable without a wallet.
const firstStep = document.querySelector('[data-launch-step="1"]');
if (firstStep) {
  const name = firstStep.querySelector('#token-name');
  const story = firstStep.querySelector('.full-label:has(#token-description)');
  const socials = firstStep.querySelector('.social-section');
  const enhanced = firstStep.querySelector('.enhanced-token-page');
  const enhancedWrapper = enhanced?.parentElement?.tagName === 'DETAILS' ? enhanced.parentElement : null;
  const choiceHeading = firstStep.querySelector('.launch-profile-heading');
  const choiceGrid = firstStep.querySelector('.launch-profile-grid');
  const choiceWrapper = choiceGrid?.closest('details.ui-disclosure');
  if (name && story && socials && enhanced) {
    const more = document.createElement('details');
    more.className = 'launch-optional-story';
    const summary = document.createElement('summary');
    summary.textContent = 'Optional project story';
    more.append(summary, story, enhanced);
    socials.after(more);
    if (choiceHeading && choiceGrid) socials.before(choiceHeading, choiceGrid);
    enhancedWrapper?.remove();
    choiceWrapper?.remove();
  }
}

const secondStep = document.querySelector('[data-launch-step="2"]');
if (secondStep) {
  const burn = document.querySelector('.creator-burn-section');
  const mode = secondStep.querySelector('.launch-mode-grid');
  const custom = secondStep.querySelector('#custom-policy');
  if (burn && mode && custom) {
    const advanced = document.createElement('details');
    advanced.className = 'launch-advanced-options';
    advanced.id = 'launch-advanced-options';
    const summary = document.createElement('summary');
    summary.textContent = 'Advanced options · launch tier and custom fee split';
    const defaultNote = document.createElement('p');
    defaultNote.textContent = 'Standard launch is selected. Your 80% creator-directed fee share goes to your wallet unless you choose a custom split.';
    advanced.append(summary, burn, mode, custom);
    secondStep.querySelector('.launch-funding-section')?.after(defaultNote, advanced);
    document.addEventListener('click', event => {
      if (event.target.closest('[data-program-tier="boost"], [data-program-tier="pro"], [data-program-tier="premier"], [data-burn-tier="boost"], [data-burn-tier="pro"], [data-burn-tier="premier"]')) advanced.open = true;
    }, true);
  }
}

const workspace = document.querySelector('.workspace-metrics');
if (workspace) {
  const stats = workspace.querySelectorAll(':scope > div');
  if (stats[0]) { stats[0].querySelector('span').textContent = 'Route status'; stats[0].querySelector('b').textContent = 'Check at review'; stats[0].querySelector('small').textContent = 'Verification required'; }
  if (stats[2]) { stats[2].querySelector('span').textContent = 'Destinations'; stats[2].querySelector('b').textContent = 'Policy'; stats[2].querySelector('small').textContent = 'No payout implied'; }
}
const previewBadge = document.querySelector('.launch-preview-heading span');
if (previewBadge) previewBadge.textContent = 'LOCAL PREVIEW';
const checklist = document.querySelector('.sign-checklist-card');
if (checklist) {
  const title = checklist.querySelector('h3'); if (title) title.textContent = 'Check before signing';
  const badge = checklist.querySelector('.preview-chip'); if (badge) badge.textContent = 'REVIEW';
  checklist.querySelectorAll('li i').forEach(icon => { icon.textContent = '•'; });
}
const signal = document.querySelector('.home-signal-stat small');
if (signal && signal.textContent.trim() === 'Ready') signal.textContent = 'Verify before signing';
document.querySelector('#leaderboard-traders-tab')?.remove();
const cost = document.querySelector('#cost-summary');
if (cost && !cost.querySelector('.launch-total-cost-note')) {
  const note = document.createElement('small');
  note.className = 'launch-total-cost-note';
  note.textContent = 'A zero platform fee does not mean a free transaction. Check network fees, optional developer buy, and any $FUNDED burn in the final review.';
  cost.append(note);
}


// Reuse the original first-steps panel instead of adding another onboarding banner.
const oldGuide = document.querySelector('#getting-started');
const heroCopy = document.querySelector('.hero-copy-column');
if (oldGuide && heroCopy) {
  const preferenceKey = 'funded.start-guide.open.v1';
  const savedSearchKey = 'funded.explore.saved-searches.v1';
  const guide = document.createElement('details');
  guide.id = 'getting-started';
  guide.className = 'workspace-start-guide';
  guide.innerHTML = '<summary>Start here</summary><div class="workspace-start-content"><p data-start-context></p><nav class="workspace-start-paths" aria-label="Choose your first action"><a href="#explore"><strong>Browse launches</strong><small>Search and save coins without connecting a wallet.</small></a><a href="#launch" data-start-launch><strong>Prepare a launch</strong><small>Save your draft, then review costs before signing.</small></a><a href="#payments"><strong>Review rewards</strong><small>Check eligibility and verified receipts.</small></a></nav><div class="workspace-resume" hidden><h2>Your saved work</h2><p>Stored in this browser. Nothing is restored or submitted automatically.</p><ul></ul></div><div class="workspace-guide-controls"><button type="button" class="text-button" data-hide-guide>Hide guide</button><span role="status" data-guide-status></span></div></div>';
  guide.querySelector('[data-start-context]').textContent = APP_CLUSTER === 'devnet'
    ? 'Devnet preview. Browse and prepare a draft without a wallet. Signing requires verified wallet, balance, and route checks.'
    : 'Mainnet browsing. Check network availability and each receipt before relying on financial activity.';
  if (APP_MAINNET_READ_ONLY) guide.querySelector('[data-start-launch]').remove();
  oldGuide.replaceWith(guide);
  heroCopy.append(guide);
  try { guide.open = localStorage.getItem(preferenceKey) !== 'false'; } catch { guide.open = true; }
  guide.addEventListener('toggle', () => {
    try { localStorage.setItem(preferenceKey, String(guide.open)); }
    catch { guide.querySelector('[data-guide-status]').textContent = 'Guide preference could not be saved on this device.'; }
  });
  guide.querySelector('[data-hide-guide]').onclick = () => { guide.open = false; guide.querySelector('summary').focus(); };
  const refreshSavedWork = () => {
    let draft = null, searches = [];
    try { draft = readLaunchDraft(); } catch { /* Unreadable drafts remain available through the explicit draft controls. */ }
    try { searches = JSON.parse(localStorage.getItem(savedSearchKey) || '[]'); } catch {}
    const items = workspaceResumeItems({ draft, journal: readLaunchJournal(), searches, cluster: APP_CLUSTER, origin: location.origin });
    const resume = guide.querySelector('.workspace-resume');
    const list = resume.querySelector('ul');
    const focusedHref = list.contains(document.activeElement) ? document.activeElement.getAttribute('href') : null;
    list.replaceChildren();
    for (const item of items) {
      const row = document.createElement('li');
      const link = document.createElement('a'); link.href = item.href; link.textContent = item.label;
      const detail = document.createElement('small'); detail.textContent = item.detail;
      if (item.kind === 'draft') link.addEventListener('click', () => {
        requestAnimationFrame(() => requestAnimationFrame(() => {
          const restore = document.querySelector('#restore-launch-draft');
          const panel = restore?.closest('details'); if (panel) panel.open = true;
          restore?.focus({ preventScroll: true });
          restore?.scrollIntoView({ block: 'nearest', behavior: 'instant' });
        }));
      });
      row.append(link, detail); list.append(row);
    }
    resume.hidden = items.length === 0;
    guide.querySelector('summary').textContent = items.length ? 'Start here · your saved work' : 'Start here';
    if (focusedHref) [...list.querySelectorAll('a')].find(link => link.getAttribute('href') === focusedHref)?.focus({ preventScroll: true });
  };
  for (const event of ['funded:launch-draft-change', 'funded:saved-search-change']) document.addEventListener(event, refreshSavedWork);
  window.addEventListener('funded:journal', refreshSavedWork);
  window.addEventListener('storage', event => {
    if (event.key === preferenceKey) { try { guide.open = localStorage.getItem(preferenceKey) !== 'false'; } catch {} }
    else if (!event.key || ['funded.launch.draft.v1', 'funded.launch.journal.v1', savedSearchKey].includes(event.key)) refreshSavedWork();
  });
  refreshSavedWork();
}
