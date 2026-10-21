// Bind once at the existing History startup position; rendering owns no requests.
export function initializePaymentHistoryControls({ document, renderHistory }) {
  document.querySelector('#payment-history-filters')?.addEventListener('change', event => {
    // Input already commits search edits. A blur change must not replace the
    // receipt row while a visitor is clicking its native disclosure or links.
    if (event.target.id !== 'payment-history-search') renderHistory();
  });
  const search = document.querySelector('#payment-history-search');
  search?.addEventListener('input', event => {
    if (!event.isComposing) renderHistory();
  });
  search?.addEventListener('compositionend', () => renderHistory());
  document.querySelector('#payment-history-clear')?.addEventListener('click', () => {
    for (const selector of ['#payment-history-search', '#payment-history-type', '#payment-history-from', '#payment-history-to']) {
      const input = document.querySelector(selector);
      if (input) input.value = selector === '#payment-history-type' ? 'all' : '';
    }
    renderHistory();
  });
}
