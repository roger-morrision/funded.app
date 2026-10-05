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
  const mode = secondStep.querySelector('.launch-mode-grid');
  const custom = secondStep.querySelector('#custom-policy');
  if (mode && custom) {
    const advanced = document.createElement('details');
    advanced.className = 'launch-advanced-options';
    advanced.id = 'launch-advanced-options';
    const summary = document.createElement('summary');
    summary.textContent = 'Custom creator fee split · optional';
    advanced.append(summary, mode, custom);
    secondStep.querySelector('.launch-funding-section')?.after(advanced);
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
