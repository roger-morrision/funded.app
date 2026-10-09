import { $, $$, text, node, disclose } from './dom.js';
import { icon } from '../../../ui-icons.js';

export function launch() {
  $('#wizard-hint')?.setAttribute('tabindex','-1');
  $$('[data-launch-step-target]').forEach(button=>button.setAttribute('aria-label',`Step ${button.dataset.launchStepTarget}: ${['Token details','Rewards and launch'][Number(button.dataset.launchStepTarget)-1]}`));
  disclose($('.enhanced-token-page'), 'Optional story and roadmap');
  const tier = $('.creator-burn-section');
  const firstStep = $('[data-launch-step="1"]');
  if (tier && firstStep) { tier.classList.add('launch-tier-first'); firstStep.prepend(tier); }
  const coinFields = firstStep?.querySelector('.coin-fields');
  const description = firstStep?.querySelector('.full-label:has(#token-description)');
  const socials = firstStep?.querySelector('.launch-optional-socials');
  const image = firstStep?.querySelector('.full-label:has(#token-image-picker)');
  if (coinFields && description && socials && image) coinFields.after(description, socials, image);
  text('#creator-burn-title', 'Promotion package');
  text('#creator-burn-title + span', 'Select one');
  if (tier) {
    const explanations = {
      standard: ['Standard', 'No $FUNDED burn. The core Pump launch, community airdrop policy, and basic funded.vip X announcement apply when account publishing is active.'],
      pro: ['Pro', 'A confirmed $FUNDED burn is bound to the launch transaction. The package adds a verified badge and a featured funded.vip X launch post when account publishing is active.'],
      premier: ['Premier', 'A confirmed $FUNDED burn adds the Premier badge, one funded.vip X launch post, and a separate follow-up after 24 hours once the first post is published.'],
    };
    const guide = node('div', 'launch-tier-guide-links');
    const guideDialog = node('dialog', 'launch-tier-guide-dialog');
    guideDialog.setAttribute('aria-labelledby', 'launch-tier-guide-title');
    guideDialog.innerHTML = `<button type="button" class="launch-tier-guide-close" aria-label="Close tier guide">${icon('close')}</button><p class="eyebrow">Launch tier</p><h3 id="launch-tier-guide-title"></h3><p class="launch-tier-guide-copy"></p><a href="#buybacks">View burn policy →</a>`;
    for (const [key, [title, description]] of Object.entries(explanations)) {
      const button = node('button', 'text-button', `About ${title}`);
      button.type = 'button';
      button.setAttribute('aria-haspopup', 'dialog');
      button.addEventListener('click', () => {
        const amount = tier.querySelector(`[data-burn-tier="${key}"] strong`)?.textContent?.trim() || '';
        guideDialog.querySelector('h3').textContent = `${title} · ${amount}`;
        guideDialog.querySelector('.launch-tier-guide-copy').textContent = description;
        guideDialog.showModal();
      });
      guide.append(button);
    }
    tier.append(guide, guideDialog);
    guideDialog.querySelector('.launch-tier-guide-close').addEventListener('click', () => guideDialog.close());
    guideDialog.addEventListener('click', event => { if (event.target === guideDialog) guideDialog.close(); });
  }
  const page = $('#launch-dialog');
  const funding = $('#community-airdrop-help');
  const reserve = $('#community-airdrop-tokens');
  reserve?.addEventListener('input', () => {
    const amount = Number(reserve.value);
    if (funding) funding.textContent = Number.isSafeInteger(amount) ? `${amount.toLocaleString()} tokens · ${(amount / 1e9 * 100).toFixed(2)}% of supply. Allowed: 30M–500M.` : 'Enter a whole token amount between 30M and 500M.';
  });
  const route = node('div','launch-distribution-summary');
  route.innerHTML = '<div class="distribution-bar" aria-label="80 percent creator-directed; 20 percent protocol"><i></i><i></i></div><p>80% creator-directed · 20% protocol<br><small>Percentages of gross collected creator fees. Allocation is not a paid reward.</small></p>';
  $('.fee-split-fixed')?.after(route);
  // The initial step is set by the application; align first paint before any interaction.
  page.dataset.step = '1';
  $$('[data-launch-step]',page).forEach(panel=>panel.hidden=panel.dataset.launchStep!=='1');
}
