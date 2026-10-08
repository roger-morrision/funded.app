export function quoteCountdown(expiresAt, now = Date.now()) {
  const deadline = typeof expiresAt === 'number' ? expiresAt : Date.parse(expiresAt);
  const seconds = Number.isFinite(deadline) ? Math.max(0, Math.ceil((deadline - now) / 1000)) : 0;
  return { expired: seconds === 0, seconds,
    text: seconds ? `Price expires in ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}` : 'Price expired · refresh to continue',
    state: seconds === 0 ? 'expired' : seconds <= 10 ? 'expiring' : 'current' };
}

export function quoteCountdownMarkup(expiresAt, now = Date.now()) {
  const deadline = typeof expiresAt === 'number' ? expiresAt : Date.parse(expiresAt);
  const value = quoteCountdown(deadline, now);
  return `<span class="quote-countdown" role="timer" aria-live="off" data-quote-expires="${Number.isFinite(deadline) ? deadline : 0}" data-state="${value.state}">${value.text}</span>`;
}

// Update only the timer text: keep focused controls and expanded details intact.
export function updateQuoteCountdowns(root = document, now = Date.now()) {
  for (const node of root.querySelectorAll('[data-quote-expires]')) {
    const value = quoteCountdown(Number(node.dataset.quoteExpires), now);
    if (node.textContent !== value.text) node.textContent = value.text;
    node.dataset.state = value.state;
  }
}
